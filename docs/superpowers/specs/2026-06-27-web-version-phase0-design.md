# Web Version — Phase 0: Audit + Retention → Supabase

**Date:** 2026-06-27
**Status:** Approved (design)

## Background & Goal

AxiRoster is today an Electron desktop app for Guild Wars 2 WvW guild leadership.
The user wants a **web version** that ships alongside the desktop app long-term
(companion), ideally from **one shared core** rather than a fork.

**Agreed end-state architecture (multi-phase):**

- **Companion + shared core.** Web and desktop both ship; one UI codebase serves
  both via a platform-agnostic data layer (Electron IPC implementation + web HTTP
  implementation behind one interface).
- **Backend model: reuse `src/main` as a hosted Node server.** The existing Node
  clients/stores get wrapped in an authenticated HTTP API and deployed. Same
  TypeScript runs in Electron and on the server.
- **Supabase is the single source of truth**, shared by app and site. Both
  clients converge on Supabase; genuinely device-local settings (window bounds,
  last-seen-version) stay local.

**Phasing (each phase gets its own spec → plan → implementation):**

- **Phase 0 (this spec) — Audit + retention → Supabase, backend-only.** Make
  Supabase the source of truth for the two data domains that aren't synced yet.
  Zero renderer changes, no visible behavior change.
- **Phase 1 — Node server.** Wrap `src/main` clients + stores in an authenticated
  HTTP API (validates the Supabase JWT), deployed.
- **Phase 2 — Web shell + web client + web auth.** Vite web build, HTTP
  implementation of the data interface, Discord OAuth via Supabase redirect, web
  equivalents for Electron-only bits (titlebar, window controls, auto-update).

## Phase 0 Scope

**In scope:** move the **audit log** and **retention history** from local-only
JSON files into Supabase, following the existing workspace/RLS/realtime pattern,
so every client in a workspace shares them.

**Why only these two:** almost all domain data is already in Supabase —
annotations, links, roster_members, pipeline + tags (reserved `roster_annotations`
rows), guild config, shared keys. The audit log (`auditStore.ts`) and retention
history (`retentionHistory.ts`) are the only domains explicitly local-only. They
are the minimum gap that makes "web and app share the same data" actually true.

**Explicitly deferred to Phase 2:** the renderer-side data-layer seam (replacing
the `window.axiroster` global with an injected client). The renderer already
talks through one clean typed bridge; swapping that global is a wide mechanical
refactor only needed once the web client exists. Doing it in Phase 0 adds risk
with no payoff.

**Invariant:** `src/preload/index.ts` and the renderer do not change in Phase 0.
`auditList`, `auditRefresh`, `onAuditUpdated`, `auditStatus`, `logRetention` keep
their exact signatures.

## Schema

New migration `supabase/migrations/0009_audit_retention.sql`. Conventions match
existing migrations (text `workspace_id` FK, RLS via `is_member`/`can_write`,
realtime publication).

```sql
-- audit_events: the unified GW2 + AxiTools log, now shared per-workspace.
create table audit_events (
  workspace_id text not null references workspaces(workspace_id) on delete cascade,
  uid          text not null,                       -- existing dedupe key
  source       text not null check (source in ('gw2','discord')),
  type         text not null default '',
  actor        text not null default '',
  target       text not null default '',
  summary      text not null default '',
  ts           timestamptz not null,                -- event time, for ordering/filter
  payload      jsonb not null,                      -- full normalized AuditEvent
  created_at   timestamptz default now(),
  primary key (workspace_id, uid)
);
create index audit_events_ws_ts on audit_events (workspace_id, ts desc);

-- audit_cursors: one row/workspace so pulls coordinate across clients.
create table audit_cursors (
  workspace_id    text primary key references workspaces(workspace_id) on delete cascade,
  gw2_last_log_id bigint,
  discord_last_id text,
  updated_at      timestamptz default now()
);

-- retention_snapshots: one row per member per calendar day.
create table retention_snapshots (
  workspace_id text not null references workspaces(workspace_id) on delete cascade,
  date         date not null,
  member_key   text not null,
  score        double precision not null,
  tier         text not null default '',
  created_at   timestamptz default now(),
  primary key (workspace_id, date, member_key)
);
```

**RLS** mirrors `roster_annotations`: members `select`, `can_write` members do
everything, for all three tables. Example:

```sql
alter table audit_events enable row level security;
create policy ae_select on audit_events for select using (is_member(workspace_id));
create policy ae_write  on audit_events for all
  using (can_write(workspace_id)) with check (can_write(workspace_id));
-- (same shape for audit_cursors and retention_snapshots)
```

**Realtime:** add all three tables to the `supabase_realtime` publication so
other clients (and Phase-2 web) see new audit events / snapshots live. The audit
subscription drives the existing `audit:updated` IPC push to the renderer.

**RLS judgment call (recorded):** audit is derived, high-volume data that any
client pulls from GW2/AxiTools and writes. Letting every `can_write` officer
insert is simplest and matches annotations. The `audit_cursors` table prevents
re-pulling the same events; dedupe by `uid` makes concurrent pulls idempotent. A
stricter service-role-only-writes model (via an Edge Function) is possible but
not warranted yet.

## Store Refactor

Mirror the existing sync seam (`LocalSyncProvider` vs `SupabaseSyncProvider`):
one repo interface per store, two implementations, selected at construction the
same way sync is today (local when no workspace/auth; Supabase when in a claimed
workspace with a session).

**Critical constraint:** today both `auditSync.ts` and the `index.ts` IPC
handlers call the store **synchronously** (`merge`, `list`, `getCursors`,
`setCursors`, `counts`, `lastUpdated`). To avoid rewriting those call sites, the
repo interface stays synchronous and the Supabase impl is **cache-backed** —
exactly how `SupabaseSyncProvider` already serves annotations/links: hydrate an
in-memory cache from Supabase on `start()`, keep it fresh via realtime, serve
reads from the cache, and upsert writes to Supabase best-effort.

```ts
interface AuditRepo {
  // lifecycle (async): hydrate cache from Supabase / tear down realtime
  start(): Promise<void>
  stop(): Promise<void>
  // synchronous reads/writes against the in-memory cache (signatures unchanged)
  merge(events: AuditEvent[]): number
  list(filter?: AuditFilter): AuditEvent[]
  getCursors(): AuditCursors
  setCursors(patch: AuditCursors): void
  counts(): { gw2: number; discord: number }
  lastUpdated(): string
  // realtime: notify when remote rows arrive (drives existing audit:updated push)
  onChange?(cb: () => void): () => void
}
```

- `LocalAuditStore` — the current `AuditStore`, renamed, behavior unchanged (the
  offline / unclaimed-guild path). Gains no-op `start`/`stop`.
- `SupabaseAuditRepo` — hydrates the cache on `start()` (backfill events +
  cursors), serves `list`/`getCursors`/`counts`/`lastUpdated` from the cache,
  and on `merge`/`setCursors` updates the cache synchronously **and** upserts to
  Supabase best-effort. `list` maps `AuditFilter` the same as the local store
  (`source`/`type` equality, case-insensitive substring over actor+target+
  summary, `limit` default 1000, newest-first). Subscribes to realtime so
  `onChange` fires the existing `audit:updated` IPC event.

**Retention:** same pattern — `RetentionRepo` with `LocalRetentionHistory`
(current, renamed) and `SupabaseRetentionRepo`. Retention is **write-only from
the renderer** today (`logRetention` → `append`; no in-app read-back path), so
the Supabase impl only needs `append` (one-row-per-member-per-day upsert,
best-effort) plus an in-memory `list` for tests. No realtime needed.

**Cursor semantics:** `auditSync.ts`'s pull loop reads/writes cursors via the
repo (now Supabase) instead of the local file, so all of a guild's clients
advance the same cursor and don't re-pull each other's history.

**Wiring:** `auditSync.ts` and the IPC handlers in `src/main/index.ts` call the
repo interface, so they change minimally. Repo selection lives where sync
provider selection lives today (workspace + auth session available →
Supabase impl; else local impl).

## Data Migration

Officers already running the desktop app have local audit/retention history. On
first run of the Supabase-backed build inside a claimed workspace, do a one-time,
idempotent backfill:

- On startup, if a workspace is active and a local `auditLog/<guildId>.json` /
  retention file exists, `upsert` its rows to Supabase (dedupe by `uid` and by
  `(date, member_key)` makes re-runs harmless), then set a
  `migratedToSupabase` marker (per workspace) in settings so it never repeats.
- Local files are **left on disk untouched** (not deleted) as a safety net; they
  simply stop being the source of truth. A clean cutover (deleting them) is a
  trivial later follow-up if desired.

Idempotent upserts mean no data loss and no harm if it runs twice or two clients
race.

## Testing

TDD throughout, following the existing `supabaseSync.test.ts` style (mock
Supabase client). Vitest runs with `--pool=forks --poolOptions.forks.maxForks=2`
(already the `test` script default).

- **`SupabaseAuditRepo`** — `AuditFilter` → query mapping (source / type / search
  / limit / ordering), `append` upsert shape, cursor get/set, realtime `onChange`
  fires.
- **`SupabaseRetentionRepo`** — one-row-per-member-per-day upsert, list.
- **Repo selection** — local impl when no workspace/auth; Supabase impl when
  claimed with a session.
- **Migration** — idempotent backfill (runs twice = same result; marker prevents
  repeat).
- Existing `auditStore.test.ts` / `retentionHistory.test.ts` keep passing against
  the renamed local implementations.

## Out of Scope (Phase 0)

- Renderer / preload changes of any kind.
- The Node server (Phase 1) and the web shell / web client / web auth (Phase 2).
- Deleting local JSON files (kept as a safety net).
- Any stricter service-role-only write model for audit.
