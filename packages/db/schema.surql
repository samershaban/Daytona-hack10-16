-- RestoreLab schema (SurrealDB 3). Idempotent: safe to re-run.
-- Field names match BUILD_PLAN.md §4 contracts. Keep each statement on ONE line: `surreal sql` reads line by line.
DEFINE NAMESPACE IF NOT EXISTS restorelab;
USE NS restorelab;
DEFINE DATABASE IF NOT EXISTS main;
USE DB main;

-- Human-approved definition of "healthy"
DEFINE TABLE IF NOT EXISTS recovery_contract SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS appVersion            ON recovery_contract TYPE string;
DEFINE FIELD IF NOT EXISTS approvedBy            ON recovery_contract TYPE string;
DEFINE FIELD IF NOT EXISTS requiredOrderIds      ON recovery_contract TYPE array<string>;
DEFINE FIELD IF NOT EXISTS minLatestOrderMarker  ON recovery_contract TYPE string;
DEFINE FIELD IF NOT EXISTS expectedSchemaVersion ON recovery_contract TYPE string;
DEFINE FIELD IF NOT EXISTS maxDataLossSeconds    ON recovery_contract TYPE int;
DEFINE FIELD IF NOT EXISTS checks                ON recovery_contract TYPE array<string> ASSERT $value.all(|$c| $c IN ['db_integrity', 'data_freshness', 'api', 'login', 'browser']);

-- The injected disaster
DEFINE TABLE IF NOT EXISTS scenario SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS name         ON scenario TYPE string;
DEFINE FIELD IF NOT EXISTS failureModes ON scenario TYPE array<string>;
DEFINE FIELD IF NOT EXISTS injectScript ON scenario TYPE string;

-- One drill. Status transitions are enforced in src/index.ts.
DEFINE TABLE IF NOT EXISTS run SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS status             ON run TYPE string DEFAULT 'CREATED' ASSERT $value IN ['CREATED', 'INSPECTING', 'AWAITING_SCOPE_APPROVAL', 'PREPARING', 'RUNNING', 'VERIFYING', 'COMPLETE', 'NO_VERIFIED_RECOVERY', 'FAILED', 'CANCELLED'];
DEFINE FIELD IF NOT EXISTS scenarioId         ON run TYPE record<scenario>;
DEFINE FIELD IF NOT EXISTS contractId         ON run TYPE record<recovery_contract>;
DEFINE FIELD IF NOT EXISTS appVersion         ON run TYPE string;
DEFINE FIELD IF NOT EXISTS fixtureFingerprint ON run TYPE string;
DEFINE FIELD IF NOT EXISTS winnerCandidateId  ON run TYPE option<record<candidate>>;
DEFINE FIELD IF NOT EXISTS eventSeq           ON run TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS createdAt          ON run TYPE datetime DEFAULT time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updatedAt          ON run TYPE datetime VALUE time::now();

-- Append-only event trail (RunEvent). seq comes from run.eventSeq.
DEFINE TABLE IF NOT EXISTS run_event SCHEMAFULL; -- append-only: index.ts has no update/delete for it
DEFINE FIELD IF NOT EXISTS runId       ON run_event TYPE record<run>;
DEFINE FIELD IF NOT EXISTS seq         ON run_event TYPE int;
DEFINE FIELD IF NOT EXISTS at          ON run_event TYPE datetime DEFAULT time::now() READONLY;
DEFINE FIELD IF NOT EXISTS type        ON run_event TYPE string;
DEFINE FIELD IF NOT EXISTS source      ON run_event TYPE string ASSERT $value IN ['infra', 'agents', 'orchestrator', 'verifier'];
DEFINE FIELD IF NOT EXISTS candidateId ON run_event TYPE option<record<candidate>>;
DEFINE FIELD IF NOT EXISTS payload     ON run_event TYPE any;
DEFINE INDEX IF NOT EXISTS event_seq ON run_event FIELDS runId, seq UNIQUE;

-- One recovery branch (CandidateResult + bookkeeping)
DEFINE TABLE IF NOT EXISTS candidate SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS runId                ON candidate TYPE record<run>;
DEFINE FIELD IF NOT EXISTS label                ON candidate TYPE string;
DEFINE FIELD IF NOT EXISTS strategy             ON candidate TYPE string;
DEFINE FIELD IF NOT EXISTS sandboxId            ON candidate TYPE string;
DEFINE FIELD IF NOT EXISTS baselineFingerprint  ON candidate TYPE string;
DEFINE FIELD IF NOT EXISTS startedAt            ON candidate TYPE datetime DEFAULT time::now() READONLY;
DEFINE FIELD IF NOT EXISTS verifiedAt           ON candidate TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS elapsedMs            ON candidate TYPE option<int>;
DEFINE FIELD IF NOT EXISTS checks               ON candidate TYPE object FLEXIBLE DEFAULT {};
DEFINE FIELD IF NOT EXISTS verdict              ON candidate TYPE string DEFAULT 'INCOMPLETE' ASSERT $value IN ['PASS', 'FAIL', 'INCOMPLETE'];
DEFINE FIELD IF NOT EXISTS rejectedReasons      ON candidate TYPE array<string> DEFAULT [];
DEFINE FIELD IF NOT EXISTS traceRefs            ON candidate TYPE array<string> DEFAULT [];
DEFINE FIELD IF NOT EXISTS agentClaim           ON candidate TYPE option<string>;
DEFINE FIELD IF NOT EXISTS forbiddenOpAttempted ON candidate TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS dataLossSeconds      ON candidate TYPE option<int>;
DEFINE FIELD IF NOT EXISTS riskScore            ON candidate TYPE option<float>;
DEFINE FIELD IF NOT EXISTS costUsd              ON candidate TYPE option<float>;
DEFINE FIELD IF NOT EXISTS actionSeq            ON candidate TYPE int DEFAULT 0;
DEFINE INDEX IF NOT EXISTS cand_run ON candidate FIELDS runId, label UNIQUE;

-- Audit log of every tool call an agent made (refused ones too)
DEFINE TABLE IF NOT EXISTS tool_action SCHEMAFULL; -- append-only: index.ts has no update/delete for it
DEFINE FIELD IF NOT EXISTS candidateId ON tool_action TYPE record<candidate>;
DEFINE FIELD IF NOT EXISTS seq         ON tool_action TYPE int;
DEFINE FIELD IF NOT EXISTS tool        ON tool_action TYPE string;
DEFINE FIELD IF NOT EXISTS command     ON tool_action TYPE string;
DEFINE FIELD IF NOT EXISTS exitCode    ON tool_action TYPE option<int>;
DEFINE FIELD IF NOT EXISTS output      ON tool_action TYPE option<string>;
DEFINE FIELD IF NOT EXISTS durationMs  ON tool_action TYPE option<int>;
DEFINE FIELD IF NOT EXISTS refused     ON tool_action TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS at          ON tool_action TYPE datetime DEFAULT time::now() READONLY;
DEFINE INDEX IF NOT EXISTS action_seq ON tool_action FIELDS candidateId, seq UNIQUE;

-- Mesh-shared knowledge (Finding). OBSERVED until independently checked.
DEFINE TABLE IF NOT EXISTS finding SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS runId                  ON finding TYPE record<run>;
DEFINE FIELD IF NOT EXISTS authorAgentId          ON finding TYPE string;
DEFINE FIELD IF NOT EXISTS authorCandidateId      ON finding TYPE option<record<candidate>>;
DEFINE FIELD IF NOT EXISTS appVersion             ON finding TYPE string;
DEFINE FIELD IF NOT EXISTS environmentFingerprint ON finding TYPE string;
DEFINE FIELD IF NOT EXISTS claim                  ON finding TYPE string;
DEFINE FIELD IF NOT EXISTS evidenceRefs           ON finding TYPE array<string> ASSERT array::len($value) > 0;
DEFINE FIELD IF NOT EXISTS observedAt             ON finding TYPE datetime DEFAULT time::now() READONLY;
DEFINE FIELD IF NOT EXISTS scope                  ON finding TYPE string ASSERT $value IN ['run', 'app_version'];
DEFINE FIELD IF NOT EXISTS status                 ON finding TYPE string DEFAULT 'OBSERVED' ASSERT $value IN ['OBSERVED', 'VERIFIED', 'REJECTED'];

-- Human gate: drill scope, recipes, consequential actions. One decision per subject.
DEFINE TABLE IF NOT EXISTS approval SCHEMAFULL; -- append-only: index.ts has no update/delete for it
DEFINE FIELD IF NOT EXISTS runId    ON approval TYPE record<run>;
DEFINE FIELD IF NOT EXISTS kind     ON approval TYPE string ASSERT $value IN ['SCOPE', 'RECIPE', 'ACTION'];
DEFINE FIELD IF NOT EXISTS subject  ON approval TYPE string;
DEFINE FIELD IF NOT EXISTS approver ON approval TYPE string;
DEFINE FIELD IF NOT EXISTS decision ON approval TYPE string ASSERT $value IN ['APPROVED', 'DENIED'];
DEFINE FIELD IF NOT EXISTS note     ON approval TYPE option<string>;
DEFINE FIELD IF NOT EXISTS at       ON approval TYPE datetime DEFAULT time::now() READONLY;
DEFINE INDEX IF NOT EXISTS approval_once ON approval FIELDS runId, kind, subject UNIQUE;

-- Verified, versioned runbook
DEFINE TABLE IF NOT EXISTS recipe SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS scenarioId        ON recipe TYPE record<scenario>;
DEFINE FIELD IF NOT EXISTS appVersion        ON recipe TYPE string;
DEFINE FIELD IF NOT EXISTS sourceCandidateId ON recipe TYPE record<candidate>;
DEFINE FIELD IF NOT EXISTS version           ON recipe TYPE int;
DEFINE FIELD IF NOT EXISTS steps             ON recipe TYPE array<string>;
DEFINE FIELD IF NOT EXISTS rollback          ON recipe TYPE array<string>;
DEFINE FIELD IF NOT EXISTS risks             ON recipe TYPE array<string> DEFAULT [];
DEFINE FIELD IF NOT EXISTS evidenceRefs      ON recipe TYPE array<string> DEFAULT [];
DEFINE FIELD IF NOT EXISTS status            ON recipe TYPE string DEFAULT 'PROPOSED' ASSERT $value IN ['PROPOSED', 'APPROVED', 'SUPERSEDED', 'REJECTED'];
DEFINE FIELD IF NOT EXISTS createdAt         ON recipe TYPE datetime DEFAULT time::now() READONLY;
DEFINE INDEX IF NOT EXISTS recipe_ver ON recipe FIELDS scenarioId, version UNIQUE;

-- Graph edges (provenance)
DEFINE TABLE IF NOT EXISTS cites      TYPE RELATION IN candidate OUT finding;   -- agent read + reused another's finding
DEFINE TABLE IF NOT EXISTS retested   TYPE RELATION IN candidate OUT finding;   -- agent re-checked it locally; outcome on edge
DEFINE FIELD IF NOT EXISTS held ON retested TYPE bool;
DEFINE TABLE IF NOT EXISTS supersedes TYPE RELATION IN recipe OUT recipe;
DEFINE TABLE IF NOT EXISTS reused     TYPE RELATION IN candidate OUT recipe;    -- replay run started from a recipe
