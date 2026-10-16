-- RestoreLab API schema (SurrealDB 3). Idempotent: applied on every connect.
-- Keep each statement on ONE line: `surreal sql` reads line by line.
-- Documents are the @restorelab/contracts shapes; the record key is the contract id (verdict: its candidateId).
DEFINE NAMESPACE IF NOT EXISTS restorelab;
USE NS restorelab;
DEFINE DATABASE IF NOT EXISTS api;
USE DB api;

-- Documents. Rules are enforced by the API (packages/api/src/service.ts); the DB guards shape and ordering.
DEFINE TABLE IF NOT EXISTS run SCHEMALESS;
DEFINE FIELD IF NOT EXISTS status ON run TYPE string ASSERT $value IN ['created', 'awaiting_scope_approval', 'investigating', 'experimenting', 'verifying', 'completed', 'failed', 'unknown'];
DEFINE FIELD IF NOT EXISTS eventSeq ON run TYPE int DEFAULT 0;

DEFINE TABLE IF NOT EXISTS run_event SCHEMALESS;
DEFINE INDEX IF NOT EXISTS run_event_seq ON run_event FIELDS runId, seq UNIQUE;

DEFINE TABLE IF NOT EXISTS finding SCHEMALESS;
DEFINE FIELD IF NOT EXISTS evidenceIds ON finding TYPE array<string> ASSERT array::len($value) > 0;
DEFINE INDEX IF NOT EXISTS finding_run ON finding FIELDS runId;

DEFINE TABLE IF NOT EXISTS message SCHEMALESS;
DEFINE INDEX IF NOT EXISTS message_run ON message FIELDS runId;

DEFINE TABLE IF NOT EXISTS candidate SCHEMALESS;
DEFINE INDEX IF NOT EXISTS candidate_run ON candidate FIELDS runId;

DEFINE TABLE IF NOT EXISTS verdict SCHEMALESS;
DEFINE FIELD IF NOT EXISTS decision ON verdict TYPE string ASSERT $value IN ['pass', 'fail', 'unknown'];
DEFINE INDEX IF NOT EXISTS verdict_run ON verdict FIELDS runId;

DEFINE TABLE IF NOT EXISTS approval SCHEMALESS;
DEFINE INDEX IF NOT EXISTS approval_run ON approval FIELDS runId;

DEFINE TABLE IF NOT EXISTS evidence SCHEMALESS;
DEFINE INDEX IF NOT EXISTS evidence_run ON evidence FIELDS runId;

-- Provenance graph, written alongside the documents:
--   message ->cites-> finding ->supported_by-> evidence
--   candidate ->judged_by-> verdict ->checked_with-> evidence
-- e.g. which evidence backs agentB's decision:
--   SELECT ->cites->finding->supported_by->evidence.* AS evidence FROM message WHERE from = 'agentB' AND type = 'decision';
DEFINE TABLE IF NOT EXISTS cites TYPE RELATION IN message OUT finding;
DEFINE TABLE IF NOT EXISTS supported_by TYPE RELATION IN finding OUT evidence;
DEFINE TABLE IF NOT EXISTS judged_by TYPE RELATION IN candidate OUT verdict;
DEFINE TABLE IF NOT EXISTS checked_with TYPE RELATION IN verdict OUT evidence;
