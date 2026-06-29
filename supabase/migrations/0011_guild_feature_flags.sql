-- Per-guild feature flags shared across the workspace (mirrors member_role_id /
-- bridge_repos moving onto workspaces in 0007). retention_enabled gates the
-- Retention radar tab; pipeline_enabled gates the Recruitment tab (default on).
-- Read by ws_select (is_member); written by ws_update_write (can_write) — both
-- already exist. No publication change needed (workspaces already streams).
alter table workspaces
  add column if not exists retention_enabled boolean not null default false,
  add column if not exists pipeline_enabled  boolean not null default true;
