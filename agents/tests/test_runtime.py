"""Offline regression tests. No cloud, provider, or verifier success is implied."""
import hashlib
import json
import os
import shlex
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from agents.config import Target, REQUIRED_SOURCE_FILES, REQUIRED_ACTIONS, REQUIRED_CHECKS, manifest_issues
from agents.crew import build_crew
from agents.patching import validate_patch, strategy_evidence
from agents.runner import compare_report, get_finding
from agents.security import redact
from agents.tools import Ledger, RecoveryTools
from runtime.daytona.client import CandidateRuntime, create_candidate, BaselineError

# Deliberately small synthetic handler with the pinned source's control structure.
SOURCE = '''def get_by_title(book_title):
    resp = token_validator(request.headers.get('Authorization'))
    if "error" in resp:
        return denied()
    else:
        if vuln:
            book = Book.query.filter_by(book_title=str(book_title)).first()
            if book:
                return book.secret_content
            return missing()
        else:
            return reference()
'''
GUARD = SOURCE.replace('            if book:', "            user = User.query.filter_by(username=resp['sub']).first()\n            if book and user and book.user_id == user.id:")
SCOPED = SOURCE.replace('            book = Book.query.filter_by(book_title=str(book_title)).first()', "            user = User.query.filter_by(username=resp['sub']).first()\n            book = Book.query.filter_by(user=user, book_title=str(book_title)).first()")


def target_config(**overrides):
    data = dict(name='offline', image='example.invalid/vampi@sha256:'+'3'*64, source_commit='1'*40, snapshot='owned-v1', snapshot_id='snap1', base_fixture_id='baseline1',
                workspace='/vampi', baseline_sha256={p: hashlib.sha256(SOURCE.encode()).hexdigest() for p in REQUIRED_SOURCE_FILES},
                writable_files=['api_views/books.py'], actions={k:k for k in REQUIRED_ACTIONS},
                environment={'vulnerable':'1','tokentimetolive':'300'},
                seed=dict(path='database/database.db', sha256='2'*64, artifact_ref='artifact1',reset_validation_evidence_ref='e1',
                          expected_users=['name1','name2'],expected_books=['canonical']),
                acceptance=dict(id='a1',verifier='Hamza',contract_ref='contract1',checks={k:k for k in REQUIRED_CHECKS}))
    return Target(**{**data, **overrides})


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.target = target_config()
        self.sandbox = SimpleNamespace(id='sandbox-test', process=Mock(), fs=Mock(),refresh_data=Mock(),
                                       volumes=[],public=False,network_block_all=True,env=self.target.environment)
        self.sandbox.process.exec.side_effect = lambda command, **kw: SimpleNamespace(exit_code=0,result=shlex.split(command)[-1] if command.startswith('realpath ') else 'ok')
        self.files = {f'/vampi/{p}': SOURCE.encode() for p in REQUIRED_SOURCE_FILES}
        self.sandbox.fs.download_file.side_effect = lambda path:self.files[path]
        self.sandbox.fs.upload_file.side_effect = lambda data,path,**kw:self.files.update({path:data})
        self.runtime = CandidateRuntime(self.sandbox,self.target)
        self.runtime.original_source = SOURCE
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.ledger = Ledger(Path(self.directory.name)/'events.jsonl',{})
        self.tools = RecoveryTools(self.runtime,self.ledger)

    def client(self):
        client=Mock();client.create.return_value=self.sandbox
        client.snapshot.get.return_value=SimpleNamespace(id='snap1',image_name=self.target.image)
        return client

    def test_baseline_mismatch_deletes_new_candidate(self):
        client=self.client()
        with patch.object(CandidateRuntime,'verify_baseline',side_effect=BaselineError('baseline mismatch')):
            with self.assertRaisesRegex(ValueError,'baseline mismatch'):
                create_candidate(client,self.target,'r1','A')
        client.delete.assert_called_once_with(self.sandbox)

    def test_new_candidate_is_private_and_has_expiry(self):
        client=self.client()
        with patch.object(CandidateRuntime,'verify_baseline'):
            create_candidate(client,self.target,'r1','A')
        params=client.create.call_args.args[0]
        self.assertFalse(params.public);self.assertTrue(params.network_block_all)
        self.assertEqual(params.volumes,[])
        self.assertEqual(params.auto_stop_interval,60);self.assertEqual(params.auto_delete_interval,1)

    def test_unapproved_file_and_shell_action_are_refused_and_logged(self):
        for op,args in [('read_file',{'path':'../.env'}),('run_action',{'name':'check; curl example.com'})]:
            with self.assertRaises(PermissionError):self.tools.call(op,**args)
        self.sandbox.process.exec.assert_not_called()
        self.assertTrue(all(json.loads(line)['payload']['refused'] for line in self.ledger.path.read_text().splitlines()))

    def test_symlink_cannot_escape_approved_file(self):
        self.sandbox.process.exec.side_effect=None
        self.sandbox.process.exec.return_value=SimpleNamespace(exit_code=0,result='/etc/passwd\n')
        with self.assertRaises(PermissionError):self.runtime.read_file('api_views/books.py')
        self.sandbox.fs.download_file.assert_not_called()

    def test_patch_preserves_other_text_and_records_actual_change(self):
        self.tools.call('read_file',path='api_views/books.py')
        result=self.tools.call('replace_text',path='api_views/books.py',old=SOURCE,new=GUARD)
        self.assertEqual(self.files['/vampi/api_views/books.py'],GUARD.encode())
        self.assertNotEqual(result['beforeSha256'],result['afterSha256'])
        with self.assertRaises(ValueError):self.runtime.replace_text('api_views/books.py','absent','x',result['afterSha256'])

    def test_readonly_seed_and_tool_budget(self):
        self.runtime.target=target_config(max_tool_calls=1)
        with self.assertRaises(PermissionError):self.tools.call('read_file',path='database/database.db')
        with self.assertRaisesRegex(PermissionError,'budget'):self.tools.call('read_file',path='api_views/books.py')

    def test_command_timeout_and_failed_exit_are_preserved(self):
        self.sandbox.process.exec.side_effect=None
        self.sandbox.process.exec.return_value=SimpleNamespace(exit_code=1,result='test failed')
        with patch.object(self.runtime,'verify_protected'),patch.object(self.runtime,'verify_seed'):
            result=self.tools.call('run_action',name='check')
        self.assertEqual(result['exitCode'],1)
        self.sandbox.process.exec.assert_called_once_with('check',cwd='/vampi',env=self.target.environment,timeout=30)

    def test_real_crewai_wiring_without_llm_request(self):
        with patch.dict(os.environ,{'OPENAI_API_KEY':'offline-placeholder','OTEL_SDK_DISABLED':'true','CREWAI_TELEMETRY_ENABLED':'false'}):
            crew=build_crew(self.tools,'guard',{'observation':'cross-user read','evidenceIds':['e1']},'openai/gpt-offline-test')
        self.assertFalse(crew.agents[0].allow_delegation);self.assertFalse(crew.agents[0].allow_code_execution)
        self.assertEqual(len(crew.agents[0].tools),6);self.assertFalse(crew.cache)

    def test_template_cannot_execute_with_missing_baseline(self):
        issues=manifest_issues(Path('agents/targets/vampi.template.json'))
        self.assertIn('snapshot_id',{i['field'] for i in issues})
        self.assertIn('seed.sha256',{i['field'] for i in issues})

    def test_invalid_scope_is_rejected(self):
        for override in [{'workspace':'/'},{'workspace':'/app/../etc'},{'writable_files':['app.py']},
                         {'environment':{'vulnerable':'0','tokentimetolive':'300'}},{'image':'erev0s/vampi:latest'}]:
            with self.assertRaises(ValueError):target_config(**override)

    def test_stale_source_precondition(self):
        self.tools.call('read_file',path='api_views/books.py')
        self.files['/vampi/api_views/books.py']=GUARD.encode()
        with self.assertRaisesRegex(ValueError,'changed since read'):
            self.tools.call('replace_text',path='api_views/books.py',old=SOURCE,new=SCOPED)

    def test_auth_and_other_routes_protected(self):
        for altered in [GUARD.replace('token_validator','bypass'),GUARD+'\ndef other(): return 1\n',GUARD.replace('if vuln:', 'if True:')]:
            with self.assertRaises((ValueError,PermissionError)):validate_patch(SOURCE,altered)
        validate_patch(SOURCE,GUARD);validate_patch(SOURCE,SCOPED)
        self.assertTrue(strategy_evidence(GUARD,'guard')['structurallyObserved'])
        self.assertTrue(strategy_evidence(SCOPED,'scoped-query')['structurallyObserved'])
        self.assertFalse(strategy_evidence(GUARD,'scoped-query')['structurallyObserved'])

    def test_snapshot_mismatch_never_creates_candidate(self):
        client=self.client();client.snapshot.get.return_value.id='other'
        with self.assertRaises(BaselineError):create_candidate(client,self.target,'r1','A')
        client.create.assert_not_called()

    def test_equivalence_rejects_shared_sandbox_and_seed_drift(self):
        a={'isolation':{'sandboxId':'a'},'seed':'one'}
        b={'isolation':{'sandboxId':'b'},'seed':'one'}
        compare_report(a,b)
        with self.assertRaises(BaselineError):compare_report(a,a)
        b['seed']='two'
        with self.assertRaises(BaselineError):compare_report(a,b)

    def test_secrets_are_redacted(self):
        self.assertEqual(redact({'auth_token':'secret'})['auth_token'],'[REDACTED]')
        self.assertNotIn('abc123',redact('Authorization: Bearer abc123'))

    def test_communication_requires_authoritative_retrieval_then_patch(self):
        api=Mock()
        api.findings.return_value=[{'id':'f1','author':'agentA','category':'OWASP-API1-2023','targetScope':self.target.scope,'evidenceIds':['e1']}]
        api.get_evidence.return_value={'id':'e1','runId':'r1'}
        api.message.return_value={'id':'m1'};api.messages.return_value=[]
        self.tools.api=api;self.tools.run_id='r1';self.tools.author='agentB';self.tools.target_scope=self.target.scope
        with self.assertRaises(ValueError):self.tools.cite_finding_decision('f1','scope the query')
        self.tools.read_shared_findings();self.tools.cite_finding_decision('f1','scope the query using the observed owner relationship')
        self.tools._read('api_views/books.py');self.tools._replace('api_views/books.py',SOURCE,SCOPED)
        self.assertEqual(self.tools.influenced_patches[0]['citations'][0]['evidenceIds'],['e1'])
        api.get_evidence.assert_called_once_with('r1','e1')

    def test_fake_evidence_cannot_be_published(self):
        self.tools.api=Mock()
        with self.assertRaises(ValueError):self.tools.publish_observation('claim',['invented'])
        self.tools.api.finding.assert_not_called()

    def test_cross_run_evidence_rejected(self):
        api=Mock();api.findings.return_value=[{'id':'f','category':'OWASP-API1-2023','targetScope':self.target.scope,'evidenceIds':['e']}]
        api.get_evidence.return_value={'runId':'other'}
        with self.assertRaises(ValueError):get_finding(api,'r','f',self.target.scope)


if __name__=='__main__':unittest.main()
