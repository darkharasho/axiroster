# Web Version — Phase 2c-11: Web Audit Log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `auditList(filter?)` + `auditRefresh()` for the web client so the Log tab shows data — `auditList` reads the Phase-0 `audit_events` Supabase table directly; `auditRefresh` is a no-op (no server-side poller on web). Replaces the two `notImplemented` audit stubs.

**Architecture:** New `audit.ts` module + wiring in `webClient.ts`. Direct table read (no Edge Function).

**Tech Stack:** TypeScript, React renderer, Vitest, `@supabase/supabase-js`. No new dependencies.

## Global Constraints

- Confined to `src/renderer/src/lib/webClient/` (one new module + tests + edits to `webClient.ts`/`webClient.test.ts`). Do NOT touch `src/main`/`src/shared`/`src/preload`/other-renderer/contract.
- `createWebClient` stays conformant `AxiClient`; only `auditList`/`auditRefresh` change from `ni(...)`.
- `auditList` NEVER throws (catch → `{ events: [], updatedAt: '' }`). Returns `{ events: AuditEvent[]; updatedAt: string }`. `auditRefresh` returns `Result<number>` = `{ ok: true, data: 0 }`.
- **supabase-js query order:** filters (`.eq`/`.or`) must be applied BEFORE the terminal `.order().limit()` (after `.order()`/`.limit()` the builder no longer exposes `.eq`).
- Renderer→preload via `../../../../preload/index.d`; reuse `activeWorkspaceId` from `./discordGw2`.
- Run vitest `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` green.

---

### Task 1: `audit.ts` (auditList + auditRefresh) + wiring

**Files:**
- Create: `src/renderer/src/lib/webClient/audit.ts`, `.../audit.test.ts`
- Modify: `src/renderer/src/lib/webClient/webClient.ts` (+ `webClient.test.ts`)

**Interfaces:**
- Consumes: `SupabaseClient`; `AuditEvent`/`AuditFilter`/`Result` (`../../../../preload/index.d`); `WebSettings` (`./settings`); `activeWorkspaceId` (`./discordGw2`).
- Produces: `webAuditList`, `webAuditRefresh`.

- [ ] **Step 1: Write the failing test**

`src/renderer/src/lib/webClient/audit.test.ts`:
```ts
import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { webAuditList, webAuditRefresh } from './audit'
import { createWebSettings } from './settings'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size
    }
  } as Storage
}

// Chainable builder: .select/.eq/.or/.order/.limit chain and the object is
// thenable (resolves { data: rows }). Records eq/or calls for assertions.
function builder(rows: unknown) {
  const calls = { eq: [] as [string, unknown][], or: [] as string[] }
  const b: Record<string, unknown> = {}
  Object.assign(b, {
    select: () => b,
    eq: (c: string, v: unknown) => {
      calls.eq.push([c, v])
      return b
    },
    or: (s: string) => {
      calls.or.push(s)
      return b
    },
    order: () => b,
    limit: () => b,
    then: (res: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(res)
  })
  ;(b as { calls: typeof calls }).calls = calls
  return b as Record<string, unknown> & { calls: typeof calls }
}

function fakeSb(rowsByTable: Record<string, unknown>) {
  const builders: Record<string, ReturnType<typeof builder>> = {}
  const sb = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => (builders[t] ??= builder(rowsByTable[t] ?? []))
  } as unknown as SupabaseClient
  return { sb, builders }
}

const EV = {
  uid: 'gw2:1',
  source: 'gw2',
  id: '1',
  time: '2026-06-22T00:00:00Z',
  type: 'joined',
  summary: 'x',
  raw: null
}

test('webAuditList maps payloads and sets updatedAt to the first event time', async () => {
  const { sb } = fakeSb({
    workspace_members: [{ workspace_id: 'w1', role: 'owner' }],
    audit_events: [{ payload: EV }]
  })
  const r = await webAuditList(sb, createWebSettings(fakeStorage()))
  expect(r.events).toEqual([EV])
  expect(r.updatedAt).toBe('2026-06-22T00:00:00Z')
})

test('webAuditList applies source + search filters', async () => {
  const { sb, builders } = fakeSb({
    workspace_members: [{ workspace_id: 'w1', role: 'owner' }],
    audit_events: []
  })
  await webAuditList(sb, createWebSettings(fakeStorage()), { source: 'discord', search: 'bob' })
  const aud = builders['audit_events']
  expect(aud.calls.eq).toContainEqual(['source', 'discord'])
  expect(aud.calls.or[0]).toMatch(/actor\.ilike\.%bob%/)
})

test('webAuditList with no workspace returns empty', async () => {
  const sb = {
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => builder([])
  } as unknown as SupabaseClient
  expect(await webAuditList(sb, createWebSettings(fakeStorage()))).toEqual({ events: [], updatedAt: '' })
})

test('webAuditRefresh is a no-op returning ok(0)', async () => {
  expect(await webAuditRefresh()).toEqual({ ok: true, data: 0 })
})
```

- [ ] **Step 2: Run — expect FAIL (missing module)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/audit.test.ts`
Expected: FAIL — cannot find `./audit`.

- [ ] **Step 3: Implement `audit.ts`**

```ts
// src/renderer/src/lib/webClient/audit.ts
// Web audit log: read the Phase-0 audit_events table directly. The full
// AuditEvent is in the `payload` jsonb column; the broken-out columns
// (source/type/actor/target/summary/ts) are used for DB filtering. There is no
// server-side audit poller on web, so auditRefresh is a no-op.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuditEvent, AuditFilter, Result } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { activeWorkspaceId } from './discordGw2'

const TABLE = 'audit_events'

export async function webAuditList(
  sb: SupabaseClient,
  settings: WebSettings,
  filter?: AuditFilter
): Promise<{ events: AuditEvent[]; updatedAt: string }> {
  try {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) return { events: [], updatedAt: '' }
    // Filters (eq/or) MUST precede the terminal order/limit in supabase-js.
    let q = sb.from(TABLE).select('payload').eq('workspace_id', ws)
    if (filter?.source) q = q.eq('source', filter.source)
    if (filter?.type) q = q.eq('type', filter.type)
    if (filter?.search) {
      const s = filter.search.replace(/[,()%*]/g, '').trim()
      if (s) q = q.or(`actor.ilike.%${s}%,target.ilike.%${s}%,summary.ilike.%${s}%`)
    }
    const { data } = await q.order('ts', { ascending: false }).limit(filter?.limit ?? 1000)
    const events = ((data ?? []) as { payload: AuditEvent }[]).map((r) => r.payload).filter(Boolean)
    return { events, updatedAt: events[0]?.time ?? '' }
  } catch {
    return { events: [], updatedAt: '' }
  }
}

export async function webAuditRefresh(): Promise<Result<number>> {
  // No server-side audit poller on web; the Log shows whatever the desktop poller
  // has synced into audit_events. Genuinely 0 new events from the browser.
  return { ok: true, data: 0 }
}
```

- [ ] **Step 4: Run — expect PASS (4 tests)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/audit.test.ts`
Expected: PASS. (If a chain method is missing on the fake, add it to the `builder` — not the module.)

- [ ] **Step 5: Wire in `webClient.ts`**

1. Add import: `import { webAuditList, webAuditRefresh } from './audit'`.
2. Replace the stubs:
   ```ts
   auditList: async (filter) =>
     deps.supabase ? webAuditList(deps.supabase, settings, filter) : { events: [], updatedAt: '' },
   auditRefresh: async () => webAuditRefresh(),
   ```
   Leave every other `ni(...)` method unchanged. (`auditStatus` stays `async () => null`.)

- [ ] **Step 6: Add `webClient.test.ts` smoke**

```ts
test('auditList without supabase returns empty (no throw)', async () => {
  expect(await createWebClient({ storage: fakeStorage() }).auditList()).toEqual({ events: [], updatedAt: '' })
})
```

- [ ] **Step 7: Run web-client suite + full suite + typecheck**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/`
Expected: PASS.

Run: `npm test` → all pass. Run: `npm run typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/lib/webClient
git commit -m "feat(web): audit log — auditList reads audit_events; auditRefresh no-op"
```

---

## Self-Review Notes

- **Spec coverage:** `webAuditList` reads `audit_events` (filters before order/limit; payload→AuditEvent; updatedAt; never-throws), `webAuditRefresh` no-op `ok(0)` (Step 3); wired in `webClient.ts` (Step 5, `auditStatus` left null); tests for mapping/updatedAt, source+search filter calls, no-workspace empty, refresh ok(0), no-supabase smoke (Steps 1, 6). Other methods stay `ni(...)`; `src/main`/`src/shared`/`src/preload` untouched.
- **Type consistency:** `auditList` returns `{ events: AuditEvent[]; updatedAt: string }`, `auditRefresh` returns `Result<number>` — matching `AxiRosterApi`. `AuditEvent`/`AuditFilter` from the contract; the `payload` column IS the full `AuditEvent`.
- **Query order:** `eq`/`or` filters applied to the FilterBuilder before the terminal `.order().limit()` (typechecks; later transforms drop `.eq`).
- **Flagged for real-run:** no server-side poller — the web Log reflects what the desktop synced; `auditRefresh` honestly returns 0; the `.or` ilike search sanitizes `,()%*`.
