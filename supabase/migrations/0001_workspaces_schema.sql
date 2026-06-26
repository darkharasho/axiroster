-- supabase/migrations/0001_workspaces_schema.sql
create table if not exists workspaces (
  workspace_id     text primary key,
  guild_name       text default '',
  discord_guild_id text default '',
  has_leader_key   boolean default false,
  created_at       timestamptz default now()
);

create table if not exists workspace_secrets (
  workspace_id   text primary key references workspaces(workspace_id) on delete cascade,
  leader_key_enc text not null,
  updated_at     timestamptz default now()
);

create table if not exists workspace_members (
  workspace_id text not null references workspaces(workspace_id) on delete cascade,
  user_id      uuid not null,
  discord_id   text,
  role         text not null check (role in ('owner','write','read')),
  created_at   timestamptz default now(),
  primary key (workspace_id, user_id)
);

create table if not exists workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspaces(workspace_id) on delete cascade,
  role         text not null check (role in ('write','read')),
  discord_id   text,
  code         text unique,
  created_by   uuid not null,
  redeemed_by  uuid,
  redeemed_at  timestamptz,
  created_at   timestamptz default now()
);

create table if not exists roster_members (
  workspace_id text not null references workspaces(workspace_id) on delete cascade,
  member_id    text not null,
  payload      jsonb not null,
  updated_at   timestamptz default now(),
  primary key (workspace_id, member_id)
);

create table if not exists roster_annotations (
  workspace_id text not null references workspaces(workspace_id) on delete cascade,
  member_id    text not null,
  nickname     text default '',
  aliases      jsonb default '[]'::jsonb,
  notes        text default '',
  tags         jsonb default '[]'::jsonb,
  main_account text default '',
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  primary key (workspace_id, member_id)
);

create table if not exists roster_links (
  workspace_id text not null references workspaces(workspace_id) on delete cascade,
  account_name text not null,
  member_id    text not null,
  created_at   timestamptz default now(),
  primary key (workspace_id, account_name)
);

alter publication supabase_realtime add table roster_annotations;
alter publication supabase_realtime add table roster_links;
alter publication supabase_realtime add table roster_members;
alter publication supabase_realtime add table workspace_members;
