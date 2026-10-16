"""Adapter for Samer's actual HTTP contract at origin/feat/api (6178de2).

No verifier/approval writes are exposed to recovery agents. No implicit write retries.
"""
import json
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from agents.config import Target
from agents.security import redact, shared_json


class ApiError(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class RunApi:
    contract_revision = "6178de2"

    def __init__(self, base_url: str, timeout: int = 15):
        parsed = urlsplit(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("API URL must be a credential-free HTTP(S) origin/base path")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.opener = build_opener(NoRedirect())

    def request(self, method: str, path: str, body=None, *, role="agent"):
        data = shared_json(body).encode() if body is not None else None
        request = Request(self.base_url + path, data=data, method=method,
                          headers={"content-type": "application/json", "x-role": role})
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                content = response.read(1_048_577)
                if len(content) > 1_048_576:
                    raise ApiError("API response exceeds 1 MB")
                return json.loads(content)
        except HTTPError as error:
            # Do not repeat a possibly accepted mutation after a timeout/error.
            raise ApiError(f"Samer API {method} {path}: HTTP {error.code}; reconcile authoritative state before retry") from None
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            raise ApiError(f"Samer API unavailable/incompatible for {method} {path}: {type(error).__name__}") from None

    @staticmethod
    def path(run_id: str, suffix: str = "") -> str:
        return "/runs/" + quote(run_id, safe="") + suffix

    def health(self):
        health = self.request("GET", "/health")
        if health.get("ok") is not True or health.get("store") not in {"memory", "jsonl", "surreal"}:
            raise ApiError("backend /health does not match Samer's inspected contract")
        return health

    def create_run(self, target: Target, target_url: str):
        return self.request("POST", "/runs", {"targetUrl": target_url, "baseFixtureId": target.base_fixture_id,
                            "targetVersion": target.source_commit,
                            "description": f"VAmPI book-access BOLA only; manifest fingerprint {target.fingerprint}"}, role="orchestrator")

    def approved_run(self, run_id: str, target: Target):
        run = self.request("GET", self.path(run_id))
        approvals = self.request("GET", self.path(run_id, "/approvals"))
        if run.get("baseFixtureId") != target.base_fixture_id or run.get("targetVersion") != target.source_commit:
            raise ApiError("run source version/baseline differs from the approved manifest")
        if run.get("status") not in {"investigating", "experimenting", "verifying"}:
            raise ApiError("run must be open and scope-approved")
        if not any(a.get("kind") == "scope" and a.get("decision") == "approved" for a in approvals):
            raise ApiError("no human scope approval exists in the authoritative API")
        return run

    def evidence(self, run_id: str, kind: str, label: str, content, author: str, candidate_id: str | None = None):
        body = {"kind": kind, "label": label[:200], "content": shared_json(content), "author": author}
        if candidate_id:
            body["candidateId"] = candidate_id
        if len(body["content"].encode()) > 256 * 1024:
            raise ApiError("evidence exceeds Samer's 256 KB limit; no silent truncation of patch artifacts")
        return self.request("POST", self.path(run_id, "/evidence"), body)

    def get_evidence(self, run_id: str, evidence_id: str):
        return self.request("GET", self.path(run_id, "/evidence/" + quote(evidence_id, safe="")))

    def finding(self, run_id: str, author: str, observation: str, evidence_ids: list[str], target_scope: str):
        return self.request("POST", self.path(run_id, "/findings"), {
            "author": author, "category": "OWASP-API1-2023", "observation": redact(observation),
            "evidenceIds": evidence_ids, "targetScope": target_scope})

    def findings(self, run_id: str, reader: str):
        return self.request("GET", self.path(run_id, "/findings?" + urlencode({"excludeAuthor": reader})))

    def message(self, run_id: str, author: str, recipient: str, kind: str, body: str, finding_ids: list[str]):
        return self.request("POST", self.path(run_id, "/messages"), {
            "from": author, "to": recipient, "type": kind, "body": redact(body), "findingIds": finding_ids})

    def messages(self, run_id: str, reader: str):
        return self.request("GET", self.path(run_id, "/messages?" + urlencode({"for": reader})))

    def candidate(self, run_id: str, target: Target, sandbox_id: str, label: str, strategy: str, author: str):
        return self.request("POST", self.path(run_id, "/candidates"), {
            "sandboxId": sandbox_id, "baseFixtureId": target.base_fixture_id,
            "strategy": strategy, "label": label, "agentId": author})

    def update_candidate(self, run_id: str, candidate_id: str, **fields):
        if set(fields) - {"status", "patchRef", "targetUrl", "agentClaim"}:
            raise ApiError("candidate update outside the inspected API contract")
        if fields.get("status") in {"done", "pass"}:
            raise ApiError("recovery runtime cannot declare a verified result")
        return self.request("PATCH", self.path(run_id, "/candidates/" + quote(candidate_id, safe="")), fields)

    def candidate_state(self, run_id: str, candidate_id: str):
        return self.request("GET", self.path(run_id, "/candidates/" + quote(candidate_id, safe="")))

    def abort_comparison(self, run_id: str):
        return self.request("PATCH", self.path(run_id), {
            "status": "failed", "reason": "Measured candidate baseline invariant failed; comparison aborted."}, role="orchestrator")
