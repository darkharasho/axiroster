# Shared sync setup (Supabase)

AxiRoster's roster annotations (tags, notes, nicknames) and manual Discord↔GW2
links can sync live across a guild's leadership. The backend is Supabase
(hosted Postgres + Realtime). One **workspace** = one guild's shared roster.

## 1. Create a project

1. Create a free project at <https://supabase.com>.
2. Copy the **Project URL** and the **anon public** API key
   (Project Settings → API).

## 2. Create the tables

Run this in the Supabase SQL editor:

```sql
create table if not exists roster_annotations (
  workspace_id text not null,
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
  workspace_id text not null,
  account_name text not null,
  member_id    text not null,
  created_at   timestamptz default now(),
  primary key (workspace_id, account_name)
);

-- Realtime so officers see edits the moment a leader makes them.
alter publication supabase_realtime add table roster_annotations;
alter publication supabase_realtime add table roster_links;
```

## 3. Access policy

The simplest model: knowledge of the `workspace_id` is the shared secret —
treat it like a join code and only give it to leadership. Enable RLS and allow
the anon role to read/write only within a workspace it already knows:

```sql
alter table roster_annotations enable row level security;
alter table roster_links enable row level security;

-- Anyone with the anon key can operate, but every query is scoped to a
-- workspace_id in the app. For stronger isolation, swap these for policies
-- keyed off a Supabase Auth JWT claim and have officers sign in.
create policy "ws rw anns" on roster_annotations for all
  using (true) with check (true);
create policy "ws rw links" on roster_links for all
  using (true) with check (true);
```

> **Hardening (recommended before a public release):** move from "shared
> workspace id" to Supabase Auth + a `workspace_members(workspace_id, user_id,
> role)` table, and rewrite the policies to `using (auth.uid() in (select
> user_id from workspace_members where workspace_id = roster_annotations.workspace_id))`.
> This gives per-officer accounts, revocation, and an audit trail. The app's
> `SyncProvider` interface already isolates this change to `supabaseSync.ts`.

## 4. Configure AxiRoster

In **Settings → Shared sync (Supabase)**:

- Enable shared sync
- **URL** → your Project URL
- **anon public key** → your anon key
- **workspace id** → any shared string your guild agrees on (e.g. `myguild-wvw`)

Click **Apply**. The status pill in the sidebar turns green (**Synced**) once the
initial backfill completes and the realtime channel is live. Hand the same three
values to each officer and they all share one roster.

## Conflict handling

Writes are last-write-wins on `updated_at`. For tags/notes edited by a handful of
officers this is sufficient. If two people edit the *same* member's notes at the
same second, the later write wins — there's no field-level merge. The
`SyncProvider` seam leaves room to upgrade to CRDT/field-merge later without
touching the UI.
