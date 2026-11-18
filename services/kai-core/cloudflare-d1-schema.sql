-- ACC HQ isolated namespace in existing kai-independent-lab D1.
-- Do not modify or delete drafts, evidence, memories, or messages.
CREATE TABLE IF NOT EXISTS acc_hq_goals (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, division TEXT NOT NULL,
 priority TEXT NOT NULL DEFAULT 'NORMAL', status TEXT NOT NULL DEFAULT 'ROUTING',
 created_at TEXT NOT NULL, payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS acc_hq_tasks (
 id TEXT PRIMARY KEY, goal_id TEXT, title TEXT NOT NULL,
 agent_id TEXT NOT NULL, division TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'CREATED', progress INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS acc_hq_approvals (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'WAITING_OWNER',
 created_at TEXT NOT NULL, resolved_at TEXT, decision TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS acc_hq_events (
 id TEXT PRIMARY KEY, event_type TEXT NOT NULL,
 created_at TEXT NOT NULL, payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS acc_hq_events_recent ON acc_hq_events(created_at DESC);
