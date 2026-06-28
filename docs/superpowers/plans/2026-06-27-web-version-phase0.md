# Web Version — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Supabase the source of truth for the audit log and retention history (the only two domains not already synced), with zero renderer/preload changes and no visible behavior change.

**Architecture:** Introduce a repo interface per store (`AuditRepo`, `RetentionRepo`) with two implementations selected at construction the same way the sync provider is (`LocalSyncProvider` vs `SupabaseSyncProvider`). The Supabase impl is **cache-backed** — it hydrates an in-memory cache from Supabase on `start()`, keeps it fresh via realtime, serves synchronous reads from the cache, and upserts writes best-effort — so `auditSync.ts` and the `index.ts` IPC handlers keep their synchronous call sites. A one-time idempotent backfill migrates existing local-file history into Supabase.

**Tech Stack:** TypeScript (ESM), Electron main (Node 20), `@supabase/supabase-js`, Vitest (`--pool=forks --poolOptions.forks.maxForks=2`), Supabase CLI for migrations.

## Global Constraints

- Renderer and `src/preload/index.ts` MUST NOT change. `auditList`, `auditRefresh`, `onAuditUpdated`, `auditStatus`, `logRetention` keep exact signatures.
- Vitest runs with `--pool=forks --poolOptions.forks.maxForks=2` (already the `test` script default). Never raise parallelism.
- Follow existing conventions: text `workspace_id` FK, RLS via `is_member`/`can_write`, realtime publication, atomic tmp+rename for local files.
- The Supabase impls mirror `src/main/sync/supabaseSync.ts` patterns exactly (row mapper functions, `setSession` + `realtime.setAuth`, `persistSession: false`).
- Best-effort writes: a Supabase write failure must never throw into `auditSync`/IPC; cache update still happens. Mirrors `pushAnnotation`'s `.catch(() => {})` discipline.
- `AuditEvent` shape (from `src/main/auditNormalize.ts`): `{ uid, source: 'gw2'|'discord', id, time (ISO), type, actor?, target?, summary, raw }`.
- Local files are left on disk (not deleted) after migration.

---

### Task 1: Migration `0009_audit_retention.sql`

**Files:**
- Create: `supabase/migrations/0009_audit_retention.sql`

**Interfaces:**
- Produces: tables `audit_events`, `audit_cursors`, `retention_snapshots` with RLS + realtime. Consumed by Tasks 4, 6 (column names) and the deployed Supabase project.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0009_audit_retention.sql`:

```sql
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
```

- [ ] **Step 2: Verify the SQL parses / applies**

Run: `npx supabase db lint --schema public` (if the CLI/project is linked). If a local Supabase isn't available, instead verify by reviewing against `supabase/migrations/0001_workspaces_schema.sql` + `0002_rls_policies.sql` that table/policy/publication syntax matches.
Expected: no syntax errors; `is_member`/`can_write` referenced (defined in 0002).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0009_audit_retention.sql
git commit -m "feat(db): audit_events + audit_cursors + retention_snapshots tables (Phase 0)"
```

---

### Task 2: `AuditRepo` interface + rename `AuditStore` → `LocalAuditStore`

**Files:**
- Create: `src/main/audit/auditRepo.ts` (interface)
- Modify: `src/main/auditStore.ts` → move to `src/main/audit/localAuditStore.ts`, rename class
- Modify: `src/main/auditStore.test.ts` → `src/main/audit/localAuditStore.test.ts`
- Modify: `src/main/auditSync.ts` (import type), `src/main/index.ts` (import)

**Interfaces:**
- Produces: `interface AuditRepo` (consumed by Tasks 4, 8); `class LocalAuditStore implements AuditRepo`.

- [ ] **Step 1: Create the interface**

Create `src/main/audit/auditRepo.ts`:

```ts
// src/main/audit/auditRepo.ts
//
// The audit-store seam. The local impl persists to JSON (offline / unclaimed
// guild); the Supabase impl is cache-backed so these synchronous methods keep
// working while Supabase is the source of truth. Mirrors the SyncProvider seam.
import type { AuditEvent } from '../auditNormalize'

export interface AuditCursors {
  gw2LastLogId?: number
  discordLastId?: string
}

export interface AuditFilter {
  source?: 'gw2' | 'discord'
  type?: string
  search?: string
  limit?: number
}

export interface AuditRepo {
  /** Hydrate from the backend + start streaming. No-op for the local impl. */
  start(): Promise<void>
  stop(): Promise<void>
  /** Insert new events (deduped by uid). Returns how many were added. */
  merge(events: AuditEvent[]): number
  list(filter?: AuditFilter): AuditEvent[]
  getCursors(): AuditCursors
  setCursors(patch: AuditCursors): void
  counts(): { gw2: number; discord: number }
  lastUpdated(): string
  /** Fires when remote rows arrive (drives the audit:updated IPC push). */
  onChange?(cb: () => void): () => void
}
```

- [ ] **Step 2: Move + rename the local store**

`git mv src/main/auditStore.ts src/main/audit/localAuditStore.ts`. In the moved file: rename `export class AuditStore` → `export class LocalAuditStore`, change its declaration to `implements AuditRepo`, move the `AuditCursors`/`AuditFilter` interface definitions out (import them from `./auditRepo` instead — delete the local copies), fix the `AuditEvent` import path to `../auditNormalize`, and add the lifecycle no-ops:

```ts
import type { AuditEvent } from '../auditNormalize'
import type { AuditRepo, AuditCursors, AuditFilter } from './auditRepo'
// ...existing imports (fs, path)...

export class LocalAuditStore implements AuditRepo {
  // ...existing fields + constructor + read/scheduleWrite/flush/merge/list/
  //    getCursors/setCursors/lastUpdated/counts/clear unchanged...

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}
```

- [ ] **Step 3: Move the test + update imports**

`git mv src/main/auditStore.test.ts src/main/audit/localAuditStore.test.ts`. Update its import to `import { LocalAuditStore } from './localAuditStore'` and replace every `new AuditStore(` with `new LocalAuditStore(`. Update any `AuditFilter`/`AuditCursors` imports to `./auditRepo`.

- [ ] **Step 4: Update consumers**

In `src/main/auditSync.ts`: change `import type { AuditStore } from './auditStore'` to `import type { AuditRepo } from './audit/auditRepo'`, and change the `store: AuditStore` field in `AuditSyncDeps` to `store: AuditRepo`.

In `src/main/index.ts`: change `import { AuditStore, type AuditFilter } from './auditStore'` to:
```ts
import { LocalAuditStore } from './audit/localAuditStore'
import type { AuditRepo, AuditFilter } from './audit/auditRepo'
```
Change the module-level `let auditStore: AuditStore | null = null` to `let auditStore: AuditRepo | null = null`. Change `new AuditStore(` (in `retargetAudit`) to `new LocalAuditStore(`.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/main/audit/localAuditStore.test.ts && npm run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(audit): extract AuditRepo interface, rename AuditStore -> LocalAuditStore"
```

---

### Task 3: Audit row mappers (`eventToRow` / `rowToEvent`)

**Files:**
- Create: `src/main/audit/auditRows.ts`
- Test: `src/main/audit/auditRows.test.ts`

**Interfaces:**
- Consumes: `AuditEvent` from `../auditNormalize`, `AuditCursors` from `./auditRepo`.
- Produces: `eventToRow(workspaceId, e): Record<string, unknown>`, `rowToEvent(r): AuditEvent`, `cursorsToRow(workspaceId, c)`, `rowToCursors(r): AuditCursors`. Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Create `src/main/audit/auditRows.test.ts`:

```ts
import { test, expect } from 'vitest'
import { eventToRow, rowToEvent, cursorsToRow, rowToCursors } from './auditRows'
import type { AuditEvent } from '../auditNormalize'

const ev: AuditEvent = {
  uid: 'gw2:42', source: 'gw2', id: '42', time: '2026-06-20T10:00:00.000Z',
  type: 'joined', actor: 'Alice.1234', target: '', summary: 'Alice joined', raw: { x: 1 }
}

test('eventToRow extracts indexed columns + full payload', () => {
  expect(eventToRow('WS1', ev)).toEqual({
    workspace_id: 'WS1', uid: 'gw2:42', source: 'gw2', type: 'joined',
    actor: 'Alice.1234', target: '', summary: 'Alice joined',
    ts: '2026-06-20T10:00:00.000Z', payload: ev
  })
})

test('rowToEvent prefers the stored payload', () => {
  const row = eventToRow('WS1', ev)
  expect(rowToEvent(row)).toEqual(ev)
})

test('rowToEvent falls back to columns when payload is absent', () => {
  expect(rowToEvent({ uid: 'gw2:7', source: 'gw2', type: 't', actor: 'A', target: '', summary: 's', ts: '2026-06-20T10:00:00.000Z' }))
    .toEqual({ uid: 'gw2:7', source: 'gw2', id: '7', time: '2026-06-20T10:00:00.000Z', type: 't', actor: 'A', target: '', summary: 's', raw: null })
})

test('cursor round-trip', () => {
  expect(rowToCursors(cursorsToRow('WS1', { gw2LastLogId: 99, discordLastId: '5' })))
    .toEqual({ gw2LastLogId: 99, discordLastId: '5' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/main/audit/auditRows.test.ts`
Expected: FAIL — cannot find module `./auditRows`.

- [ ] **Step 3: Write the implementation**

Create `src/main/audit/auditRows.ts`:

```ts
// src/main/audit/auditRows.ts
// Pure mappers between AuditEvent and the audit_events / audit_cursors rows.
// The full event is stored in `payload`; the broken-out columns exist only so
// the DB can filter/order. Mirrors annToRow/rowToAnn in supabaseSync.ts.
import type { AuditEvent } from '../auditNormalize'
import type { AuditCursors } from './auditRepo'

export function eventToRow(workspaceId: string, e: AuditEvent): Record<string, unknown> {
  return {
    workspace_id: workspaceId,
    uid: e.uid,
    source: e.source,
    type: e.type ?? '',
    actor: e.actor ?? '',
    target: e.target ?? '',
    summary: e.summary ?? '',
    ts: e.time,
    payload: e
  }
}

export function rowToEvent(r: Record<string, unknown>): AuditEvent {
  const p = (r.payload ?? null) as Partial<AuditEvent> | null
  if (p && typeof p === 'object' && typeof p.uid === 'string') return p as AuditEvent
  const uid = String(r.uid)
  return {
    uid,
    source: r.source === 'discord' ? 'discord' : 'gw2',
    id: uid.includes(':') ? uid.slice(uid.indexOf(':') + 1) : uid,
    time: typeof r.ts === 'string' ? r.ts : new Date(0).toISOString(),
    type: typeof r.type === 'string' ? r.type : '',
    actor: typeof r.actor === 'string' ? r.actor : '',
    target: typeof r.target === 'string' ? r.target : '',
    summary: typeof r.summary === 'string' ? r.summary : '',
    raw: null
  }
}

export function cursorsToRow(workspaceId: string, c: AuditCursors): Record<string, unknown> {
  return {
    workspace_id: workspaceId,
    gw2_last_log_id: c.gw2LastLogId ?? null,
    discord_last_id: c.discordLastId ?? null
  }
}

export function rowToCursors(r: Record<string, unknown>): AuditCursors {
  const out: AuditCursors = {}
  if (r.gw2_last_log_id != null) out.gw2LastLogId = Number(r.gw2_last_log_id)
  if (r.discord_last_id != null) out.discordLastId = String(r.discord_last_id)
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/main/audit/auditRows.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/audit/auditRows.ts src/main/audit/auditRows.test.ts
git commit -m "feat(audit): row mappers for audit_events + audit_cursors"
```

---

### Task 4: `SupabaseAuditRepo` (cache-backed)

**Files:**
- Create: `src/main/audit/supabaseAuditRepo.ts`
- Test: `src/main/audit/supabaseAuditRepo.test.ts`

**Interfaces:**
- Consumes: `AuditRepo`/`AuditCursors`/`AuditFilter` from `./auditRepo`, mappers from `./auditRows`, `SupabaseSyncConfig` shape (`{ url, anonKey, workspaceId, accessToken?, refreshToken? }`) — redefine locally as `SupabaseAuditConfig` to avoid cross-importing sync.
- Produces: `class SupabaseAuditRepo implements AuditRepo`. Consumed by Task 8.

- [ ] **Step 1: Write the failing test (cache + filter logic, no network)**

The class takes an injected `SupabaseClient` (so tests pass a fake). Create `src/main/audit/supabaseAuditRepo.test.ts`:

```ts
import { test, expect, vi } from 'vitest'
import { SupabaseAuditRepo } from './supabaseAuditRepo'
import type { AuditEvent } from '../auditNormalize'

function ev(uid: string, source: 'gw2' | 'discord', time: string, extra: Partial<AuditEvent> = {}): AuditEvent {
  return { uid, source, id: uid.split(':')[1], time, type: 't', summary: `s-${uid}`, raw: null, ...extra }
}

// Minimal fake just for the synchronous cache paths; network calls are stubbed.
function repo(): SupabaseAuditRepo {
  const client = { from: () => ({ upsert: vi.fn().mockResolvedValue({ error: null }) }) } as never
  return new SupabaseAuditRepo({ url: 'u', anonKey: 'a', workspaceId: 'WS1' }, client)
}

test('merge dedupes by uid and serves newest-first from cache', () => {
  const r = repo()
  expect(r.merge([ev('gw2:1', 'gw2', '2026-06-20T00:00:00Z'), ev('gw2:2', 'gw2', '2026-06-22T00:00:00Z')])).toBe(2)
  expect(r.merge([ev('gw2:2', 'gw2', '2026-06-22T00:00:00Z')])).toBe(0)
  expect(r.list().map((e) => e.uid)).toEqual(['gw2:2', 'gw2:1'])
})

test('list filters by source, type, search, and limit', () => {
  const r = repo()
  r.merge([
    ev('gw2:1', 'gw2', '2026-06-20T00:00:00Z', { actor: 'Alice', type: 'joined' }),
    ev('discord:9', 'discord', '2026-06-21T00:00:00Z', { actor: 'Bob', type: 'kick', summary: 'Bob kicked' })
  ])
  expect(r.list({ source: 'discord' }).map((e) => e.uid)).toEqual(['discord:9'])
  expect(r.list({ type: 'joined' }).map((e) => e.uid)).toEqual(['gw2:1'])
  expect(r.list({ search: 'bob' }).map((e) => e.uid)).toEqual(['discord:9'])
  expect(r.list({ limit: 1 }).length).toBe(1)
})

test('cursors are read/written through the cache', () => {
  const r = repo()
  r.setCursors({ gw2LastLogId: 7 })
  r.setCursors({ discordLastId: '5' })
  expect(r.getCursors()).toEqual({ gw2LastLogId: 7, discordLastId: '5' })
})

test('counts splits by source', () => {
  const r = repo()
  r.merge([ev('gw2:1', 'gw2', '2026-06-20T00:00:00Z'), ev('discord:9', 'discord', '2026-06-21T00:00:00Z')])
  expect(r.counts()).toEqual({ gw2: 1, discord: 1 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/main/audit/supabaseAuditRepo.test.ts`
Expected: FAIL — cannot find module `./supabaseAuditRepo`.

- [ ] **Step 3: Write the implementation**

Create `src/main/audit/supabaseAuditRepo.ts`. The default `createClient` path is used in production; tests inject a fake client via the optional second constructor arg. Reads come from `this.events` / `this.cursors` (the cache). `merge`/`setCursors` update the cache synchronously, then fire best-effort upserts. `start()` hydrates the cache; realtime fires `onChange`.

```ts
// src/main/audit/supabaseAuditRepo.ts
//
// Cache-backed audit store: Supabase is the source of truth, but the public
// methods stay synchronous (auditSync + IPC call them in tight loops). Hydrate
// the cache on start(), keep it fresh via realtime, serve reads from memory,
// and upsert writes best-effort. Mirrors SupabaseSyncProvider.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AuditEvent } from '../auditNormalize'
import type { AuditRepo, AuditCursors, AuditFilter } from './auditRepo'
import { eventToRow, rowToEvent, cursorsToRow, rowToCursors } from './auditRows'

const EVENTS_TABLE = 'audit_events'
const CURSORS_TABLE = 'audit_cursors'
const MAX_EVENTS = 50000

export interface SupabaseAuditConfig {
  url: string
  anonKey: string
  workspaceId: string
  accessToken?: string
  refreshToken?: string
}

export class SupabaseAuditRepo implements AuditRepo {
  private readonly client: SupabaseClient
  private events: AuditEvent[] = []
  private cursors: AuditCursors = {}
  private updatedAt = ''
  private changeCbs: (() => void)[] = []
  private channel: ReturnType<SupabaseClient['channel']> | null = null
  private readonly sessionReady: Promise<void>

  constructor(private readonly config: SupabaseAuditConfig, injected?: SupabaseClient) {
    this.client = injected ?? createClient(config.url, config.anonKey, { auth: { persistSession: false } })
    this.sessionReady =
      config.accessToken && config.refreshToken
        ? this.client.auth
            .setSession({ access_token: config.accessToken, refresh_token: config.refreshToken })
            .then(() => { if (config.accessToken) this.client.realtime.setAuth(config.accessToken) })
            .catch(() => undefined)
        : Promise.resolve()
  }

  async start(): Promise<void> {
    await this.sessionReady
    await this.backfill()
    this.subscribe()
  }

  async stop(): Promise<void> {
    if (this.channel) { await this.client.removeChannel(this.channel).catch(() => {}); this.channel = null }
  }

  onChange(cb: () => void): () => void {
    this.changeCbs.push(cb)
    return () => { this.changeCbs = this.changeCbs.filter((c) => c !== cb) }
  }

  merge(events: AuditEvent[]): number {
    const added = this.applyLocal(events)
    if (added > 0) {
      void this.client.from(EVENTS_TABLE)
        .upsert(events.map((e) => eventToRow(this.config.workspaceId, e)), { onConflict: 'workspace_id,uid' })
        .then(() => undefined, () => undefined)
    }
    return added
  }

  /** In-memory dedupe+sort+cap. Shared by merge() and realtime ingest. */
  private applyLocal(events: AuditEvent[]): number {
    if (events.length === 0) return 0
    const have = new Set(this.events.map((e) => e.uid))
    let added = 0
    for (const e of events) {
      if (have.has(e.uid)) continue
      have.add(e.uid); this.events.push(e); added++
    }
    if (added > 0) {
      this.events.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0))
      if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS
      this.updatedAt = new Date().toISOString()
    }
    return added
  }

  list(filter: AuditFilter = {}): AuditEvent[] {
    const limit = filter.limit ?? 1000
    const q = filter.search?.trim().toLowerCase()
    const out: AuditEvent[] = []
    for (const e of this.events) {
      if (filter.source && e.source !== filter.source) continue
      if (filter.type && e.type !== filter.type) continue
      if (q && !`${e.actor ?? ''} ${e.target ?? ''} ${e.summary}`.toLowerCase().includes(q)) continue
      out.push(e)
      if (out.length >= limit) break
    }
    return out
  }

  getCursors(): AuditCursors { return { ...this.cursors } }

  setCursors(patch: AuditCursors): void {
    this.cursors = { ...this.cursors, ...patch }
    void this.client.from(CURSORS_TABLE)
      .upsert(cursorsToRow(this.config.workspaceId, this.cursors), { onConflict: 'workspace_id' })
      .then(() => undefined, () => undefined)
  }

  lastUpdated(): string { return this.updatedAt }

  counts(): { gw2: number; discord: number } {
    let gw2 = 0, discord = 0
    for (const e of this.events) { if (e.source === 'gw2') gw2++; else discord++ }
    return { gw2, discord }
  }

  private async backfill(): Promise<void> {
    const { data: evRows } = await this.client.from(EVENTS_TABLE)
      .select('*').eq('workspace_id', this.config.workspaceId)
      .order('ts', { ascending: false }).limit(MAX_EVENTS)
    if (Array.isArray(evRows)) this.applyLocal(evRows.map(rowToEvent))
    const { data: curRow } = await this.client.from(CURSORS_TABLE)
      .select('*').eq('workspace_id', this.config.workspaceId).maybeSingle()
    if (curRow) this.cursors = rowToCursors(curRow as Record<string, unknown>)
  }

  private subscribe(): void {
    this.channel = this.client
      .channel(`audit:${this.config.workspaceId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: EVENTS_TABLE, filter: `workspace_id=eq.${this.config.workspaceId}` },
        (payload) => {
          const added = this.applyLocal([rowToEvent(payload.new as Record<string, unknown>)])
          if (added > 0) this.changeCbs.forEach((cb) => cb())
        })
      .subscribe()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/main/audit/supabaseAuditRepo.test.ts && npm run typecheck`
Expected: PASS (4 tests); no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/audit/supabaseAuditRepo.ts src/main/audit/supabaseAuditRepo.test.ts
git commit -m "feat(audit): cache-backed SupabaseAuditRepo"
```

---

### Task 5: `RetentionRepo` interface + rename + retention row mappers

**Files:**
- Create: `src/main/retention/retentionRepo.ts`
- Modify: `src/main/retentionHistory.ts` → `src/main/retention/localRetentionHistory.ts`, rename class
- Modify: `src/main/retentionHistory.test.ts` → `src/main/retention/localRetentionHistory.test.ts`
- Create: `src/main/retention/retentionRows.ts` + `src/main/retention/retentionRows.test.ts`
- Modify: `src/main/index.ts` import + type

**Interfaces:**
- Produces: `interface RetentionRepo { start(): Promise<void>; stop(): Promise<void>; append(snapshots: RetentionSnapshot[]): void; list(): RetentionSnapshot[] }`; `RetentionSnapshot` re-exported from the interface module; `class LocalRetentionHistory implements RetentionRepo`; `snapshotToRow(workspaceId, s)` / `rowToSnapshot(r)`. Consumed by Tasks 6, 8.

- [ ] **Step 1: Create the interface**

Create `src/main/retention/retentionRepo.ts`:

```ts
// src/main/retention/retentionRepo.ts
// The retention-history seam. Write-only today (logRetention -> append); no
// in-app read path, so the interface stays tiny.
export interface RetentionSnapshot {
  date: string // YYYY-MM-DD
  memberKey: string
  score: number
  tier: string
}

export interface RetentionRepo {
  start(): Promise<void>
  stop(): Promise<void>
  append(snapshots: RetentionSnapshot[]): void
  list(): RetentionSnapshot[]
}
```

- [ ] **Step 2: Move + rename the local history**

`git mv src/main/retentionHistory.ts src/main/retention/localRetentionHistory.ts`. In it: delete the local `RetentionSnapshot` interface, import it from `./retentionRepo`; rename `export class RetentionHistory` → `export class LocalRetentionHistory implements RetentionRepo`; add `async start(): Promise<void> {}` and `async stop(): Promise<void> {}`. Keep `list()`/`append()`/`read()`/`flush()` unchanged.

- [ ] **Step 3: Move the test + update imports**

`git mv src/main/retentionHistory.test.ts src/main/retention/localRetentionHistory.test.ts`. Update import to `import { LocalRetentionHistory } from './localRetentionHistory'`, replace `new RetentionHistory(` with `new LocalRetentionHistory(`, and import `RetentionSnapshot` from `./retentionRepo` if referenced.

- [ ] **Step 4: Write the failing row-mapper test**

Create `src/main/retention/retentionRows.test.ts`:

```ts
import { test, expect } from 'vitest'
import { snapshotToRow, rowToSnapshot } from './retentionRows'

test('snapshot round-trips through a row', () => {
  const s = { date: '2026-06-20', memberKey: 'Alice.1', score: 0.83, tier: 'stable' }
  expect(snapshotToRow('WS1', s)).toEqual({
    workspace_id: 'WS1', date: '2026-06-20', member_key: 'Alice.1', score: 0.83, tier: 'stable'
  })
  expect(rowToSnapshot(snapshotToRow('WS1', s))).toEqual(s)
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/main/retention/retentionRows.test.ts`
Expected: FAIL — cannot find module `./retentionRows`.

- [ ] **Step 6: Write the row mappers**

Create `src/main/retention/retentionRows.ts`:

```ts
// src/main/retention/retentionRows.ts
import type { RetentionSnapshot } from './retentionRepo'

export function snapshotToRow(workspaceId: string, s: RetentionSnapshot): Record<string, unknown> {
  return { workspace_id: workspaceId, date: s.date, member_key: s.memberKey, score: s.score, tier: s.tier }
}

export function rowToSnapshot(r: Record<string, unknown>): RetentionSnapshot {
  return {
    date: String(r.date),
    memberKey: String(r.member_key),
    score: typeof r.score === 'number' ? r.score : Number(r.score) || 0,
    tier: typeof r.tier === 'string' ? r.tier : ''
  }
}
```

- [ ] **Step 7: Update `index.ts`**

In `src/main/index.ts`: change `import { RetentionHistory } from './retentionHistory'` to:
```ts
import { LocalRetentionHistory } from './retention/localRetentionHistory'
import type { RetentionRepo, RetentionSnapshot } from './retention/retentionRepo'
```
Change `let retentionHistory: RetentionHistory` to `let retentionHistory: RetentionRepo`. Change `new RetentionHistory(` to `new LocalRetentionHistory(`. Update the inline `import('./retentionHistory').RetentionSnapshot` type in the `retention:log` handler to the imported `RetentionSnapshot`.

- [ ] **Step 8: Run tests + typecheck**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/main/retention && npm run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(retention): RetentionRepo interface, rename class, row mappers"
```

---

### Task 6: `SupabaseRetentionRepo`

**Files:**
- Create: `src/main/retention/supabaseRetentionRepo.ts`
- Test: `src/main/retention/supabaseRetentionRepo.test.ts`

**Interfaces:**
- Consumes: `RetentionRepo`/`RetentionSnapshot` from `./retentionRepo`, mappers from `./retentionRows`.
- Produces: `class SupabaseRetentionRepo implements RetentionRepo` with constructor `(config: { url; anonKey; workspaceId; accessToken?; refreshToken? }, injected?: SupabaseClient)`. Consumed by Task 8.

- [ ] **Step 1: Write the failing test**

Create `src/main/retention/supabaseRetentionRepo.test.ts`:

```ts
import { test, expect, vi } from 'vitest'
import { SupabaseRetentionRepo } from './supabaseRetentionRepo'

function repo(upsert = vi.fn().mockResolvedValue({ error: null })): { r: SupabaseRetentionRepo; upsert: typeof upsert } {
  const client = { from: () => ({ upsert }) } as never
  return { r: new SupabaseRetentionRepo({ url: 'u', anonKey: 'a', workspaceId: 'WS1' }, client), upsert }
}

test('append dedupes one row per member per day in the cache', () => {
  const { r } = repo()
  r.append([{ date: '2026-06-20', memberKey: 'A', score: 0.5, tier: 't1' }])
  r.append([{ date: '2026-06-20', memberKey: 'A', score: 0.9, tier: 't2' }])
  expect(r.list()).toEqual([{ date: '2026-06-20', memberKey: 'A', score: 0.9, tier: 't2' }])
})

test('append upserts mapped rows to Supabase', () => {
  const { r, upsert } = repo()
  r.append([{ date: '2026-06-20', memberKey: 'A', score: 0.5, tier: 't1' }])
  expect(upsert).toHaveBeenCalledWith(
    [{ workspace_id: 'WS1', date: '2026-06-20', member_key: 'A', score: 0.5, tier: 't1' }],
    { onConflict: 'workspace_id,date,member_key' }
  )
})

test('empty append is a no-op (no upsert)', () => {
  const { r, upsert } = repo()
  r.append([])
  expect(upsert).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/main/retention/supabaseRetentionRepo.test.ts`
Expected: FAIL — cannot find module `./supabaseRetentionRepo`.

- [ ] **Step 3: Write the implementation**

Create `src/main/retention/supabaseRetentionRepo.ts`:

```ts
// src/main/retention/supabaseRetentionRepo.ts
// Write-mostly retention log backed by Supabase. append() upserts best-effort
// and keeps an in-memory copy (deduped one row per member per day).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { RetentionRepo, RetentionSnapshot } from './retentionRepo'
import { snapshotToRow } from './retentionRows'

const TABLE = 'retention_snapshots'

export interface SupabaseRetentionConfig {
  url: string
  anonKey: string
  workspaceId: string
  accessToken?: string
  refreshToken?: string
}

export class SupabaseRetentionRepo implements RetentionRepo {
  private readonly client: SupabaseClient
  private rows: RetentionSnapshot[] = []
  private readonly sessionReady: Promise<void>

  constructor(private readonly config: SupabaseRetentionConfig, injected?: SupabaseClient) {
    this.client = injected ?? createClient(config.url, config.anonKey, { auth: { persistSession: false } })
    this.sessionReady =
      config.accessToken && config.refreshToken
        ? this.client.auth
            .setSession({ access_token: config.accessToken, refresh_token: config.refreshToken })
            .then(() => undefined, () => undefined)
        : Promise.resolve()
  }

  async start(): Promise<void> { await this.sessionReady }
  async stop(): Promise<void> {}

  append(snapshots: RetentionSnapshot[]): void {
    if (snapshots.length === 0) return
    const key = (s: RetentionSnapshot): string => `${s.date}|${s.memberKey}`
    const byKey = new Map(this.rows.map((r) => [key(r), r]))
    for (const s of snapshots) byKey.set(key(s), s)
    this.rows = [...byKey.values()]
    void this.client.from(TABLE)
      .upsert(snapshots.map((s) => snapshotToRow(this.config.workspaceId, s)), { onConflict: 'workspace_id,date,member_key' })
      .then(() => undefined, () => undefined)
  }

  list(): RetentionSnapshot[] { return [...this.rows] }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/main/retention/supabaseRetentionRepo.test.ts && npm run typecheck`
Expected: PASS (3 tests); no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/retention/supabaseRetentionRepo.ts src/main/retention/supabaseRetentionRepo.test.ts
git commit -m "feat(retention): SupabaseRetentionRepo"
```

---

### Task 7: One-time idempotent backfill of local files → Supabase

**Files:**
- Create: `src/main/migrateLocalToSupabase.ts`
- Test: `src/main/migrateLocalToSupabase.test.ts`
- Modify: `src/main/secrets.ts` (`SettingKey` union)

**Interfaces:**
- Consumes: `AuditRepo`, `RetentionRepo`, a local `LocalAuditStore`/`LocalRetentionHistory` to read from, and a settings get/set pair.
- Produces: `migrateAuditToSupabase(deps)` / `migrateRetentionToSupabase(deps)` returning the number of rows pushed; both idempotent via a per-workspace marker.

- [ ] **Step 1: Add the marker SettingKey**

In `src/main/secrets.ts`, add to the `SettingKey` union (after `lastSeenVersion`):
```ts
  // Phase-0 web migration: per-workspace marker so local->Supabase backfill runs once
  | `migratedAudit:${string}`
  | `migratedRetention:${string}`
```

- [ ] **Step 2: Write the failing test**

Create `src/main/migrateLocalToSupabase.test.ts`:

```ts
import { test, expect, vi } from 'vitest'
import { migrateAuditToSupabase, migrateRetentionToSupabase } from './migrateLocalToSupabase'
import type { AuditEvent } from './auditNormalize'

function ev(uid: string): AuditEvent {
  return { uid, source: 'gw2', id: uid.split(':')[1], time: '2026-06-20T00:00:00Z', type: 't', summary: uid, raw: null }
}

test('audit backfill pushes local events once, then is a no-op', async () => {
  const target = { merge: vi.fn().mockReturnValue(1) }
  const local = { list: () => [ev('gw2:1'), ev('gw2:2')] }
  const settings = new Map<string, string>()
  const deps = {
    workspaceId: 'WS1', target: target as never, local: local as never,
    getSetting: (k: string) => settings.get(k) ?? null,
    setSetting: (k: string, v: string) => void settings.set(k, v)
  }
  expect(await migrateAuditToSupabase(deps)).toBe(2)
  expect(target.merge).toHaveBeenCalledTimes(1)
  expect(await migrateAuditToSupabase(deps)).toBe(0) // marker set -> skipped
  expect(target.merge).toHaveBeenCalledTimes(1)
})

test('retention backfill pushes local rows once, then is a no-op', async () => {
  const target = { append: vi.fn() }
  const local = { list: () => [{ date: '2026-06-20', memberKey: 'A', score: 0.5, tier: 't' }] }
  const settings = new Map<string, string>()
  const deps = {
    workspaceId: 'WS1', target: target as never, local: local as never,
    getSetting: (k: string) => settings.get(k) ?? null,
    setSetting: (k: string, v: string) => void settings.set(k, v)
  }
  expect(await migrateRetentionToSupabase(deps)).toBe(1)
  expect(await migrateRetentionToSupabase(deps)).toBe(0)
  expect(target.append).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/main/migrateLocalToSupabase.test.ts`
Expected: FAIL — cannot find module `./migrateLocalToSupabase`.

- [ ] **Step 4: Write the implementation**

Create `src/main/migrateLocalToSupabase.ts`:

```ts
// src/main/migrateLocalToSupabase.ts
// One-time, idempotent backfill of the local audit/retention JSON into Supabase
// when a workspace first connects. Idempotent twice over: a per-workspace marker
// short-circuits repeats, and the underlying upserts dedupe by primary key.
import type { AuditRepo } from './audit/auditRepo'
import type { RetentionRepo, RetentionSnapshot } from './retention/retentionRepo'
import type { AuditEvent } from './auditNormalize'

interface AuditMigrateDeps {
  workspaceId: string
  target: Pick<AuditRepo, 'merge'>
  local: { list(): AuditEvent[] }
  getSetting(key: string): string | null
  setSetting(key: string, value: string): void
}

export async function migrateAuditToSupabase(deps: AuditMigrateDeps): Promise<number> {
  const marker = `migratedAudit:${deps.workspaceId}`
  if (deps.getSetting(marker)) return 0
  const events = deps.local.list()
  if (events.length > 0) deps.target.merge(events)
  deps.setSetting(marker, new Date().toISOString())
  return events.length
}

interface RetentionMigrateDeps {
  workspaceId: string
  target: Pick<RetentionRepo, 'append'>
  local: { list(): RetentionSnapshot[] }
  getSetting(key: string): string | null
  setSetting(key: string, value: string): void
}

export async function migrateRetentionToSupabase(deps: RetentionMigrateDeps): Promise<number> {
  const marker = `migratedRetention:${deps.workspaceId}`
  if (deps.getSetting(marker)) return 0
  const rows = deps.local.list()
  if (rows.length > 0) deps.target.append(rows)
  deps.setSetting(marker, new Date().toISOString())
  return rows.length
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/main/migrateLocalToSupabase.test.ts && npm run typecheck`
Expected: PASS (2 tests); no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/migrateLocalToSupabase.ts src/main/migrateLocalToSupabase.test.ts src/main/secrets.ts
git commit -m "feat: idempotent local->Supabase backfill for audit + retention"
```

---

### Task 8: Wire repo selection into `index.ts`

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes everything from Tasks 2–7. No new exports.

This task has no unit test of its own (it's integration wiring); its gate is `npm run typecheck` + a manual smoke run. Keep changes surgical.

- [ ] **Step 1: Add imports**

At the top of `src/main/index.ts`, alongside the audit/retention imports added in Tasks 2 and 5, add:
```ts
import { SupabaseAuditRepo } from './audit/supabaseAuditRepo'
import { SupabaseRetentionRepo } from './retention/supabaseRetentionRepo'
import { migrateAuditToSupabase, migrateRetentionToSupabase } from './migrateLocalToSupabase'
import { LocalRetentionHistory } from './retention/localRetentionHistory'
```

- [ ] **Step 2: Track the active workspace session for repo construction**

Add a module-level holder near the other `let` declarations (after `let sync`):
```ts
// Set by initSync() when a Supabase workspace is connected; null when local-only.
let activeWsConn: { url: string; anonKey: string; workspaceId: string; accessToken: string; refreshToken: string } | null = null
```
In `initSync()`, inside the `if (session && ws) {` block right after `sync = new SupabaseSyncProvider(...)` is constructed, set:
```ts
      activeWsConn = { url, anonKey, workspaceId: ws.workspaceId, accessToken: session.access_token, refreshToken: session.refresh_token }
```
In both `else` branches of `initSync()` (the two `sync = new LocalSyncProvider()` lines), set `activeWsConn = null`. After the workspace is established (end of the `if (session && ws)` block), call `await retargetAudit()` and the retention swap (Step 4) so they pick up the new connection. Then at the end of `initSync()` after `activeWsConn` is finalized, also handle the local-only case by calling `await retargetAudit()`.

- [ ] **Step 3: Make `retargetAudit()` choose the repo + run backfill**

Change `retargetAudit` from `function retargetAudit(): void` to `async function retargetAudit(): Promise<void>`. Where it currently does `auditStore = new AuditStore(join(...))` / `new LocalAuditStore(...)`, branch on `activeWsConn`:
```ts
  const localPath = join(app.getPath('userData'), 'auditLog', `${g.id}.json`)
  const localStore = new LocalAuditStore(localPath)
  if (activeWsConn) {
    const supa = new SupabaseAuditRepo(activeWsConn)
    await supa.start().catch(() => {})
    // Backfill any local-only history into the cloud once, then read live.
    await migrateAuditToSupabase({
      workspaceId: activeWsConn.workspaceId, target: supa, local: localStore,
      getSetting: (k) => store.getSetting(k as never), setSetting: (k, v) => store.setSetting(k as never, v)
    }).catch(() => {})
    supa.onChange?.(() => mainWindow?.webContents.send('audit:updated'))
    auditStore = supa
  } else {
    auditStore = localStore
  }
  auditSync = new AuditSync({ store: auditStore, /* ...existing deps unchanged... */ })
  auditSync.start()
```
Update the existing `auditSync?.stop()` early-return path to also `await auditStore?.stop?.()` when retargeting. Every existing caller of `retargetAudit()` must now `await` it (or `void retargetAudit()` where a non-async context requires it — e.g. the `guilds:setActive` handler can `await`).

- [ ] **Step 4: Make retention choose the repo**

Where retention is constructed at startup (`retentionHistory = new RetentionHistory(join(userData, 'retentionHistory.json'))`, now `new LocalRetentionHistory(...)` from Task 5), introduce a helper and call it from `initSync()` after `activeWsConn` is set:
```ts
async function retargetRetention(): Promise<void> {
  const localPath = join(app.getPath('userData'), 'retentionHistory.json')
  const localHist = new LocalRetentionHistory(localPath)
  await retentionHistory?.stop?.().catch(() => {})
  if (activeWsConn) {
    const supa = new SupabaseRetentionRepo(activeWsConn)
    await supa.start().catch(() => {})
    await migrateRetentionToSupabase({
      workspaceId: activeWsConn.workspaceId, target: supa, local: localHist,
      getSetting: (k) => store.getSetting(k as never), setSetting: (k, v) => store.setSetting(k as never, v)
    }).catch(() => {})
    retentionHistory = supa
  } else {
    retentionHistory = localHist
  }
}
```
Keep the startup `retentionHistory = new LocalRetentionHistory(...)` as the initial value (so it's defined before the first `initSync()`), and call `await retargetRetention()` from `initSync()` once `activeWsConn` is finalized.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no type errors. Fix any `await`-of-non-async or missing-`await` diagnostics introduced by making `retargetAudit` async.

- [ ] **Step 6: Full test run**

Run: `npm test`
Expected: all suites PASS (the renamed local tests + the four new Supabase/migration suites).

- [ ] **Step 7: Manual smoke (local-only path, no regression)**

Run: `npm run dev`. With no workspace claimed, open the Guild Log and confirm events still list and refresh exactly as before (this exercises the `LocalAuditStore` branch). Confirm no console errors at startup.

- [ ] **Step 8: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: select Supabase audit/retention repos when in a workspace (Phase 0 wiring)"
```

---

## Self-Review Notes

- **Spec coverage:** schema (Task 1), `AuditRepo`+local rename (Task 2), audit mappers (Task 3), `SupabaseAuditRepo` cache+realtime (Task 4), `RetentionRepo`+rename+mappers (Task 5), `SupabaseRetentionRepo` (Task 6), idempotent migration (Task 7), repo selection mirroring sync (Task 8). Renderer/preload untouched (Global Constraints + Task 8 keeps `auditSync`/IPC signatures). All spec sections map to a task.
- **Realtime → `audit:updated`:** wired in Task 8 Step 3 via `supa.onChange`.
- **Type consistency:** `AuditRepo` methods (`start/stop/merge/list/getCursors/setCursors/counts/lastUpdated/onChange`) are identical across Tasks 2 and 4. `RetentionRepo` (`start/stop/append/list`) identical across Tasks 5 and 6. Config object `{ url, anonKey, workspaceId, accessToken, refreshToken }` identical across Tasks 4, 6, 8.
- **Deferred (Phase 2):** renderer data-layer seam; (Phase 1) Node server.
