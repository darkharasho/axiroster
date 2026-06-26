# Shared Supabase instance with Discord auth + GW2-leader guild claim

**Date:** 2026-06-25
**Status:** Design approved, pending spec review

## Problem

Today every guild self-hosts its own Supabase project and an officer is handed a
URL, anon key, and a freely-chosen `workspace_id`. RLS is effectively open
(`using(true)`), so the workspace id is just a shared secret. This is high-friction
to onboard (each guild does Supabase setup) and has no real access control.

We want a **single Supabase project owned by the app maintainer**, with the anon
key shipped inside the app, Discord OAuth for identity, and guild workspaces that
are claimed and managed automatically — without letting rank-and-file guild members
read private leadership notes.

## Core model

- **One Supabase project**, owned by the maintainer. The anon key ships in the app
  binary. Because the anon key is now public/extractable, **RLS becomes the real
  security boundary** — every policy is enforced server-side against the
  authenticated user, never on `workspace_id` secrecy.
- **`workspace_id = GW2 guild id`.** Derived automatically from the GW2 API; no
  manual workspace string.
- **Identity vs. authorization are separate:**
  - **Discord OAuth** answers *who you are* → a stable Supabase `auth.uid()` that
    RLS keys on, plus a one-click login. Stable even if a GW2 key is rotated.
  - **GW2 leader key** answers *what you may touch* → verified server-side, grants
    membership.
- **The first auth for a guild must be a guild LEADER.** Verified per the GW2 API:
  `/v2/guild/:id/members` returns data *only* for a key from the guild leader's
  account (scope `guilds`). If an Edge Function can read the member list with the
  presented key, the user is a leader and may claim ownership. A regular member's
  key 403s and cannot claim. (Verified against the official GW2 API wiki.)
- **The entire GW2 API is read-only.** A leaked key cannot kick members, spend
  gold, or modify anything. It *can* read guild stash/treasury/logs in addition to
  the member list, so the stored key is encrypted at rest and only ever decrypted
  inside an Edge Function. Owner can replace/revoke it anytime.

## Roles

Per-workspace role on each membership row:

| Role     | Read roster/notes | Edit notes & links | Manage members / key / config |
|----------|-------------------|--------------------|-------------------------------|
| `owner`  | yes               | yes                | yes (sole)                    |
| `write`  | yes               | yes                | no                            |
| `read`   | yes               | no                 | no                            |

- **Only `owner`** can grant/revoke access and manage the leader key + Discord
  guild settings. (Single owner per workspace for now; schema does not preclude a
  future co-owner / transfer feature.)
- `write` may edit `roster_annotations` and `roster_links`.
- `read` is view-only.

## Data flow

### First-time guild claim (leader)
1. Officer clicks **Sign in with Discord** → Supabase Auth issues a JWT (`auth.uid()`).
2. App reads the local GW2 API key, calls Edge Function **`claim-guild`** with
   `{ apiKey, guildId }`.
3. `claim-guild` calls `/v2/guild/:id/members` server-side with the key.
   - 200 → leader confirmed. If the guild is **unclaimed**, insert
     `workspaces` + `workspace_secrets` (encrypted key) + a `workspace_members`
     row `(guild_id, auth.uid, role='owner')`. Returns success.
   - 403 / not-a-member → rejected.
   - Guild **already claimed** → rejected with "managed by leadership; ask an
     officer for an invite."

### Refresh roster (any member, owner key)
1. App calls Edge Function **`refresh-roster`** `{ guildId }`.
2. Function checks caller is a member of that workspace, decrypts the stored leader
   key, pulls `/v2/guild/:id/members`, upserts the synced **`roster_members`**
   table. The key never leaves the server.
3. Realtime streams the updated roster to all members' apps. Officers without
   leader keys still see the full roster because it is now synced, not pulled
   locally.

### Invites (owner → officer)
Two mechanisms, owner-only:
- **Pick from Discord roster.** Owner selects a person from the in-app Discord
  member list (already loaded via AxiTools). Creates a `workspace_invites` row
  keyed on that **Discord id** with a target role. When that person signs in with
  Discord, their Discord id (from `auth` provider metadata) matches the pending
  invite and **`redeem-invite`** auto-admits them at the granted role.
- **Generate code.** Owner generates a single-use code/link, shares it
  out-of-band. Invitee signs in with Discord and redeems the code via
  **`redeem-invite`**. Covers people not in the loaded Discord roster.

### Edit / revoke
- `write`/`owner` edit annotations and links → synced via existing `SyncProvider`
  realtime path.
- Owner opens member-management view, sees the full member list, can **revoke**
  (delete `workspace_members` row) or flip a member between `read` and `write`.

## Schema

```sql
-- Non-sensitive, readable by all members of the workspace.
create table workspaces (
  workspace_id    text primary key,          -- GW2 guild id
  guild_name      text default '',
  discord_guild_id text default '',
  has_leader_key  boolean default false,     -- existence flag, NOT the key
  created_at      timestamptz default now()
);

-- Encrypted leader key. Owner-only; decrypted only inside Edge Functions.
create table workspace_secrets (
  workspace_id    text primary key references workspaces(workspace_id),
  leader_key_enc  text not null,
  updated_at      timestamptz default now()
);

create table workspace_members (
  workspace_id    text not null references workspaces(workspace_id),
  user_id         uuid not null,             -- auth.uid()
  discord_id      text,                      -- provider id, for invite matching
  role            text not null check (role in ('owner','write','read')),
  created_at      timestamptz default now(),
  primary key (workspace_id, user_id)
);

create table workspace_invites (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    text not null references workspaces(workspace_id),
  role            text not null check (role in ('write','read')),
  discord_id      text,                      -- set for "pick from roster" invites
  code            text unique,               -- set for "generate code" invites
  created_by      uuid not null,
  redeemed_by     uuid,
  redeemed_at     timestamptz,
  created_at      timestamptz default now()
);

-- New: base roster synced so non-leader officers can see members.
create table roster_members (
  workspace_id    text not null references workspaces(workspace_id),
  member_id       text not null,
  payload         jsonb not null,            -- name, rank, joined, etc.
  updated_at      timestamptz default now(),
  primary key (workspace_id, member_id)
);

-- Existing tables gain a foreign key to workspaces; columns unchanged.
-- roster_annotations(workspace_id, member_id, ...)
-- roster_links(workspace_id, account_name, member_id, ...)
```

## RLS

Helper predicates (expressed inline in policies):

```sql
-- is the caller any member of this workspace?
exists (select 1 from workspace_members m
        where m.workspace_id = <table>.workspace_id and m.user_id = auth.uid())

-- does the caller have write+ on this workspace?
exists (select 1 from workspace_members m
        where m.workspace_id = <table>.workspace_id and m.user_id = auth.uid()
          and m.role in ('owner','write'))

-- is the caller the owner?
exists (select 1 from workspace_members m
        where m.workspace_id = <table>.workspace_id and m.user_id = auth.uid()
          and m.role = 'owner')
```

- `workspaces`, `roster_members`: **SELECT** = member; **no client writes**
  (written only by Edge Functions via the service role).
- `roster_annotations`, `roster_links`: **SELECT** = member; **INSERT/UPDATE/DELETE**
  = write+.
- `workspace_members`: **SELECT** = member (so owner can list, members can see
  their own role); **INSERT/UPDATE/DELETE** = owner only.
- `workspace_secrets`: **no client access at all** — Edge Functions only (service
  role). Child apps learn "a key exists" from `workspaces.has_leader_key`, never
  the value.
- `workspace_invites`: **SELECT/INSERT/DELETE** = owner; redemption happens through
  `redeem-invite` (service role), not direct client writes.

## Edge Functions (Deno, service role)

- **`claim-guild`** — verify leader key against GW2 API, claim unclaimed guild,
  store encrypted key, create owner membership.
- **`refresh-roster`** — caller is a member → decrypt key → pull members → upsert
  `roster_members`.
- **`redeem-invite`** — match pending invite by Discord id or code → create
  membership at granted role → mark invite redeemed.

Key encryption uses a secret held only in the Edge Function environment
(Supabase secret), so the DB alone is insufficient to decrypt.

## Client changes (Electron / React)

- **Auth module (main process):** Discord OAuth via Supabase PKCE. Main process
  opens the system browser to the authorize URL; the redirect returns to a
  registered custom protocol (`axiroster://auth-callback`); the app exchanges the
  code for a session and persists the refresh token in the existing encrypted
  `secrets.ts` store.
- **`supabaseSync.ts`:** the client is created with the bundled URL + anon key and
  the user's auth session (so RLS sees `auth.uid()`); `workspace_id` comes from the
  claimed guild rather than config. Add subscription/backfill for the new
  `roster_members` table. Existing annotation/link sync paths are otherwise
  unchanged — the `SyncProvider` interface is stable, so the renderer/IPC layer is
  largely untouched.
- **Settings → guild section** becomes role-aware:
  - **Owner:** sign-in status, claimed guild, editable GW2 leader key, editable
    Discord guild, **member access list** (revoke + read/write toggle), invite
    controls (pick-from-roster + generate-code).
  - **`write`/`read` (child):** sign-in status, claimed guild shown read-only,
    "Leader key: configured ✓" (value never fetched or shown), their own role
    shown, **no** member-management or key/guild editing.
- **Self-host config removed.** The manual URL / anon key / workspace_id inputs and
  the `LocalSyncProvider`-vs-Supabase toggle for bring-your-own are dropped; the
  hosted instance is the only backend. `LocalSyncProvider` (offline/local-only)
  remains as the no-workspace default.

## Migration

- Existing self-host guilds are **not** auto-migrated (different Supabase project,
  different identity model). Provide a one-time note in release docs: re-claim your
  guild via Discord + leader key on the hosted instance; annotations can be
  re-entered or, if needed, exported/imported via a small script (out of scope for
  v1).
- `docs/SUPABASE.md` is rewritten from "set up your own project" to "sign in with
  Discord; leaders claim the guild; owners invite officers."

## Free-tier fit

Supabase free tier (500 MB DB, 5 GB egress, 50k MAU auth, Edge Functions, Realtime)
is comfortable for roster-sized data (hundreds of members, a handful of officers
per guild, many guilds). Roster payloads are small JSON; Realtime traffic is
edit-driven. Monitor egress/Realtime if adoption grows.

## Testing

- **Edge Functions:** unit-test `claim-guild` (leader 200 → owner; member 403 →
  reject; already-claimed → reject), `refresh-roster` (member gate, key decrypt,
  upsert), `redeem-invite` (Discord-id match, code match, single-use). Mock the
  GW2 API.
- **RLS:** policy tests with two synthetic users — read user cannot write; write
  user can edit annotations but not members/secret; owner can manage; non-member
  sees nothing; no client can read `workspace_secrets`.
- **Client:** auth round-trip (PKCE + protocol callback) with a stubbed provider;
  `supabaseSync` backfill/realtime for `roster_members`; role-aware Settings
  rendering (owner vs child views).

## Out of scope (v1)

- Co-owners / ownership transfer.
- Field-level merge / CRDT (last-write-wins on `updated_at` stays).
- Automated data migration from self-host instances.
- Per-guild rate limiting / abuse controls beyond Supabase defaults.
