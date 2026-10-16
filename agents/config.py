"""Canonical VAmPI handoff. Incomplete templates can be inspected, never executed."""
import hashlib
import json
import re
from pathlib import Path, PurePosixPath

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

EDITABLE_PATH = "api_views/books.py"
REQUIRED_SOURCE_FILES = {
    EDITABLE_PATH, "app.py", "config.py", "api_views/users.py",
    "models/books_model.py", "models/user_model.py", "requirements.txt",
    "openapi_specs/openapi3.yml", ".pinned_sha",
}
REQUIRED_ACTIONS = {"stop", "assert_stopped", "reset", "start", "readiness", "check"}
REQUIRED_CHECKS = {
    "cross_user_denied", "own_book_preserved", "second_owner_preserved",
    "valid_fresh_authentication", "seeded_data_preserved", "service_ready",
    "vulnerable_flag_preserved",
}


def relative_path(path: str) -> bool:
    p = PurePosixPath(path)
    return bool(path) and not p.is_absolute() and ".." not in p.parts and str(p) == path and path != "." and "\x00" not in path


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Seed(StrictModel):
    path: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    artifact_ref: str = Field(min_length=1)
    reset_validation_evidence_ref: str = Field(min_length=1)
    expected_users: list[str] = Field(min_length=2)
    expected_books: list[str] = Field(min_length=1)


class Acceptance(StrictModel):
    id: str = Field(min_length=1)
    verifier: str = Field(min_length=1)
    contract_ref: str = Field(min_length=1)
    cross_user_status: Literal[404] = 404
    own_book_status: Literal[200] = 200
    checks: dict[str, str]


class Target(StrictModel):
    schema_version: Literal[1] = 1
    target: Literal["VAmPI"] = "VAmPI"
    scope: Literal["GET /books/v1/{title}"] = "GET /books/v1/{title}"
    name: str = Field(min_length=1)
    source_repository: Literal["https://github.com/erev0s/VAmPI"] = "https://github.com/erev0s/VAmPI"
    source_commit: str = Field(pattern=r"^[0-9a-f]{40}$")
    image: str
    snapshot: str = Field(min_length=1)
    snapshot_id: str = Field(min_length=1)
    base_fixture_id: str = Field(min_length=1)
    workspace: str
    baseline_sha256: dict[str, str] = Field(min_length=1)
    writable_files: list[str] = Field(min_length=1)
    actions: dict[str, str] = Field(min_length=1)
    seed: Seed
    environment: dict[str, str]
    acceptance: Acceptance
    inspection_port: int = Field(default=5000, ge=1, le=65535)
    retention_minutes: int = Field(default=60, ge=5, le=120)
    command_timeout_seconds: int = Field(default=30, ge=1, le=60)
    max_tool_calls: int = Field(default=24, ge=1, le=100)

    @model_validator(mode="after")
    def validate_scope(self):
        root = PurePosixPath(self.workspace)
        if not root.is_absolute() or root == PurePosixPath("/") or str(root) != self.workspace or ".." in root.parts:
            raise ValueError("workspace must be a normalized absolute directory other than /")
        for path, digest in self.baseline_sha256.items():
            if not relative_path(path):
                raise ValueError(f"invalid baseline path: {path}")
            if not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise ValueError(f"invalid SHA-256: {path}")
        if not REQUIRED_SOURCE_FILES <= self.baseline_sha256.keys():
            raise ValueError(f"missing measured source/config files: {sorted(REQUIRED_SOURCE_FILES - self.baseline_sha256.keys())}")
        if self.writable_files != [EDITABLE_PATH]:
            raise ValueError(f"only {EDITABLE_PATH} is writable")
        if not relative_path(self.seed.path) or self.seed.path in self.baseline_sha256:
            raise ValueError("seed must have a separate normalized relative path")
        if not REQUIRED_ACTIONS <= self.actions.keys():
            raise ValueError(f"missing lifecycle actions: {sorted(REQUIRED_ACTIONS - self.actions.keys())}")
        if self.environment.get("vulnerable") != "1" or set(self.environment) != {"vulnerable", "tokentimetolive"}:
            raise ValueError("candidate environment must contain vulnerable=1 and tokentimetolive only")
        if not self.environment["tokentimetolive"].isdigit() or int(self.environment["tokentimetolive"]) < 60:
            raise ValueError("tokentimetolive must be at least 60 seconds; verifier must obtain fresh tokens")
        if not re.fullmatch(r"[^\s@]+@sha256:[0-9a-f]{64}", self.image):
            raise ValueError("image must be immutable repository@sha256:digest, never a tag alone")
        for value in (self.snapshot, self.snapshot_id, self.base_fixture_id, self.seed.artifact_ref,
                      self.seed.reset_validation_evidence_ref, self.acceptance.id, self.acceptance.contract_ref):
            if any(marker in value.lower() for marker in ("replace_", "todo", "pending", "placeholder", "latest")):
                raise ValueError("unresolved handoff value; live execution is blocked")
        if set(self.acceptance.checks) != REQUIRED_CHECKS or any(not v.strip() for v in self.acceptance.checks.values()):
            raise ValueError(f"acceptance must define exactly {sorted(REQUIRED_CHECKS)}")
        if any(not re.fullmatch(r"[a-z][a-z0-9_-]*", key) or not cmd.strip() for key, cmd in self.actions.items()):
            raise ValueError("actions must map simple names to nonempty operator-approved commands")
        return self

    @property
    def fingerprint(self) -> str:
        baseline = self.model_dump()
        return hashlib.sha256(json.dumps(baseline, sort_keys=True).encode()).hexdigest()


def load_target(path: Path) -> Target:
    return Target.model_validate_json(path.read_text())


def manifest_issues(path: Path) -> list[dict]:
    """Readable diagnostics for an intentionally incomplete teammate handoff."""
    from pydantic import ValidationError

    try:
        load_target(path)
        return []
    except ValidationError as error:
        return [{"field": ".".join(map(str, item["loc"])), "reason": item["msg"]} for item in error.errors()]
