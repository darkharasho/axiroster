-- supabase/migrations/0009_audit_retention.sql
-- Phase 0 of the web version: move the unified audit log + retention history
-- out of local JSON into Supabase so web and desktop share them. Conventions
-- match 0001/0002: text workspace_id FK, RLS via is_member/can_write, realtime.

create table if not exists audit_events (
  workspace_id text not null references workspaces(workspace_id) on delete cascade,
  uid          text not null,
  source       text not null check (source in ('gw2','discord')),
  type         text not null default '',
  actor        text not null default '',
  target       text not null default '',
  summary      text not null default '',
  ts           timestamptz not null,
  payload      jsonb not null,
  created_at   timestamptz default now(),
  primary key (workspace_id, uid)
);
create index if not exists audit_events_ws_ts on audit_events (workspace_id, ts desc);

create table if not exists audit_cursors (
  workspace_id    text primary key references workspaces(workspace_id) on delete cascade,
  gw2_last_log_id bigint,
  discord_last_id text,
  updated_at      timestamptz default now()
);

create table if not exists retention_snapshots (
  workspace_id text not null references workspaces(workspace_id) on delete cascade,
  date         date not null,
  member_key   text not null,
  score        double precision not null,
  tier         text not null default '',
  created_at   timestamptz default now(),
  primary key (workspace_id, date, member_key)
);

alter table audit_events        enable row level security;
alter table audit_cursors       enable row level security;
alter table retention_snapshots enable row level security;

create policy ae_select on audit_events for select using (is_member(workspace_id));
create policy ae_write  on audit_events for all
  using (can_write(workspace_id)) with check (can_write(workspace_id));

create policy ac_select on audit_cursors for select using (is_member(workspace_id));
create policy ac_write  on audit_cursors for all
  using (can_write(workspace_id)) with check (can_write(workspace_id));

create policy rs_select on retention_snapshots for select using (is_member(workspace_id));
create policy rs_write  on retention_snapshots for all
  using (can_write(workspace_id)) with check (can_write(workspace_id));

alter publication supabase_realtime add table audit_events;
alter publication supabase_realtime add table audit_cursors;
alter publication supabase_realtime add table retention_snapshots;
