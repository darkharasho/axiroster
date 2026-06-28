# Web Version — Phase 2c-3: Web Discord/GW2 Data Methods — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement six `WebAxiClient` data methods (`gw2AccountInfo`, `axitoolsListGuilds`, `axitoolsGuildRoles`, `discordOverview`, `boundGw2Guilds`, `discordAction`) — replacing their `notImplemented` stubs with real `functions.invoke('axitools')` / browser-direct GW2 logic, reusing the shared core (`src/shared/gw2Client`, `src/shared/roster/adapters`). Mock-tested.

**Architecture:** A new `discordGw2.ts` module holds the helpers + the six method functions; `webClient.ts` wires them. Edge methods call the Phase-1 `axitools` function and map its `{data}`/`{error}` envelope to `Result`; `gw2AccountInfo` uses the shared `Gw2Client` browser-direct. Validation mode (caller `key`) vs stored mode (active workspace via the 2c-1 `resolveEffectiveWorkspace`).

**Tech Stack:** TypeScript, React renderer, Vitest, `@supabase/supabase-js`. No new dependencies.

## Global Constraints

- Changes confined to `src/renderer/src/lib/webClient/` (one new module + tests + edits to `webClient.ts`/`webClient.test.ts`). Do NOT touch `src/main`, `src/shared`, `src/preload`, the rest of the renderer, or the `AxiClient` contract.
- `createWebClient` must still return a conformant `AxiClient` (typecheck green); only the six named methods change from `ni(...)`.
- Renderer→shared imports use `../../../../shared/…` (webClient/ is four levels below `src/`).
- All six methods return `Result` and NEVER throw: failures → `{ ok: false, error }`. A stored-mode method with no injected `deps.supabase` → `{ ok:false, error:'Supabase client not configured' }` (not a throw).
- Node test env: inject a fake `SupabaseClient` (cast `as unknown as SupabaseClient`); stub global `fetch` for `gw2AccountInfo`. No real network.
- Tests: Vitest `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` green.

---

### Task 1: `discordGw2.ts` module + wiring

**Files:**
- Create: `src/renderer/src/lib/webClient/discordGw2.ts`, `.../discordGw2.test.ts`
- Modify: `src/renderer/src/lib/webClient/webClient.ts` (+ `webClient.test.ts` additions)

**Interfaces:**
- Consumes: `SupabaseClient` (`@supabase/supabase-js`); `Result`/`Gw2AccountInfo`/`DiscordGuild` (`../../../../preload/index.d`); `WebSettings` (`./settings`); `resolveEffectiveWorkspace` (`./auth`); `Gw2Client` (`../../../../shared/gw2Client`); `parseBoundGw2Guilds` (`../../../../shared/roster/adapters`).
- Produces: `invokeAxitools`, `activeWorkspaceId`, `webGw2AccountInfo`, `webAxitoolsListGuilds`, `webAxitoolsGuildRoles`, `webDiscordOverview`, `webBoundGw2Guilds`, `webDiscordAction`.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/lib/webClient/discordGw2.test.ts`:
```ts
import { test, expect, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  invokeAxitools,
  webAxitoolsListGuilds,
  webBoundGw2Guilds,
  webDiscordAction,
  webGw2AccountInfo
} from './discordGw2'
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

function sbWith(opts: {
  invoke?: ReturnType<typeof vi.fn>
  userId?: string | null
  memberships?: { workspace_id: string; role: string }[]
}): SupabaseClient {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } }))
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(async () => ({ data: opts.memberships ?? [] })) }))
    })),
    functions: { invoke: opts.invoke ?? vi.fn(async () => ({ data: { data: [] }, error: null })) }
  } as unknown as SupabaseClient
}

afterEach(() => vi.unstubAllGlobals())

test('invokeAxitools maps success {data:{data:X}} to ok(X)', async () => {
  const invoke = vi.fn(async () => ({ data: { data: [{ id: '1', name: 'G' }] }, error: null }))
  const r = await invokeAxitools(sbWith({ invoke }), { op: 'listGuilds', key: 'k' })
  expect(r).toEqual({ ok: true, data: [{ id: '1', name: 'G' }] })
})

test('invokeAxitools maps an error (with context.json) to fail(code)', async () => {
  const invoke = vi.fn(async () => ({
    data: null,
    error: { message: 'non-2xx', context: { json: async () => ({ error: 'no_key' }) } }
  }))
  const r = await invokeAxitools(sbWith({ invoke }), { op: 'listGuilds', workspaceId: 'w1' })
  expect(r).toEqual({ ok: false, error: 'no_key' })
})

test('invokeAxitools falls back to error.message without context', async () => {
  const invoke = vi.fn(async () => ({ data: null, error: { message: 'boom' } }))
  const r = await invokeAxitools(sbWith({ invoke }), { op: 'listGuilds', workspaceId: 'w1' })
  expect(r).toEqual({ ok: false, error: 'boom' })
})

test('axitoolsListGuilds validation mode sends key, no workspaceId', async () => {
  const invoke = vi.fn(async () => ({ data: { data: [] }, error: null }))
  await webAxitoolsListGuilds(sbWith({ invoke }), createWebSettings(fakeStorage()), 'mykey')
  expect(invoke).toHaveBeenCalledWith('axitools', { body: { op: 'listGuilds', key: 'mykey' } })
})

test('axitoolsListGuilds stored mode resolves the active workspace', async () => {
  const invoke = vi.fn(async () => ({ data: { data: [] }, error: null }))
  const sb = sbWith({ invoke, userId: 'u1', memberships: [{ workspace_id: 'w9', role: 'owner' }] })
  await webAxitoolsListGuilds(sb, createWebSettings(fakeStorage()))
  expect(invoke).toHaveBeenCalledWith('axitools', { body: { op: 'listGuilds', workspaceId: 'w9' } })
})

test('boundGw2Guilds parses the guild-roles map via the shared adapter', async () => {
  const GUID = 'ABCDEF01-2345-6789-ABCD-EF0123456789'
  const invoke = vi.fn(async () => ({ data: { data: { [GUID]: 'role1' } }, error: null }))
  const r = await webBoundGw2Guilds(sbWith({ invoke }), createWebSettings(fakeStorage()), 'd1', 'k')
  expect(r).toEqual({ ok: true, data: [GUID] })
})

test('discordAction needs an active workspace', async () => {
  const sb = sbWith({ userId: null }) // no user -> no workspace
  const r = await webDiscordAction(sb, createWebSettings(fakeStorage()), 'g', 'kick', {})
  expect(r.ok).toBe(false)
})

test('gw2AccountInfo browser-direct returns ok on a valid key', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    const body = /tokeninfo/.test(url)
      ? { permissions: ['account'] }
      : /\/account$/.test(url)
        ? { name: 'Alice.1234', guilds: [], guild_leader: [] }
        : {}
    return { ok: true, status: 200, json: async () => body } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  const r = await webGw2AccountInfo('a-key')
  expect(r.ok).toBe(true)
  if (r.ok) expect(r.data.accountName).toBe('Alice.1234')
})

test('gw2AccountInfo with no key fails', async () => {
  expect((await webGw2AccountInfo()).ok).toBe(false)
})
```

- [ ] **Step 2: Run — expect FAIL (missing module)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/discordGw2.test.ts`
Expected: FAIL — cannot find `./discordGw2`.

- [ ] **Step 3: Implement `discordGw2.ts`**

```ts
// src/renderer/src/lib/webClient/discordGw2.ts
// Web Discord/GW2 data methods: the AxiTools ops go through the Phase-1 axitools
// Edge Function (functions.invoke), GW2 account validation is browser-direct via
// the shared Gw2Client. Validation mode (caller key) vs stored mode (active
// workspace). All return Result and never throw.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Result, Gw2AccountInfo, DiscordGuild } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { resolveEffectiveWorkspace } from './auth'
import { Gw2Client } from '../../../../shared/gw2Client'
import { parseBoundGw2Guilds } from '../../../../shared/roster/adapters'

const ok = <T>(data: T): Result<T> => ({ ok: true, data })
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

async function extractMsg(error: unknown): Promise<string> {
  const e = error as { message?: string; context?: { json?: () => Promise<unknown> } }
  try {
    if (e?.context?.json) {
      const body = (await e.context.json()) as { error?: string; message?: string }
      return body.message ?? body.error ?? e.message ?? 'request failed'
    }
  } catch {
    /* fall through to message */
  }
  return e?.message ?? 'request failed'
}

export async function invokeAxitools(
  sb: SupabaseClient,
  body: Record<string, unknown>
): Promise<Result<unknown>> {
  const { data, error } = await sb.functions.invoke('axitools', { body })
  if (error) return fail(await extractMsg(error))
  return ok((data as { data?: unknown } | null)?.data)
}

export async function activeWorkspaceId(
  sb: SupabaseClient,
  settings: WebSettings
): Promise<string | null> {
  const {
    data: { user }
  } = await sb.auth.getUser()
  if (!user?.id) return null
  const ws = await resolveEffectiveWorkspace(sb, settings, user.id)
  return ws?.workspaceId ?? null
}

// Validation mode if `key` is given; else stored mode (active workspace). Returns
// null when stored mode has no resolvable workspace.
async function buildBody(
  sb: SupabaseClient,
  settings: WebSettings,
  op: string,
  key: string | undefined,
  extra: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  if (key !== undefined) return { op, key, ...extra }
  const workspaceId = await activeWorkspaceId(sb, settings)
  if (!workspaceId) return null
  return { op, workspaceId, ...extra }
}

export async function webAxitoolsListGuilds(
  sb: SupabaseClient,
  settings: WebSettings,
  key?: string
): Promise<Result<DiscordGuild[]>> {
  const body = await buildBody(sb, settings, 'listGuilds', key, {})
  if (!body) return fail('No active workspace')
  const r = await invokeAxitools(sb, body)
  return r.ok ? ok((r.data as DiscordGuild[]) ?? []) : r
}

export async function webAxitoolsGuildRoles(
  sb: SupabaseClient,
  settings: WebSettings,
  guildId: string,
  key?: string
): Promise<Result<unknown>> {
  const body = await buildBody(sb, settings, 'guildRoles', key, { guildId })
  if (!body) return fail('No active workspace')
  return invokeAxitools(sb, body)
}

export async function webDiscordOverview(
  sb: SupabaseClient,
  settings: WebSettings,
  guildId: string,
  includeMembers: boolean,
  key?: string
): Promise<Result<unknown>> {
  const body = await buildBody(sb, settings, 'discordOverview', key, { guildId, includeMembers })
  if (!body) return fail('No active workspace')
  return invokeAxitools(sb, body)
}

export async function webBoundGw2Guilds(
  sb: SupabaseClient,
  settings: WebSettings,
  discordGuildId: string,
  key?: string
): Promise<Result<string[]>> {
  const body = await buildBody(sb, settings, 'guildRoles', key, { guildId: discordGuildId })
  if (!body) return fail('No active workspace')
  const r = await invokeAxitools(sb, body)
  return r.ok ? ok(parseBoundGw2Guilds(r.data)) : r
}

export async function webDiscordAction(
  sb: SupabaseClient,
  settings: WebSettings,
  guildId: string,
  action: string,
  params: Record<string, unknown>
): Promise<Result<unknown>> {
  const workspaceId = await activeWorkspaceId(sb, settings)
  if (!workspaceId) return fail('No active workspace')
  return invokeAxitools(sb, { op: 'discordAction', workspaceId, guildId, action, params })
}

export async function webGw2AccountInfo(apiKey?: string): Promise<Result<Gw2AccountInfo>> {
  if (!apiKey) return fail('No GW2 API key')
  try {
    return ok((await new Gw2Client(apiKey).accountInfo()) as Gw2AccountInfo)
  } catch (e) {
    return fail((e as Error).message)
  }
}
```

(If `tsc` reports `AccountInfo` not assignable to `Gw2AccountInfo` despite the `as` cast, double-check the field shapes match the contract and keep the cast; both are `{ accountName, permissions, missingPermissions, guilds }`.)

- [ ] **Step 4: Run — expect PASS (10 tests)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/discordGw2.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the six methods in `webClient.ts`**

1. Add imports:
```ts
import {
  webGw2AccountInfo,
  webAxitoolsListGuilds,
  webAxitoolsGuildRoles,
  webDiscordOverview,
  webBoundGw2Guilds,
  webDiscordAction
} from './discordGw2'
import type { Result } from '../../../../preload/index.d'
```
2. After the existing `const requireSupabase = …`, add a Result-returning guard:
```ts
const withSb = <T>(fn: (sb: SupabaseClient) => Promise<Result<T>>): Promise<Result<T>> =>
  deps.supabase ? fn(deps.supabase) : Promise.resolve({ ok: false, error: 'Supabase client not configured' })
```
3. Replace the six `ni(...)` stubs with:
```ts
gw2AccountInfo: (apiKey) => webGw2AccountInfo(apiKey),
axitoolsListGuilds: (key) => withSb((sb) => webAxitoolsListGuilds(sb, settings, key)),
axitoolsGuildRoles: (guildId, key) => withSb((sb) => webAxitoolsGuildRoles(sb, settings, guildId, key)),
discordOverview: (guildId, includeMembers, key) =>
  withSb((sb) => webDiscordOverview(sb, settings, guildId, includeMembers, key)),
boundGw2Guilds: (discordGuildId, key) => withSb((sb) => webBoundGw2Guilds(sb, settings, discordGuildId, key)),
discordAction: (guildId, action, params) => withSb((sb) => webDiscordAction(sb, settings, guildId, action, params)),
```
Leave every other method (the remaining `ni(...)` data methods) unchanged.

- [ ] **Step 6: Add `webClient.test.ts` smoke cases**

Append (reuse the file's `fakeStorage`; add a fake supabase with `functions.invoke`):
```ts
test('wired discord/gw2 methods return Results via an injected supabase', async () => {
  const sb = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({ select: () => ({ eq: async () => ({ data: [{ workspace_id: 'w1', role: 'owner' }] }) }) }),
    functions: { invoke: async () => ({ data: { data: [] }, error: null }) }
  } as unknown as import('@supabase/supabase-js').SupabaseClient
  const c = createWebClient({ storage: fakeStorage(), supabase: sb })
  expect((await c.axitoolsListGuilds()).ok).toBe(true)
  expect((await c.discordOverview('g', true)).ok).toBe(true)
})

test('stored discord method without supabase returns a failed Result (no throw)', async () => {
  const r = await createWebClient({ storage: fakeStorage() }).axitoolsGuildRoles('g')
  expect(r).toEqual({ ok: false, error: 'Supabase client not configured' })
})
```

- [ ] **Step 7: Run web-client suite + full suite + typecheck**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/`
Expected: PASS (discordGw2 10 + the prior suites + 2 new webClient cases).

Run: `npm test` → all pass. Run: `npm run typecheck` → clean (`createWebClient` still a conformant `AxiClient`; the six methods now have real signatures).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/lib/webClient
git commit -m "feat(web): Discord/GW2 data methods (axitools invoke + browser-direct GW2)"
```

---

## Self-Review Notes

- **Spec coverage:** `discordGw2.ts` with `invokeAxitools` (envelope + best-effort error extraction), `activeWorkspaceId` (reuses 2c-1 `resolveEffectiveWorkspace`), and the six method functions incl. validation-vs-stored body building (Step 3); `webClient.ts` wires all six via a Result-returning `withSb` guard (Step 5); tests cover the envelope mapping, both key modes, the shared-adapter parse, the no-workspace fail, and browser-direct GW2 via a stubbed fetch (Steps 1, 6). Other data methods stay `notImplemented`; `src/main`/`src/shared`/`src/preload` untouched.
- **Type consistency:** methods return the exact `AxiRosterApi` shapes (`Result<DiscordGuild[]>`, `Result<unknown>`, `Result<string[]>`, `Result<Gw2AccountInfo>`); the false `Result` arm is narrowed so `r` is returnable across `T`s; `parseBoundGw2Guilds`/`Gw2Client` come from `src/shared`.
- **Never-throws:** every method returns `Result`; `withSb` yields a failed Result (not a throw) when no client; `invokeAxitools`/`webGw2AccountInfo` catch into `fail`.
- **Flagged for real-run:** the `FunctionsHttpError` `context.json()` shape (error-code extraction) is verified only on a live run; the `error.message` fallback prevents any throw if the shape differs.
