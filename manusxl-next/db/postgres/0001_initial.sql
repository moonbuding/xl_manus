BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  phone TEXT UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL,
  verification_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error TEXT,
  final_answer TEXT,
  data_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS task_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  owner_id TEXT,
  type TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  title TEXT,
  content TEXT,
  payload_json JSONB,
  created_at TEXT NOT NULL,
  data_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS task_files (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  owner_id TEXT,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  path TEXT,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  data_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS uploaded_files (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  extension TEXT NOT NULL,
  size INTEGER NOT NULL,
  stored_path TEXT NOT NULL,
  text_preview TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata_json JSONB NOT NULL,
  created_at TEXT NOT NULL,
  data_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  url TEXT,
  command TEXT,
  args_json JSONB NOT NULL,
  env_json JSONB NOT NULL,
  enabled INTEGER NOT NULL,
  status TEXT NOT NULL,
  status_message TEXT NOT NULL,
  tools_json JSONB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_settings (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  skill_id TEXT,
  enabled INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_templates (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  prompt_template TEXT NOT NULL,
  default_model TEXT,
  tags_json JSONB NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS context_metrics (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  stage TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prefix_hash TEXT NOT NULL,
  prefix_tokens INTEGER NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  cache_hit_rate DOUBLE PRECISION NOT NULL,
  estimated_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  estimated_cost_cny DOUBLE PRECISION NOT NULL DEFAULT 0,
  stable_prefix_reused INTEGER NOT NULL,
  fallback_used INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  data_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_owner_id ON tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_task_steps_task_id ON task_steps(task_id);
CREATE INDEX IF NOT EXISTS idx_task_steps_owner_id ON task_steps(owner_id);
CREATE INDEX IF NOT EXISTS idx_task_files_task_id ON task_files(task_id);
CREATE INDEX IF NOT EXISTS idx_task_files_owner_id ON task_files(owner_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_owner_id ON uploaded_files(owner_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_created_at ON uploaded_files(created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_owner_id ON mcp_servers(owner_id);
CREATE INDEX IF NOT EXISTS idx_skill_settings_owner_id ON skill_settings(owner_id);
CREATE INDEX IF NOT EXISTS idx_task_templates_owner_id ON task_templates(owner_id);
CREATE INDEX IF NOT EXISTS idx_task_templates_is_public ON task_templates(is_public);
CREATE INDEX IF NOT EXISTS idx_context_metrics_task_id ON context_metrics(task_id);
CREATE INDEX IF NOT EXISTS idx_context_metrics_prefix_hash ON context_metrics(prefix_hash);
CREATE INDEX IF NOT EXISTS idx_context_metrics_created_at ON context_metrics(created_at);

COMMIT;
