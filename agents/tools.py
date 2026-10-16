"""Bounded tools plus a local JSONL execution ledger; no agent-supplied shell."""
import json
import os
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from time import monotonic

from runtime.daytona.client import CandidateRuntime
from agents.config import EDITABLE_PATH
from agents.security import redact


class Ledger:
    def __init__(self, path: Path, context: dict):
        self.path = path
        self.context = context
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.seq = 0

    def record(self, event_type: str, payload: dict) -> None:
        self.seq += 1
        row = {**self.context, "seq": self.seq, "at": datetime.now(timezone.utc).isoformat(),
               "type": event_type, "payload": payload}
        text = json.dumps(redact(row))
        with self.path.open("a") as stream:
            stream.write(text + "\n")


class RecoveryTools:
    def __init__(self, runtime: CandidateRuntime, ledger: Ledger, api=None, *, run_id="", candidate_id="", author="agentA", target_scope=""):
        self.runtime = runtime
        self.ledger = ledger
        self.calls = 0
        self.api, self.run_id, self.candidate_id, self.author, self.target_scope = api, run_id, candidate_id, author, target_scope
        self.read_hashes: dict[str, str] = {}
        self.evidence_ids: list[str] = []
        self.published_findings: list[str] = []
        self.retrieved_findings: dict[str, dict] = {}
        self.decision_refs: list[dict] = []
        self.influenced_patches: list[dict] = []

    def _read(self, path):
        content = self.runtime.read_file(path)
        self.read_hashes[path] = hashlib.sha256(content.encode()).hexdigest()
        return {"path": path, "sha256": self.read_hashes[path], "content": redact(content)}

    def _replace(self, path, old, new):
        if path not in self.read_hashes:
            raise ValueError("read the approved file before patching")
        result = self.runtime.replace_text(path, old, new, self.read_hashes[path])
        self.read_hashes[path] = result["afterSha256"]
        if self.decision_refs:
            self.influenced_patches.append({"afterSha256": result["afterSha256"], "citations": list(self.decision_refs)})
        return result

    def _action(self, name):
        if name != "check":
            raise PermissionError("only the named check action is available to agents")
        self.runtime.verify_protected()
        result = self.runtime.run_action(name)
        self.runtime.verify_protected()
        self.runtime.verify_seed()
        return result

    def _require_api(self):
        if self.api is None:
            raise RuntimeError("authoritative API is unavailable; local ledger is debug-only")

    def publish_observation(self, observation: str, evidence_ids: list[str]):
        self._require_api()
        if not evidence_ids or not set(evidence_ids) <= set(self.evidence_ids):
            raise ValueError("observation must cite this agent's real, already published tool evidence")
        finding = self.api.finding(self.run_id, self.author, observation, evidence_ids, self.target_scope)
        message = self.api.message(self.run_id, self.author, "agentB", "finding", observation, [finding["id"]])
        self.published_findings.append(finding["id"])
        return {"finding": finding, "messageId": message["id"]}

    def read_shared_findings(self):
        self._require_api()
        findings = self.api.findings(self.run_id, self.author)
        accepted = []
        for finding in findings:
            if (finding.get("author") != "agentA" or finding.get("category") != "OWASP-API1-2023"
                    or finding.get("targetScope") != self.target_scope or not finding.get("evidenceIds")):
                continue
            evidence = [self.api.get_evidence(self.run_id, key) for key in finding["evidenceIds"]]
            if any(item.get("runId") != self.run_id for item in evidence):
                raise ValueError("shared evidence is outside this run")
            self.retrieved_findings[finding["id"]] = finding
            accepted.append({"finding": finding, "evidence": evidence})
        return {"findings": accepted, "messages": self.api.messages(self.run_id, self.author)}

    def cite_finding_decision(self, finding_id: str, decision: str):
        self._require_api()
        finding = self.retrieved_findings.get(finding_id)
        if finding is None:
            raise ValueError("retrieve the finding from the authoritative backend before citing it")
        message = self.api.message(self.run_id, self.author, "room", "decision", decision, [finding_id])
        ref = {"findingId": finding_id, "evidenceIds": finding["evidenceIds"], "messageId": message["id"]}
        self.decision_refs.append(ref)
        return ref

    def call(self, operation: str, **args):
        self.calls += 1
        started = monotonic()
        try:
            if self.calls > self.runtime.target.max_tool_calls:
                raise PermissionError("candidate tool-call budget exhausted")
            operations = {"read_file": self._read, "replace_text": self._replace, "run_action": self._action,
                          "publish_observation": self.publish_observation, "read_shared_findings": self.read_shared_findings,
                          "cite_finding_decision": self.cite_finding_decision}
            if operation not in operations:
                raise PermissionError(f"unknown tool: {operation}")
            result = operations[operation](**args)
        except Exception as error:
            self.ledger.record("tool.failed", {"tool": operation, "error": str(error),
                               "refused": isinstance(error, PermissionError),
                               "commands": list(self.runtime.commands)})
            self.runtime.commands.clear()
            raise
        event = {"tool": operation, "args": args, "result": result,
                 "commands": list(self.runtime.commands), "influencedBy": list(self.decision_refs),
                 "durationMs": round((monotonic() - started) * 1000)}
        # Include only this call's commands, then clear the debug command buffer.
        self.runtime.commands.clear()
        self.ledger.record("tool.completed", event)
        if self.api:
            evidence = self.api.evidence(self.run_id, "patch" if operation == "replace_text" else "log",
                                         f"{self.author} {operation}", event, self.author, self.candidate_id)
            self.evidence_ids.append(evidence["id"])
            return {"result": redact(result), "evidenceId": evidence["id"]}
        return redact(result)

    def crewai_tools(self):
        from crewai.tools import tool

        @tool("read_file")
        def read_file(path: str) -> str:
            """Read one file listed in the approved target baseline. Paths are relative to workspace."""
            return json.dumps(self.call("read_file", path=path))

        @tool("replace_text")
        def replace_text(path: str, old: str, new: str) -> str:
            """Replace one exact text occurrence in an approved writable source file."""
            return json.dumps(self.call("replace_text", path=path, old=old, new=new))

        @tool("run_action")
        def run_action(name: str) -> str:
            """Run the named check action only. Lifecycle/reset actions belong to the supervisor."""
            return json.dumps(self.call("run_action", name=name))

        @tool("publish_observation")
        def publish_observation(observation: str, evidence_ids: list[str]) -> str:
            """Publish a factual BOLA observation with evidence IDs returned by your actual tool calls."""
            return json.dumps(self.call("publish_observation", observation=observation, evidence_ids=evidence_ids))

        @tool("read_shared_findings")
        def read_shared_findings() -> str:
            """Retrieve Agent A's observations, actual evidence, and messages from the run backend."""
            return json.dumps(self.call("read_shared_findings"))

        @tool("cite_finding_decision")
        def cite_finding_decision(finding_id: str, decision: str) -> str:
            """Cite a retrieved finding and explain how it changes your next concrete repair action."""
            return json.dumps(self.call("cite_finding_decision", finding_id=finding_id, decision=decision))

        tools = [read_file, replace_text, run_action, publish_observation, read_shared_findings, cite_finding_decision]
        for item in tools:
            item.cache_function = lambda _args, _result: False
        return tools
