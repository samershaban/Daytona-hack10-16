"""One real candidate, authoritative evidence, and bounded verifier retention."""
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from agents.config import EDITABLE_PATH
from agents.crew import STRATEGIES, build_crew
from agents.patching import strategy_evidence
from agents.security import shared_json
from agents.tools import Ledger, RecoveryTools
from runtime.daytona.client import BaselineError, create_candidate


def compare_report(report, previous):
    if report['isolation']['sandboxId'] == previous['isolation']['sandboxId']:
        raise BaselineError('candidates share a sandbox')
    if {k: v for k, v in report.items() if k != 'isolation'} != {k: v for k, v in previous.items() if k != 'isolation'}:
        raise BaselineError('measured candidate baselines differ; abort comparison')


def get_finding(api, run_id, finding_id, scope):
    finding = next((f for f in api.findings(run_id, 'runtime') if f['id'] == finding_id), None)
    if not finding or finding.get('category') != 'OWASP-API1-2023' or finding.get('targetScope') != scope or not finding.get('evidenceIds'):
        raise ValueError('an authoritative, evidence-backed book BOLA finding is required')
    evidence = [api.get_evidence(run_id, key) for key in finding['evidenceIds']]
    if any(e.get('runId') != run_id for e in evidence):
        raise ValueError('finding evidence belongs to another run')
    return {'finding': finding, 'evidence': evidence}


def run_candidate(client, api, target, run_id, finding_id, strategy, model, output: Path,
                  previous_baseline_id=None, crew_factory=build_crew):
    api.approved_run(run_id, target)
    health = api.health()
    finding = get_finding(api, run_id, finding_id, target.scope)
    previous = None
    if strategy == 'scoped-query':
        if not previous_baseline_id:
            raise ValueError('candidate B requires --previous-baseline-evidence from candidate A')
        artifact = api.get_evidence(run_id, previous_baseline_id)
        if artifact.get('runId') != run_id or artifact.get('author') != 'agentA' or not artifact.get('candidateId'):
            raise ValueError('previous baseline must be authoritative candidate A evidence')
        previous = json.loads(artifact['content'])
        state = api.candidate_state(run_id, artifact['candidateId'])
        if state.get('sandboxId') != previous['isolation']['sandboxId'] or not state.get('patchRef'):
            raise ValueError('candidate A has not published its actual repair')
    author = 'agentA' if strategy == 'guard' else 'agentB'
    ledger = Ledger(output / f'{author}-{time.time_ns()}.jsonl', {'runId': run_id, 'author': author})
    runtime = None
    candidate_id = None
    try:
        runtime = create_candidate(client, target, run_id, author,
                                   on_created=lambda sid: ledger.record('sandbox.created', {'sandboxId': sid}))
        if previous:
            compare_report(runtime.baseline_report, previous)
        candidate = api.candidate(run_id, target, runtime.sandbox.id, author, STRATEGIES[strategy], author)
        candidate_id = candidate['id']
        ledger.context.update(candidateId=candidate_id, sandboxId=runtime.sandbox.id)
        api.update_candidate(run_id, candidate_id, status='executing')
        baseline = api.evidence(run_id, 'other', 'Measured vulnerable baseline', runtime.baseline_report, author, candidate_id)
        # Keep command batches bounded; never silently discard outputs from baseline checks.
        evidence_ids = [baseline['id']]
        for row in runtime.commands:
            evidence_ids.append(api.evidence(run_id, 'log', 'Baseline command', row, author, candidate_id)['id'])
        runtime.commands.clear()
        tools = RecoveryTools(runtime, ledger, api, run_id=run_id, candidate_id=candidate_id,
                              author=author, target_scope=target.scope)
        claim = crew_factory(tools, strategy, finding, model).kickoff()
        ledger.record('agent.claim', {'body': str(claim), 'verified': False})
        diff = runtime.patch_diff()
        structure = strategy_evidence(runtime.read_file(EDITABLE_PATH), strategy)
        if not diff or not structure['structurallyObserved']:
            raise ValueError('no actual source patch matching the requested strategy')
        if strategy == 'guard' and not tools.published_findings:
            raise ValueError('Agent A did not publish an evidence-backed observation')
        if strategy == 'scoped-query' and not tools.influenced_patches:
            raise ValueError('Agent B did not retrieve/cite a finding before an actual patch')
        check = runtime.require_action('check')
        startup = runtime.start_ready()
        patch = api.evidence(run_id, 'patch', 'Actual candidate source diff', {'diff': diff, 'structure': structure}, author, candidate_id)
        for row in runtime.commands:
            evidence_ids.append(api.evidence(run_id, 'log', 'Candidate command', row, author, candidate_id)['id'])
        runtime.commands.clear()
        deadline = datetime.now(timezone.utc) + timedelta(minutes=target.retention_minutes)
        handoff = {
            'status': 'VERIFICATION_PENDING', 'verified': False, 'runId': run_id, 'candidateId': candidate_id,
            'sandboxId': runtime.sandbox.id, 'baseline': runtime.baseline_report, 'baselineEvidenceId': baseline['id'],
            'strategy': strategy, 'patchRef': patch['id'], 'patchDiff': diff,
            'evidenceIds': evidence_ids + tools.evidence_ids + [patch['id']],
            'publishedFindingIds': tools.published_findings, 'communication': tools.decision_refs,
            'influencedPatches': tools.influenced_patches, 'startup': startup, 'check': check,
            'access': {'method': 'Hamza uses authorized Daytona SDK access to this private sandbox', 'port': target.inspection_port},
            'retentionDeadline': deadline.isoformat(), 'backendStore': health['store'],
            'acceptance': target.acceptance.model_dump(),
        }
        artifact = api.evidence(run_id, 'other', 'Independent verifier handoff', handoff, author, candidate_id)
        api.update_candidate(run_id, candidate_id, status='verification_pending', patchRef=patch['id'],
                             agentClaim='Actual patch and runtime evidence published. Independent verification pending.')
        path = output / f'{author}-{time.time_ns()}-handoff.json'
        path.write_text(shared_json({**handoff, 'handoffEvidenceId': artifact['id']}))
        ledger.record('handoff.published', {'path': str(path), 'evidenceId': artifact['id']})
        print(shared_json({'handoff': str(path), 'candidateId': candidate_id, 'baselineEvidenceId': baseline['id'],
                           'status': 'VERIFICATION_PENDING', 'retentionDeadline': deadline.isoformat()}), flush=True)
        # Keep the supervisor alive. A verdict signals inspection finished, including UNKNOWN.
        # Provider inactivity cleanup is a fallback if this process is killed, not an absolute TTL.
        expires = time.monotonic() + target.retention_minutes * 60
        while time.monotonic() < expires:
            try:
                if api.candidate_state(run_id, candidate_id).get('verdict'):
                    ledger.record('verifier.finished', {})
                    break
            except Exception as error:
                ledger.record('retention.poll_failed', {'error': type(error).__name__})
            time.sleep(min(5, max(0, expires - time.monotonic())))
        return handoff
    except BaselineError:
        api.abort_comparison(run_id)
        raise
    except Exception as error:
        ledger.record('candidate.failed', {'error': str(error), 'commands': runtime.commands if runtime else []})
        if candidate_id:
            api.update_candidate(run_id, candidate_id, status='failed')
        raise
    finally:
        if runtime:
            client.delete(runtime.sandbox)
            ledger.record('sandbox.cleanup_requested', {'sandboxId': runtime.sandbox.id})
