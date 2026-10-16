-- RestoreLab schema (SurrealDB 3). Idempotent: safe to re-run.
DEFINE NAMESPACE IF NOT EXISTS restorelab;
USE NS restorelab;
DEFINE DATABASE IF NOT EXISTS main;
USE DB main;

-- What we're protecting
DEFINE TABLE IF NOT EXISTS app_version SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS name       ON app_version TYPE string;
DEFINE FIELD IF NOT EXISTS git_sha    ON app_version TYPE string;
DEFINE FIELD IF NOT EXISTS components ON app_version TYPE object FLEXIBLE; -- e.g. { postgres: "16.4", pg_dump: "15.2" }
DEFINE FIELD IF NOT EXISTS created_at ON app_version TYPE datetime DEFAULT time::now();

-- Human-approved definition of "healthy"
DEFINE TABLE IF NOT EXISTS recovery_contract SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS app         ON recovery_contract TYPE record<app_version>;
DEFINE FIELD IF NOT EXISTS version     ON recovery_contract TYPE int;
DEFINE FIELD IF NOT EXISTS checks      ON recovery_contract TYPE array<object> FLEXIBLE; -- [{ id, kind: "sql"|"api"|"browser", spec }]
DEFINE FIELD IF NOT EXISTS rto_seconds ON recovery_contract TYPE int;
DEFINE FIELD IF NOT EXISTS rpo_seconds ON recovery_contract TYPE int;
DEFINE FIELD IF NOT EXISTS approved_by ON recovery_contract TYPE option<string>;
DEFINE INDEX IF NOT EXISTS contract_ver ON recovery_contract FIELDS app, version UNIQUE;

-- The injected disaster
DEFINE TABLE IF NOT EXISTS scenario SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS name          ON scenario TYPE string;
DEFINE FIELD IF NOT EXISTS failure_modes ON scenario TYPE array<string>;
DEFINE FIELD IF NOT EXISTS inject_script ON scenario TYPE string;

-- One experiment = one scenario against one contract
DEFINE TABLE IF NOT EXISTS experiment_run SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS scenario      ON experiment_run TYPE record<scenario>;
DEFINE FIELD IF NOT EXISTS contract      ON experiment_run TYPE record<recovery_contract>;
DEFINE FIELD IF NOT EXISTS base_snapshot ON experiment_run TYPE string; -- Daytona snapshot id
DEFINE FIELD IF NOT EXISTS status        ON experiment_run TYPE string DEFAULT "running" ASSERT $value IN ["running", "verifying", "done", "failed"];
DEFINE FIELD IF NOT EXISTS winner        ON experiment_run TYPE option<record<candidate>>;
DEFINE FIELD IF NOT EXISTS started_at    ON experiment_run TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS finished_at   ON experiment_run TYPE option<datetime>;

-- One recovery agent's attempt, in its own sandbox
DEFINE TABLE IF NOT EXISTS candidate SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS run         ON candidate TYPE record<experiment_run>;
DEFINE FIELD IF NOT EXISTS label       ON candidate TYPE string;        -- "A" | "B" | "C"
DEFINE FIELD IF NOT EXISTS strategy    ON candidate TYPE string;
DEFINE FIELD IF NOT EXISTS sandbox_id  ON candidate TYPE string;
DEFINE FIELD IF NOT EXISTS status      ON candidate TYPE string DEFAULT "running" ASSERT $value IN ["running", "claimed_done", "passed", "rejected", "error"];
DEFINE FIELD IF NOT EXISTS reject_reasons ON candidate TYPE array<string> DEFAULT [];
DEFINE FIELD IF NOT EXISTS metrics     ON candidate TYPE object FLEXIBLE DEFAULT {}; -- { recovery_seconds, rows_lost, cost_usd }
DEFINE FIELD IF NOT EXISTS arize_trace ON candidate TYPE option<string>;
DEFINE FIELD IF NOT EXISTS started_at  ON candidate TYPE datetime DEFAULT time::now();
DEFINE INDEX IF NOT EXISTS cand_run ON candidate FIELDS run;

-- Every command an agent ran (audit log)
DEFINE TABLE IF NOT EXISTS tool_trace SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS candidate   ON tool_trace TYPE record<candidate>;
DEFINE FIELD IF NOT EXISTS seq         ON tool_trace TYPE int;
DEFINE FIELD IF NOT EXISTS command     ON tool_trace TYPE string;
DEFINE FIELD IF NOT EXISTS exit_code   ON tool_trace TYPE option<int>;
DEFINE FIELD IF NOT EXISTS output      ON tool_trace TYPE option<string>;
DEFINE FIELD IF NOT EXISTS duration_ms ON tool_trace TYPE option<int>;
DEFINE FIELD IF NOT EXISTS at          ON tool_trace TYPE datetime DEFAULT time::now();
DEFINE INDEX IF NOT EXISTS trace_cand ON tool_trace FIELDS candidate, seq;

-- Verifier output: one row per contract check per candidate
DEFINE TABLE IF NOT EXISTS evidence SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS candidate ON evidence TYPE record<candidate>;
DEFINE FIELD IF NOT EXISTS check_id  ON evidence TYPE string;
DEFINE FIELD IF NOT EXISTS kind      ON evidence TYPE string ASSERT $value IN ["sql", "api", "browser"];
DEFINE FIELD IF NOT EXISTS passed    ON evidence TYPE bool;
DEFINE FIELD IF NOT EXISTS detail    ON evidence TYPE option<string>;
DEFINE FIELD IF NOT EXISTS artifact_url ON evidence TYPE option<string>; -- Anchor screenshot etc.
DEFINE FIELD IF NOT EXISTS at        ON evidence TYPE datetime DEFAULT time::now();

-- Verified, reusable procedure
DEFINE TABLE IF NOT EXISTS recipe SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS scenario    ON recipe TYPE record<scenario>;
DEFINE FIELD IF NOT EXISTS source      ON recipe TYPE record<candidate>;
DEFINE FIELD IF NOT EXISTS version     ON recipe TYPE int;
DEFINE FIELD IF NOT EXISTS steps       ON recipe TYPE array<string>;
DEFINE FIELD IF NOT EXISTS rollback    ON recipe TYPE array<string>;
DEFINE FIELD IF NOT EXISTS risks       ON recipe TYPE array<string> DEFAULT [];
DEFINE FIELD IF NOT EXISTS status      ON recipe TYPE string DEFAULT "proposed" ASSERT $value IN ["proposed", "approved", "superseded", "rejected"];

-- Human gate
DEFINE TABLE IF NOT EXISTS approval SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS recipe   ON approval TYPE record<recipe>;
DEFINE FIELD IF NOT EXISTS approver ON approval TYPE string;
DEFINE FIELD IF NOT EXISTS decision ON approval TYPE string ASSERT $value IN ["approved", "rejected"];
DEFINE FIELD IF NOT EXISTS note     ON approval TYPE option<string>;
DEFINE FIELD IF NOT EXISTS at       ON approval TYPE datetime DEFAULT time::now();

-- Knowledge Agent memory: findings, failed attempts, version compat
DEFINE TABLE IF NOT EXISTS observation SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS kind     ON observation TYPE string ASSERT $value IN ["finding", "failed_attempt", "compat"];
DEFINE FIELD IF NOT EXISTS text     ON observation TYPE string;
DEFINE FIELD IF NOT EXISTS source   ON observation TYPE record<candidate>; -- provenance
DEFINE FIELD IF NOT EXISTS verified ON observation TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS tags     ON observation TYPE array<string> DEFAULT [];
DEFINE FIELD IF NOT EXISTS at       ON observation TYPE datetime DEFAULT time::now();

-- Graph edges
DEFINE TABLE IF NOT EXISTS cites      TYPE RELATION IN candidate OUT observation; -- Agent B used A's finding
DEFINE TABLE IF NOT EXISTS supersedes TYPE RELATION IN recipe    OUT recipe;
DEFINE TABLE IF NOT EXISTS reused     TYPE RELATION IN candidate OUT recipe;      -- replay run reused a recipe
