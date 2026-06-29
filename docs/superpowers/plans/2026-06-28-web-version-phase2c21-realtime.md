# Web Version — Phase 2c-21: Web Realtime Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live web updates — a `webClient/realtime.ts` manager subscribes to the active workspace's Supabase channel and fans `postgres_changes` out to the renderer's existing `onSyncChanged`/`onWorkspaceChanged`/`onAuditUpdated` callbacks.

**Architecture:** One per-workspace `RealtimeChannel` across 7 streamed tables; serialized `ensure()` (re)subscribes (setAuth-before-subscribe), `resync()` on workspace switch, auth-state lifecycle. Wired into `createWebClient`; no renderer component changes.

**Tech Stack:** TypeScript, `@supabase/supabase-js` realtime, Vitest (node, fakes only). No new deps.

## Global Constraints

- Touch ONLY: `src/renderer/src/lib/webClient/realtime.ts` (new), `src/renderer/src/lib/webClient/realtime.test.ts` (new), `src/renderer/src/lib/webClient/webClient.ts`, `src/renderer/src/lib/webClient/webClient.test.ts`. Do NOT touch any renderer component, `src/main`, `src/shared`, `src/preload`, or `supabase/`.
- `sb.realtime.setAuth(token)` MUST be called BEFORE `channel.subscribe()` (else RLS drops every row over the socket).
- Channel name `axiroster-web:<ws>`. Listeners: `roster_annotations`/`roster_links`/`roster_members` → sync set; `workspace_members`/`workspace_invites`/`workspaces` → workspace set; `audit_events` → audit set. Each `{ event: '*', schema: 'public', table, filter: \`workspace_id=eq.<ws>\` }`.
- `ensure()` is serialized (promise-chained) so concurrent registrations/resyncs cannot double-subscribe; it no-ops when already on the right ws.
- Status: `'connecting'` before subscribe → `'SUBSCRIBED'`→`'connected'`, `'CHANNEL_ERROR'`/`'TIMED_OUT'`→`'error'`; no active workspace → `'disabled'`.
- Auth lifecycle: `SIGNED_OUT`→teardown+`'disabled'`; `TOKEN_REFRESHED`→`setAuth` only; `SIGNED_IN`→`setAuth`+`ensure()`.
- No-supabase fallback in `webClient.ts` unchanged: the `on*` methods return a callable no-op unsubscribe; `syncStatus()` resolves `'disabled'`.
- Run vitest with `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` + `npm run build:web` green.

Reused interfaces:
- `activeWorkspaceId(sb, settings): Promise<string | null>` (`./discordGw2`).
- `WebSettings` (`./settings`); `webSetActiveGuild(settings, id)` (`./workspace`).
- `SyncStatus = 'disabled' | 'connecting' | 'connected' | 'error'` (`preload/index.d`).

---

### Task 1: `realtime.ts` — the web realtime manager

**Files:**
- Create: `src/renderer/src/lib/webClient/realtime.ts`, `src/renderer/src/lib/webClient/realtime.test.ts`

**Interfaces:**
- Produces: `createWebRealtime(sb: SupabaseClient, settings: WebSettings): WebRealtime` where `WebRealtime = { onSync(cb): ()=>void; onWorkspace(cb): ()=>void; onAudit(cb): ()=>void; onStatus(cb: (s: SyncStatus)=>void): ()=>void; status(): SyncStatus; resync(): void; stop(): void }`.

- [ ] **Step 1: Write the failing test**

`src/renderer/src/lib/webClient/realtime.test.ts`:
```ts
import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createWebRealtime } from './realtime'
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

// A fake channel records each .on() handler by table, and .subscribe(cb) fires cb
// with a controllable status (default SUBSCRIBED).
function makeChannel(name: string, order: string[]) {
  const handlers: Record<string, (p: unknown) => void> = {}
  const ch = {
    name,
    on(_type: string, opts: { table: string }, handler: (p: unknown) => void) {
      handlers[opts.table] = handler
      return ch
    },
    subscribe(cb?: (st: string) => void) {
      order.push('subscribe')
      ch._cb = cb
      cb?.('SUBSCRIBED')
      return ch
    },
    _cb: undefined as undefined | ((st: string) => void),
    fire(table: string) {
      handlers[table]?.({ eventType: 'INSERT', new: {} })
    }
  }
  return ch
}

function fakeSb(opts: { members?: { workspace_id: string; role: string }[] } = {}) {
  const order: string[] = []
  const channels: ReturnType<typeof makeChannel>[] = []
  let authCb: ((e: string, s: unknown) => void) | null = null
  const sb = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
      getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authCb = cb
        return { data: { subscription: { unsubscribe() {} } } }
      }
    },
    realtime: { setAuth: vi.fn(() => order.push('setAuth')) },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: opts.members ?? [{ workspace_id: 'w1', role: 'owner' }] }) }) }),
    channel: (name: string) => {
      const ch = makeChannel(name, order)
      channels.push(ch)
      return ch
    },
    removeChannel: vi.fn(async () => {})
  } as unknown as SupabaseClient
  const removeChannel = (sb as unknown as { removeChannel: ReturnType<typeof vi.fn> }).removeChannel
  return { sb, order, channels, fireAuth: (e: string, s: unknown) => authCb?.(e, s), removeChannel }
}

const settings = () => createWebSettings(fakeStorage())
const tick = () => new Promise((r) => setTimeout(r, 0))

test('onSync subscribes to the active workspace and fires on a roster change', async () => {
  const { sb, channels } = fakeSb()
  const rt = createWebRealtime(sb, settings())
  const hit = vi.fn()
  rt.onSync(hit)
  await tick()
  expect(channels).toHaveLength(1)
  expect(channels[0].name).toBe('axiroster-web:w1')
  channels[0].fire('roster_annotations')
  expect(hit).toHaveBeenCalledTimes(1)
})

test('routes meta + audit tables to the right callback sets', async () => {
  const { sb, channels } = fakeSb()
  const rt = createWebRealtime(sb, settings())
  const sync = vi.fn(), ws = vi.fn(), audit = vi.fn()
  rt.onSync(sync); rt.onWorkspace(ws); rt.onAudit(audit)
  await tick()
  channels[0].fire('workspace_members')
  channels[0].fire('audit_events')
  channels[0].fire('roster_links')
  expect(ws).toHaveBeenCalledTimes(1)
  expect(audit).toHaveBeenCalledTimes(1)
  expect(sync).toHaveBeenCalledTimes(1)
})

test('setAuth is called before subscribe', async () => {
  const { sb, order } = fakeSb()
  const rt = createWebRealtime(sb, settings())
  rt.onSync(() => {})
  await tick()
  expect(order.indexOf('setAuth')).toBeLessThan(order.indexOf('subscribe'))
})

test('status goes connecting → connected and onStatus receives it', async () => {
  const { sb } = fakeSb()
  const rt = createWebRealtime(sb, settings())
  const seen: string[] = []
  rt.onStatus((s) => seen.push(s))
  rt.onSync(() => {})
  await tick()
  expect(rt.status()).toBe('connected')
  expect(seen).toContain('connecting')
  expect(seen).toContain('connected')
})

test('resync after the active workspace changes tears down + re-subscribes', async () => {
  const { sb, channels, removeChannel } = fakeSb({ members: [{ workspace_id: 'w1', role: 'owner' }, { workspace_id: 'w2', role: 'write' }] })
  const s = settings()
  s.set('activeGuildId', 'w1')
  const rt = createWebRealtime(sb, s)
  rt.onSync(() => {})
  await tick()
  expect(channels[0].name).toBe('axiroster-web:w1')
  s.set('activeGuildId', 'w2')
  rt.resync()
  await tick()
  expect(removeChannel).toHaveBeenCalled()
  expect(channels[channels.length - 1].name).toBe('axiroster-web:w2')
})

test('no active workspace → no channel, status disabled', async () => {
  const { sb, channels } = fakeSb({ members: [] })
  const rt = createWebRealtime(sb, settings())
  rt.onSync(() => {})
  await tick()
  expect(channels).toHaveLength(0)
  expect(rt.status()).toBe('disabled')
})

test('SIGNED_OUT tears down and disables', async () => {
  const { sb, removeChannel, fireAuth } = fakeSb()
  const rt = createWebRealtime(sb, settings())
  rt.onSync(() => {})
  await tick()
  fireAuth('SIGNED_OUT', null)
  await tick()
  expect(removeChannel).toHaveBeenCalled()
  expect(rt.status()).toBe('disabled')
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/realtime.test.ts`
Expected: FAIL — cannot find `./realtime`.

- [ ] **Step 3: Implement `realtime.ts`**

```ts
// src/renderer/src/lib/webClient/realtime.ts
// Web realtime: one Supabase channel per active workspace, fanning postgres_changes
// out to the renderer's existing onSyncChanged/onWorkspaceChanged/onAuditUpdated
// callbacks (the web client has no local stores — consumers just re-fetch). Mirrors
// the desktop SupabaseSyncProvider table set. setAuth(token) MUST precede subscribe
// or the realtime socket connects as anon and RLS drops every row.
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import type { SyncStatus } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { activeWorkspaceId } from './discordGw2'

type Cb = () => void
type StatusCb = (s: SyncStatus) => void

const SYNC_TABLES = ['roster_annotations', 'roster_links', 'roster_members']
const META_TABLES = ['workspace_members', 'workspace_invites', 'workspaces']

export interface WebRealtime {
  onSync(cb: Cb): () => void
  onWorkspace(cb: Cb): () => void
  onAudit(cb: Cb): () => void
  onStatus(cb: StatusCb): () => void
  status(): SyncStatus
  resync(): void
  stop(): void
}

export function createWebRealtime(sb: SupabaseClient, settings: WebSettings): WebRealtime {
  const sync = new Set<Cb>()
  const workspace = new Set<Cb>()
  const audit = new Set<Cb>()
  const statusCbs = new Set<StatusCb>()
  let channel: RealtimeChannel | null = null
  let currentWs: string | null = null
  let _status: SyncStatus = 'disabled'
  let pending: Promise<void> = Promise.resolve()

  const setStatus = (s: SyncStatus): void => {
    _status = s
    for (const cb of statusCbs) cb(s)
  }
  const fan = (set: Set<Cb>): void => {
    for (const cb of set) cb()
  }

  const teardown = async (): Promise<void> => {
    if (!channel) return
    const c = channel
    channel = null
    currentWs = null
    try {
      await sb.removeChannel(c)
    } catch {
      /* ignore */
    }
  }

  async function ensureOnce(): Promise<void> {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) {
      await teardown()
      setStatus('disabled')
      return
    }
    if (channel && currentWs === ws) return
    await teardown()
    currentWs = ws
    setStatus('connecting')
    const {
      data: { session }
    } = await sb.auth.getSession()
    if (session?.access_token) sb.realtime.setAuth(session.access_token)
    let ch = sb.channel(`axiroster-web:${ws}`)
    const opts = (table: string): Record<string, unknown> => ({
      event: '*',
      schema: 'public',
      table,
      filter: `workspace_id=eq.${ws}`
    })
    for (const t of SYNC_TABLES) ch = ch.on('postgres_changes', opts(t) as never, () => fan(sync))
    for (const t of META_TABLES) ch = ch.on('postgres_changes', opts(t) as never, () => fan(workspace))
    ch = ch.on('postgres_changes', opts('audit_events') as never, () => fan(audit))
    channel = ch
    ch.subscribe((st: string) => {
      if (st === 'SUBSCRIBED') setStatus('connected')
      else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') setStatus('error')
    })
  }

  const ensure = (): Promise<void> => {
    pending = pending.then(ensureOnce).catch(() => {})
    return pending
  }

  // Re-auth on token refresh (the live socket re-auths existing channels); (re)subscribe
  // on sign-in; tear down on sign-out.
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      pending = pending.then(teardown).catch(() => {})
      setStatus('disabled')
    } else if (event === 'TOKEN_REFRESHED') {
      if (session?.access_token) sb.realtime.setAuth(session.access_token)
    } else if (event === 'SIGNED_IN') {
      if (session?.access_token) sb.realtime.setAuth(session.access_token)
      void ensure()
    }
  })

  const sub = (set: Set<Cb>, cb: Cb): (() => void) => {
    set.add(cb)
    void ensure()
    return () => {
      set.delete(cb)
    }
  }

  return {
    onSync: (cb) => sub(sync, cb),
    onWorkspace: (cb) => sub(workspace, cb),
    onAudit: (cb) => sub(audit, cb),
    onStatus: (cb) => {
      statusCbs.add(cb)
      cb(_status)
      return () => {
        statusCbs.delete(cb)
      }
    },
    status: () => _status,
    resync: () => {
      void ensure()
    },
    stop: () => {
      pending = pending.then(teardown).catch(() => {})
      setStatus('disabled')
    }
  }
}
```

- [ ] **Step 4: Run — expect PASS (7 tests)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/realtime.test.ts`
Expected: PASS. If a fake/await-timing detail is off, fix the test fake (e.g. add another `await tick()`), not the module's contract.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/webClient/realtime.ts src/renderer/src/lib/webClient/realtime.test.ts
git commit -m "feat(web): realtime manager — per-workspace Supabase channel fanning to sync/workspace/audit callbacks"
```

---

### Task 2: Wire realtime into `createWebClient`

**Files:**
- Modify: `src/renderer/src/lib/webClient/webClient.ts`, `src/renderer/src/lib/webClient/webClient.test.ts`

**Interfaces:**
- Consumes: `createWebRealtime` (Task 1).

- [ ] **Step 1: Update the failing test**

In `src/renderer/src/lib/webClient/webClient.test.ts`, the existing no-supabase test (`window/update/sync/audit stubs resolve sensibly`, the client built with `createWebClient({ storage: fakeStorage() })`) must still pass — `syncStatus`/`reinitSync` resolve `'disabled'` (already asserted from 2c-18). Add a test that the event subscriptions are callable no-ops without supabase:
```ts
test('event subscriptions are safe no-ops without supabase', () => {
  const c = createWebClient({ storage: fakeStorage() })
  expect(typeof c.onSyncChanged(() => {})).toBe('function')
  expect(typeof c.onWorkspaceChanged(() => {})).toBe('function')
  expect(typeof c.onAuditUpdated(() => {})).toBe('function')
  expect(typeof c.onSyncStatus(() => {})).toBe('function')
  // calling the returned unsubscribe must not throw
  c.onSyncChanged(() => {})()
})
```

- [ ] **Step 2: Run — expect PASS already (no-supabase path unchanged) / FAIL only if a wiring typo**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/webClient.test.ts`
Expected: PASS for the new no-op test before wiring (the methods are already no-ops). This test guards the no-supabase branch stays intact after wiring.

- [ ] **Step 3: Wire `realtime` into `webClient.ts`**

Add the import:
```ts
import { createWebRealtime } from './realtime'
```
Inside `createWebClient`, after `const settings = createWebSettings(deps.storage)` (and near the other locals), instantiate:
```ts
  const realtime = deps.supabase ? createWebRealtime(deps.supabase, settings) : null
```
Replace the four event no-ops and the two sync methods:
```ts
    syncStatus: async () => (realtime ? realtime.status() : 'disabled'),
    reinitSync: async () => {
      realtime?.resync()
      return realtime ? realtime.status() : 'disabled'
    },
```
```ts
    onSyncChanged: (cb) => (realtime ? realtime.onSync(cb) : noopUnsub()),
    onSyncStatus: (cb) => (realtime ? realtime.onStatus(cb) : noopUnsub()),
    onWorkspaceChanged: (cb) => (realtime ? realtime.onWorkspace(cb) : noopUnsub()),
```
```ts
    onAuditUpdated: (cb) => (realtime ? realtime.onAudit(cb) : noopUnsub()),
```
(Leave `onAuditError`/`onAuditStatus` and the other `on*` update/window no-ops as `noopUnsub()`.)
Update `setActiveGuild` to resync:
```ts
    setActiveGuild: async (id) => {
      await webSetActiveGuild(settings, id)
      realtime?.resync()
    },
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/`
Expected: PASS. Note the `onSyncStatus`/`onSyncChanged` callbacks now come from `realtime` when supabase is present; the no-supabase tests still hit `noopUnsub()`.

- [ ] **Step 5: Full gates**

Run: `npm test` → all pass. Run: `npm run typecheck` → clean. Run: `npm run build:web` → succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/webClient/webClient.ts src/renderer/src/lib/webClient/webClient.test.ts
git commit -m "feat(web): wire realtime manager into createWebClient (live sync/workspace/audit + status, resync on guild switch)"
```

---

## Self-Review Notes

- **Spec coverage:** the manager (sets, channel, ensure, teardown, status, resync, stop, auth lifecycle, setAuth-before-subscribe, 7-table routing) → Task 1 Step 3 + the 7 tests Step 1. Wiring (instantiate, 4 events, syncStatus/reinitSync, setActiveGuild resync, no-supabase fallback) → Task 2 Step 3 + tests Step 1. No renderer/component/Edge/migration change (constraints). Backfill out of scope (consumers fetch on first render).
- **Placeholder scan:** none — full module, full test file, exact wiring edits.
- **Type consistency:** `createWebRealtime(sb, settings)` returns `WebRealtime` with the exact method names used in Task 2 wiring (`onSync`/`onWorkspace`/`onAudit`/`onStatus`/`status`/`resync`/`stop`). `SyncStatus` values match the spec/preload. Channel name `axiroster-web:<ws>` consistent between impl and the resync test. `activeWorkspaceId(sb, settings)` signature matches `./discordGw2`. The `opts(...) as never` cast satisfies supabase-js's overloaded `.on('postgres_changes', …)` typing without `any`.
- **Concurrency:** `ensure()` is promise-chained (`pending`), so simultaneous `onSync`/`onWorkspace`/`onAudit` registrations serialize and only the first subscribes for a given ws; later ones see `currentWs === ws` and no-op. `resync` and `SIGNED_OUT`/`stop` teardown also ride the same chain.
