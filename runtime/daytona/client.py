"""Only a newly created candidate sandbox is exposed to recovery tools."""
import hashlib
import json
import shlex
from typing import Any

from agents.config import EDITABLE_PATH, Target
from agents.patching import unified_patch, validate_patch

MAX_FILE_BYTES = 128_000
MAX_OUTPUT_CHARS = 12_000


class BaselineError(ValueError):
    """Any failure here invalidates the comparison, not just a repair hypothesis."""


class CandidateRuntime:
    def __init__(self, sandbox: Any, target: Target):
        self.sandbox = sandbox
        self.target = target
        self.commands: list[dict] = []
        self.original_source: str | None = None
        self.baseline_report: dict | None = None

    def execute(self, command: str) -> dict:
        result = self.sandbox.process.exec(command, cwd=self.target.workspace,
                                           env=dict(self.target.environment), timeout=self.target.command_timeout_seconds)
        row = {"command": command, "exitCode": result.exit_code,
               "output": result.result[:MAX_OUTPUT_CHARS], "truncated": len(result.result) > MAX_OUTPUT_CHARS}
        self.commands.append(row)
        return row

    def _path(self, path: str) -> str:
        if path not in self.target.baseline_sha256 and path != self.target.seed.path:
            raise PermissionError(f"file outside approved scope: {path}")
        absolute = f"{self.target.workspace}/{path}"
        resolved = self.execute(f"realpath {shlex.quote(absolute)}")
        # Reject symlinks too, including a symlinked workspace, before using the FS API.
        if resolved["exitCode"] != 0 or resolved["output"].strip() != absolute:
            raise PermissionError(f"file does not resolve to the approved path: {path}")
        return absolute

    def read_file(self, path: str) -> str:
        if path == self.target.seed.path:
            raise PermissionError("agents cannot read the SQLite seed artifact")
        content = self.sandbox.fs.download_file(self._path(path))
        if content is None or len(content) > MAX_FILE_BYTES:
            raise ValueError("file missing or exceeds 128 KB limit")
        return content.decode("utf-8")

    def replace_text(self, path: str, old: str, new: str, expected_sha256: str) -> dict:
        if path not in self.target.writable_files:
            raise PermissionError(f"file is read-only: {path}")
        before = self.read_file(path)
        if hashlib.sha256(before.encode()).hexdigest() != expected_sha256:
            raise ValueError("source changed since read; re-read before applying a patch")
        if not old or before.count(old) != 1:
            raise ValueError("old text must match exactly once; read the file before patching")
        after = before.replace(old, new, 1)
        validate_patch(self.original_source or before, after)
        if len(after.encode()) > MAX_FILE_BYTES:
            raise ValueError("patched file exceeds 128 KB limit")
        self.sandbox.fs.upload_file(after.encode(), self._path(path), timeout=30)
        if self.read_file(path) != after:
            raise RuntimeError("source write did not persist as requested")
        self.verify_protected()
        return {"path": path, "beforeSha256": hashlib.sha256(before.encode()).hexdigest(),
                "afterSha256": hashlib.sha256(after.encode()).hexdigest(), "old": old, "new": new}

    def run_action(self, name: str, *, supervisor: bool = False) -> dict:
        if name not in self.target.actions or (not supervisor and name != "check"):
            raise PermissionError(f"action outside approved scope: {name}")
        result = {"action": name, **self.execute(self.target.actions[name])}
        return result

    def require_action(self, name: str) -> dict:
        row = self.run_action(name, supervisor=True)
        if row["exitCode"] != 0 or row["truncated"]:
            raise BaselineError(f"{name} action failed or produced incomplete evidence")
        return row

    def verify_protected(self) -> None:
        for path, expected in self.target.baseline_sha256.items():
            if path != EDITABLE_PATH and hashlib.sha256(self.read_file(path).encode()).hexdigest() != expected:
                raise BaselineError(f"read-only source/config changed: {path}")

    def verify_seed(self) -> dict:
        self.require_action("assert_stopped")
        path = self._path(self.target.seed.path)
        sidecars = self.execute(" && ".join(f"test ! -e {shlex.quote(path + suffix)}" for suffix in ("-wal", "-shm", "-journal")))
        if sidecars["exitCode"] != 0:
            raise BaselineError("SQLite journal/WAL sidecar present; canonical stopped artifact required")
        content = self.sandbox.fs.download_file(path)
        if content is None or len(content) > 16_000_000 or hashlib.sha256(content).hexdigest() != self.target.seed.sha256:
            raise BaselineError("SQLite seed hash mismatch")
        # Read-only SQLite inspection. No user passwords or book secrets enter the report.
        code = ("import json,sqlite3; from urllib.parse import quote; "
                f"c=sqlite3.connect('file:'+quote({path!r},safe='/')+'?mode=ro&immutable=1',uri=True); "
                "print(json.dumps({'integrity':c.execute('PRAGMA integrity_check').fetchone()[0],"
                "'users':[r[0] for r in c.execute('SELECT username FROM users ORDER BY username')],"
                "'books':[r[0] for r in c.execute('SELECT book_title FROM books ORDER BY book_title')]}));c.close()")
        result = self.execute("python -c " + shlex.quote(code))
        if result["exitCode"] != 0 or result["truncated"]:
            raise BaselineError("SQLite inspection failed")
        state = json.loads(result["output"])
        if (state.get("integrity") != "ok" or sorted(state.get("users", [])) != sorted(self.target.seed.expected_users)
                or sorted(state.get("books", [])) != sorted(self.target.seed.expected_books)):
            raise BaselineError("canonical SQLite schema/integrity/seed records do not match")
        return {"sha256": self.target.seed.sha256, "path": self.target.seed.path, "state": state, "measuredWhileStopped": True}

    def verify_baseline(self) -> dict:
        self.require_action("stop")
        self.require_action("assert_stopped")
        version = self.execute("cat .pinned_sha")
        if version["exitCode"] != 0 or version["output"].strip() != self.target.source_commit:
            raise BaselineError("pinned source marker does not match; source hashes are checked separately")
        for path, expected in self.target.baseline_sha256.items():
            actual = hashlib.sha256(self.read_file(path).encode()).hexdigest()
            if actual != expected:
                raise BaselineError(f"baseline mismatch: {path}; refusing candidate execution")
        self.original_source = self.read_file(EDITABLE_PATH)
        seed = self.verify_seed()
        # Validate the supplied reset twice against the same stopped binary artifact.
        for _ in range(2):
            self.require_action("reset")
            self.verify_seed()
            self.verify_protected()
            if self.read_file(EDITABLE_PATH) != self.original_source:
                raise BaselineError("reset changed the vulnerable source baseline")
        self.verify_flag()
        self.baseline_report = {
            "baselineFingerprint": self.target.fingerprint, "baseFixtureId": self.target.base_fixture_id,
            "sourceCommit": self.target.source_commit, "snapshot": self.target.snapshot, "snapshotId": self.target.snapshot_id,
            "image": self.target.image, "sourceConfigHashes": dict(self.target.baseline_sha256),
            "seed": seed, "environment": dict(self.target.environment),
            "isolation": {"sandboxId": self.sandbox.id, "sharedVolumes": False, "databaseMeasurement": "local SQLite artifact"},
            "limitations": "Equality covers the measured source/config and stopped SQLite artifact, not unmeasured infrastructure.",
        }
        return self.baseline_report

    def verify_flag(self) -> None:
        code = "import app,os,json; print(json.dumps({'vuln':app.vuln,'environment':os.getenv('vulnerable'),'ttl':os.getenv('tokentimetolive')}))"
        result = self.execute("python -c " + shlex.quote(code))
        if result["exitCode"] != 0 or result["truncated"]:
            raise BaselineError("cannot inspect the effective VAmPI flag")
        actual = json.loads(result["output"])
        if actual != {"vuln": 1, "environment": "1", "ttl": self.target.environment["tokentimetolive"]}:
            raise BaselineError("effective VAmPI flag/configuration mismatch")

    def patch_diff(self) -> str:
        if self.original_source is None:
            raise BaselineError("baseline was not measured")
        source = self.read_file(EDITABLE_PATH)
        validate_patch(self.original_source, source)
        return unified_patch(self.original_source, source)

    def start_ready(self) -> list[dict]:
        self.verify_protected()
        self.verify_seed()
        self.verify_flag()
        rows = [self.require_action("start"), self.require_action("readiness")]
        code = ("import json,urllib.request; "
                f"r=urllib.request.urlopen('http://127.0.0.1:{self.target.inspection_port}/',timeout=10); "
                "d=json.load(r); assert d.get('vulnerable') == 1, 'running service flag mismatch'; "
                "print(json.dumps({'httpStatus':r.status,'vulnerable':d['vulnerable']}))")
        service = self.execute("python -c " + shlex.quote(code))
        if service['exitCode'] != 0 or service['truncated']:
            raise BaselineError('running service did not prove vulnerable=1')
        rows.append(service)
        self.verify_protected()
        self.verify_flag()
        return rows


def create_candidate(client: Any, target: Target, run_id: str, candidate_id: str, on_created=None) -> CandidateRuntime:
    from daytona import CreateSandboxFromSnapshotParams

    snapshot = client.snapshot.get(target.snapshot)
    if snapshot.id != target.snapshot_id or (target.image is not None and snapshot.image_name != target.image):
        raise BaselineError("prepared snapshot identity/image mismatch")
    sandbox = client.create(CreateSandboxFromSnapshotParams(
        snapshot=target.snapshot, public=False,
        env_vars=dict(target.environment), volumes=[], network_block_all=True,
        labels={"project": "restorelab", "runId": run_id, "candidateId": candidate_id},
        auto_stop_interval=target.retention_minutes, auto_delete_interval=1,
    ), timeout=60)
    runtime = CandidateRuntime(sandbox, target)
    try:
        if on_created:
            on_created(sandbox.id)
        sandbox.refresh_data()
        if sandbox.volumes or sandbox.public or not sandbox.network_block_all or any(sandbox.env.get(k) != v for k, v in target.environment.items()):
            raise BaselineError("sandbox isolation/configuration invariants failed")
        if client.snapshot.get(target.snapshot).id != target.snapshot_id:
            raise BaselineError("snapshot changed during creation")
        runtime.verify_baseline()
    except BaseException:
        client.delete(sandbox)
        raise
    return runtime


def require_equivalent(first: CandidateRuntime, second: CandidateRuntime) -> None:
    if first.sandbox.id == second.sandbox.id or first.target.fingerprint != second.target.fingerprint:
        raise BaselineError("candidates must have distinct sandbox IDs and the same approved manifest")
    if not first.baseline_report or not second.baseline_report:
        raise BaselineError("both baselines must be measured before comparison")
    a, b = dict(first.baseline_report), dict(second.baseline_report)
    a.pop("isolation")
    b.pop("isolation")
    if a != b:
        raise BaselineError("measured candidate baselines differ; abort comparison")
