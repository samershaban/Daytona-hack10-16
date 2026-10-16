"""Orchestration tests use doubles, never a live success claim."""
import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from agents.api import RunApi, ApiError
from agents.runner import run_candidate
from test_runtime import target_config, GUARD


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.api = Mock()
        self.api.health.return_value = {'ok': True, 'store': 'memory'}
        self.api.findings.return_value = [{'id':'f1','category':'OWASP-API1-2023','targetScope':'GET /books/v1/{title}','evidenceIds':['e1']}]
        self.api.get_evidence.return_value = {'runId':'r1'}
        self.api.candidate.return_value = {'id':'c1'}
        self.api.evidence.return_value = {'id':'e2'}
        self.api.candidate_state.return_value = {'verdict':{'decision':'unknown'}}
        self.runtime = Mock()
        self.runtime.sandbox.id='s1'
        self.runtime.target=target_config()
        self.runtime.baseline_report={'isolation':{'sandboxId':'s1'}}
        self.runtime.commands=[]
        self.runtime.patch_diff.return_value='actual mocked diff'
        self.runtime.read_file.return_value=GUARD
        self.runtime.require_action.return_value={'exitCode':0}
        self.runtime.start_ready.return_value=[{'exitCode':0}]
        self.client=Mock()

    def factory(self, tools, *args):
        def kickoff():
            tools.published_findings.append('f2')
            return 'This text cannot establish PASS'
        return SimpleNamespace(kickoff=kickoff)

    def run_it(self, factory):
        with tempfile.TemporaryDirectory() as directory, patch('agents.runner.create_candidate',return_value=self.runtime), contextlib.redirect_stdout(io.StringIO()):
            return run_candidate(self.client,self.api,self.runtime.target,'r1','f1','guard','offline',Path(directory),crew_factory=factory)

    def test_handoff_stays_pending_even_with_unknown_verdict_and_cleans_up(self):
        handoff=self.run_it(self.factory)
        self.assertEqual(handoff['status'],'VERIFICATION_PENDING')
        self.assertFalse(handoff['verified'])
        self.assertEqual(handoff['backendStore'],'memory')
        self.client.delete.assert_called_once_with(self.runtime.sandbox)
        self.assertEqual(self.api.update_candidate.call_args.kwargs['status'],'verification_pending')

    def test_text_without_patch_cannot_reach_handoff(self):
        self.runtime.patch_diff.return_value=''
        with self.assertRaisesRegex(ValueError,'no actual source patch'): self.run_it(self.factory)
        self.client.delete.assert_called_once()
        self.assertEqual(self.api.update_candidate.call_args.kwargs['status'],'failed')

    def test_unapproved_run_does_not_create_sandbox(self):
        self.api.approved_run.side_effect=ApiError('not approved')
        with self.assertRaises(ApiError),patch('agents.runner.create_candidate') as create:
            self.run_it(self.factory)
        create.assert_not_called()

    def test_adapter_uses_real_role_and_encoded_path(self):
        api=RunApi('http://localhost:3000')
        api.request=Mock(return_value={'id':'m1'})
        api.message('run:1','agentB','room','decision','Use the observed owner relationship',['f1'])
        args=api.request.call_args.args
        self.assertEqual(args[1],'/runs/run%3A1/messages')
        self.assertEqual(args[2]['findingIds'],['f1'])
        with self.assertRaises(ApiError): api.update_candidate('r','c',status='done')

    def test_adapter_requires_human_scope_approval(self):
        api=RunApi('http://localhost:3000')
        target=target_config()
        api.request=Mock(side_effect=[{'baseFixtureId':target.base_fixture_id,'targetVersion':target.source_commit,'status':'investigating'},[]])
        with self.assertRaisesRegex(ApiError,'no human scope approval'):api.approved_run('r',target)
