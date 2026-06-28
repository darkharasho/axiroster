# Web Version — Phase 1: AxiTools/Discord Proxy Edge Function — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one Supabase Edge Function (`axitools`) that proxies the AxiTools/Discord operations a future web client can't perform itself, authenticated by the Supabase JWT, resolving the AxiTools key from either a caller-supplied candidate (validation) or the workspace's stored encrypted key (stored mode).

**Architecture:** Follows the existing `refresh-roster` pattern — a thin Deno `index.ts` (`Deno.serve`, JWT check, builds injected deps) over a pure, unit-tested `handler.ts`, plus two new `_shared` units (`axivaleKey.ts` key parser, `axitools.ts` HTTP client port). The handler and `_shared` units are pure / dependency-injected and fully tested under vitest; `index.ts` is the only Deno-only file and is verified at deploy + manual `curl`.

**Tech Stack:** Deno (Supabase Edge Functions), TypeScript, vitest. No new dependencies, no new secrets, no DB change.

## Global Constraints

- **Deno + Node-safe** in `_shared/*.ts` and `handler.ts`: NO Node `Buffer`, NO `esm.sh` imports, NO Deno globals. Use `atob`/`btoa`/`TextDecoder`/`URL`/`fetch` (available in both Deno and Node/vitest). Only `axitools/index.ts` may use `Deno.serve` and `esm.sh`.
- **Tests:** vitest, always `--pool=forks --poolOptions.forks.maxForks=2`. New tests live under `supabase/functions/**/*.test.ts` (already in the vitest `include`).
- **`supabase/functions` is NOT covered by `npm run typecheck`** (excluded from both tsconfigs). Do not rely on typecheck for these files — vitest is the gate for the pure units; deploy + `curl` is the gate for `index.ts`.
- **Write-capable roles** = `('owner','write')` — must match `can_write()` in `supabase/migrations/0002_rls_policies.sql` exactly.
- **AxiTools key format:** `axt1.<base64url(baseUrl, no padding)>.<secret>`; the **whole key** (all three parts) is the bearer token, the middle part decodes to the bot's base URL.
- **Stored secret:** column `workspace_secrets.axitools_key_enc`; decrypt with `LEADER_KEY_SECRET` via `_shared/crypto.ts`'s `decryptKey(payload, base64Secret): Promise<string>`.
- **Response envelope:** success → `200 { data: <raw AxiTools response> }`; error → `{ error: "<code>" }` (plus `message` on `upstream_error`).
- **No `src/main`, renderer, or DB/migration changes.** Reads existing `workspace_members` and `workspace_secrets` only.
- The Deno client port intentionally **omits** the desktop's `resilientFetch` retry/timeout (YAGNI on Edge); a `fetch` rejection maps to `AxitoolsError` → `502 upstream_error`.

---

### Task 1: `_shared/axivaleKey.ts` — AxiTools key parser (Deno + Node safe)

**Files:**
- Create: `supabase/functions/_shared/axivaleKey.ts`
- Test: `supabase/functions/_shared/axivaleKey.test.ts`

**Interfaces:**
- Produces: `parseAxitoolsKey(raw: string): { baseUrl: string; token: string } | null` and `interface ParsedAxitoolsKey { baseUrl: string; token: string }`. Consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/axivaleKey.test.ts`:

```ts
// supabase/functions/_shared/axivaleKey.test.ts
import { test, expect } from 'vitest'
import { parseAxitoolsKey } from './axivaleKey'

// base64url (no padding) of a URL, the way the AxiTools bot mints keys.
function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const KEY = `axt1.${b64url('https://bot.example.com')}.s3cr3t`

test('parses a valid axt1 key into baseUrl + full-key token', () => {
  expect(parseAxitoolsKey(KEY)).toEqual({ baseUrl: 'https://bot.example.com', token: KEY })
})

test('trims trailing slashes from baseUrl', () => {
  const k = `axt1.${b64url('https://bot.example.com/')}.s`
  expect(parseAxitoolsKey(k)?.baseUrl).toBe('https://bot.example.com')
})

test('rejects wrong prefix, wrong part count, and empty secret', () => {
  expect(parseAxitoolsKey(`axv1.${b64url('https://b')}.s`)).toBeNull()
  expect(parseAxitoolsKey(`axt1.${b64url('https://b')}`)).toBeNull()
  expect(parseAxitoolsKey(`axt1.${b64url('https://b')}.`)).toBeNull()
})

test('rejects bad base64 and non-http(s) URLs', () => {
  expect(parseAxitoolsKey('axt1.@@@@.s')).toBeNull()
  expect(parseAxitoolsKey(`axt1.${b64url('ftp://x.com')}.s`)).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 supabase/functions/_shared/axivaleKey.test.ts`
Expected: FAIL — cannot find module `./axivaleKey`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/axivaleKey.ts`:

```ts
// supabase/functions/_shared/axivaleKey.ts
// AxiTools keys are minted per Discord server as:
//   axt1.<base64url(base URL, no padding)>.<secret>
// The whole key is sent as the bearer token; the middle part decodes to the
// bot's API base URL. Deno + Node safe (atob/TextDecoder; no Node Buffer).
// Port of src/main/axivaleKey.ts.
export interface ParsedAxitoolsKey {
  baseUrl: string
  token: string
}

export function parseAxitoolsKey(raw: string): ParsedAxitoolsKey | null {
  const key = raw.trim()
  const parts = key.split('.')
  if (parts.length !== 3 || parts[0] !== 'axt1' || parts[2] === '') return null
  let decoded: string
  try {
    decoded = b64urlToUtf8(parts[1])
  } catch {
    return null
  }
  let url: URL
  try {
    url = new URL(decoded)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return { baseUrl: decoded.replace(/\/+$/, ''), token: key }
}

function b64urlToUtf8(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad) // throws on invalid base64 chars
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 supabase/functions/_shared/axivaleKey.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/axivaleKey.ts supabase/functions/_shared/axivaleKey.test.ts
git commit -m "feat(edge): axt1 key parser for the axitools proxy"
```

---

### Task 2: `_shared/axitools.ts` — AxiTools HTTP client port (injected fetch)

**Files:**
- Create: `supabase/functions/_shared/axitools.ts`
- Test: `supabase/functions/_shared/axitools.test.ts`

**Interfaces:**
- Produces:
  - `class AxitoolsError extends Error`
  - `interface AxitoolsClientLike` with `listGuilds()`, `guildRoles(guildId)`, `discordOverview(guildId, includeMembers)`, `membersLinked(guildId)`, `discordAction(guildId, action, params)` — each `Promise<unknown>`
  - `class AxitoolsClient implements AxitoolsClientLike` with constructor `(fetchFn: typeof fetch, baseUrl: string, token: string)`
- Consumed by Tasks 3 (the `AxitoolsClientLike` type) and 4 (the concrete `AxitoolsClient`).

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/axitools.test.ts`:

```ts
// supabase/functions/_shared/axitools.test.ts
import { test, expect, vi } from 'vitest'
import { AxitoolsClient, AxitoolsError } from './axitools'

function res(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response
}

test('listGuilds GETs /guilds with the bearer token', async () => {
  const fetchFn = vi.fn(async () => res(200, [{ id: '1', name: 'G' }]))
  const c = new AxitoolsClient(fetchFn as unknown as typeof fetch, 'https://b', 'axt1.x.y')
  await expect(c.listGuilds()).resolves.toEqual([{ id: '1', name: 'G' }])
  expect(fetchFn).toHaveBeenCalledWith(
    'https://b/guilds',
    expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer axt1.x.y' })
    })
  )
})

test('discordOverview adds ?include=members only when requested', async () => {
  const fetchFn = vi.fn(async () => res(200, {}))
  const c = new AxitoolsClient(fetchFn as unknown as typeof fetch, 'https://b', 't')
  await c.discordOverview('g', true)
  await c.discordOverview('g', false)
  expect(fetchFn.mock.calls[0][0]).toBe('https://b/guilds/g/discord?include=members')
  expect(fetchFn.mock.calls[1][0]).toBe('https://b/guilds/g/discord')
})

test('guildRoles and membersLinked hit their paths', async () => {
  const fetchFn = vi.fn(async () => res(200, {}))
  const c = new AxitoolsClient(fetchFn as unknown as typeof fetch, 'https://b', 't')
  await c.guildRoles('g')
  await c.membersLinked('g')
  expect(fetchFn.mock.calls[0][0]).toBe('https://b/guilds/g/guild-roles')
  expect(fetchFn.mock.calls[1][0]).toBe('https://b/guilds/g/members-linked')
})

test('discordAction POSTs {action, params}', async () => {
  const fetchFn = vi.fn(async () => res(200, { ok: true }))
  const c = new AxitoolsClient(fetchFn as unknown as typeof fetch, 'https://b', 't')
  await c.discordAction('g', 'role_assign', { roleId: 'r' })
  expect(fetchFn).toHaveBeenCalledWith(
    'https://b/guilds/g/discord/actions',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'role_assign', params: { roleId: 'r' } })
    })
  )
})

test('204 resolves to undefined', async () => {
  const c = new AxitoolsClient((async () => res(204, null)) as unknown as typeof fetch, 'https://b', 't')
  await expect(c.membersLinked('g')).resolves.toBeUndefined()
})

test('401/403 throws AxitoolsError (key rejected)', async () => {
  const c = new AxitoolsClient((async () => res(403, {})) as unknown as typeof fetch, 'https://b', 't')
  await expect(c.guildRoles('g')).rejects.toBeInstanceOf(AxitoolsError)
})

test('non-OK throws AxitoolsError', async () => {
  const c = new AxitoolsClient((async () => res(500, {})) as unknown as typeof fetch, 'https://b', 't')
  await expect(c.listGuilds()).rejects.toBeInstanceOf(AxitoolsError)
})

test('fetch rejection throws AxitoolsError (unreachable)', async () => {
  const c = new AxitoolsClient(
    (async () => {
      throw new Error('net')
    }) as unknown as typeof fetch,
    'https://b',
    't'
  )
  await expect(c.listGuilds()).rejects.toBeInstanceOf(AxitoolsError)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 supabase/functions/_shared/axitools.test.ts`
Expected: FAIL — cannot find module `./axitools`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/axitools.ts`:

```ts
// supabase/functions/_shared/axitools.ts
// Deno + Node port of src/main/axitoolsClient.ts, trimmed to the proxied ops.
// fetch is injected for testability. Same Bearer + error semantics as desktop.
// NOTE: intentionally omits the desktop's resilientFetch retry/timeout (YAGNI on
// Edge); a fetch rejection surfaces as AxitoolsError and the handler maps it to 502.
export class AxitoolsError extends Error {}

export interface AxitoolsClientLike {
  listGuilds(): Promise<unknown>
  guildRoles(guildId: string): Promise<unknown>
  discordOverview(guildId: string, includeMembers: boolean): Promise<unknown>
  membersLinked(guildId: string): Promise<unknown>
  discordAction(guildId: string, action: string, params: Record<string, unknown>): Promise<unknown>
}

export class AxitoolsClient implements AxitoolsClientLike {
  constructor(
    private readonly fetchFn: typeof fetch,
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    let resp: Response
    try {
      resp = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      })
    } catch {
      throw new AxitoolsError('The AxiTools bot is not reachable — is it running?')
    }
    if (resp.status === 204) return undefined
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        throw new AxitoolsError(
          (data as { error?: string }).error ??
            'This AxiTools key was rejected (invalid or revoked). Regenerate it in Discord with /config apikey generate.'
        )
      }
      throw new AxitoolsError(
        (data as { error?: string }).error ?? `AxiTools API error (HTTP ${resp.status})`
      )
    }
    return data
  }

  listGuilds(): Promise<unknown> {
    return this.request('GET', '/guilds')
  }
  guildRoles(guildId: string): Promise<unknown> {
    return this.request('GET', `/guilds/${guildId}/guild-roles`)
  }
  discordOverview(guildId: string, includeMembers: boolean): Promise<unknown> {
    return this.request('GET', `/guilds/${guildId}/discord${includeMembers ? '?include=members' : ''}`)
  }
  membersLinked(guildId: string): Promise<unknown> {
    return this.request('GET', `/guilds/${guildId}/members-linked`)
  }
  discordAction(guildId: string, action: string, params: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', `/guilds/${guildId}/discord/actions`, { action, params })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 supabase/functions/_shared/axitools.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/axitools.ts supabase/functions/_shared/axitools.test.ts
git commit -m "feat(edge): AxiTools HTTP client port (injected fetch)"
```

---

### Task 3: `axitools/handler.ts` — pure proxy handler (key-mode + authz + routing)

**Files:**
- Create: `supabase/functions/axitools/handler.ts`
- Test: `supabase/functions/axitools/handler.test.ts`

**Interfaces:**
- Consumes: `parseAxitoolsKey` from `../_shared/axivaleKey` (Task 1); `AxitoolsClientLike` from `../_shared/axitools` (Task 2).
- Produces:
  - `interface AxitoolsInput { userId: string; op?: string; key?: string; workspaceId?: string; guildId?: string; includeMembers?: boolean; action?: string; params?: Record<string, unknown> }`
  - `interface AxitoolsDeps { decrypt: (enc: string, secret: string) => Promise<string>; keySecret: string; client: (baseUrl: string, token: string) => AxitoolsClientLike; db: { role(ws: string, uid: string): Promise<string | null>; getAxitoolsSecret(ws: string): Promise<string | null> } }`
  - `handleAxitools(deps: AxitoolsDeps, input: AxitoolsInput): Promise<{ status: number; body: unknown }>`
- Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/axitools/handler.test.ts`:

```ts
// supabase/functions/axitools/handler.test.ts
import { test, expect, vi } from 'vitest'
import { handleAxitools } from './handler'

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const VALID_KEY = `axt1.${b64url('https://bot')}.tok`

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    listGuilds: vi.fn(async () => [{ id: '1', name: 'G' }]),
    guildRoles: vi.fn(async () => ({ roles: [] })),
    discordOverview: vi.fn(async () => ({ members: [] })),
    membersLinked: vi.fn(async () => []),
    discordAction: vi.fn(async () => ({ ok: true })),
    ...overrides
  }
}

// role: undefined => 'owner' (member, write-capable); pass null for non-member,
//   or a string like 'read' for a non-write member.
// secret: undefined => 'enc' present; pass null for no shared key.
function deps(opts: { role?: string | null; secret?: string | null; client?: ReturnType<typeof fakeClient> } = {}) {
  const client = opts.client ?? fakeClient()
  const d = {
    decrypt: vi.fn(async () => VALID_KEY),
    keySecret: 's',
    client: vi.fn(() => client),
    db: {
      role: vi.fn(async () => (opts.role === undefined ? 'owner' : opts.role)),
      getAxitoolsSecret: vi.fn(async () => (opts.secret === undefined ? 'enc' : opts.secret))
    }
  }
  return { d, client }
}

test('unknown op => 400', async () => {
  const { d } = deps()
  expect((await handleAxitools(d as never, { userId: 'u', op: 'nope', workspaceId: 'w' })).status).toBe(400)
})

test('stored read by a member returns { data } passthrough', async () => {
  const { d, client } = deps({ role: 'read' })
  const r = await handleAxitools(d as never, { userId: 'u', op: 'listGuilds', workspaceId: 'w' })
  expect(r.status).toBe(200)
  expect(r.body).toEqual({ data: [{ id: '1', name: 'G' }] })
  expect(client.listGuilds).toHaveBeenCalled()
})

test('stored mode, non-member => 403 not_member', async () => {
  const { d } = deps({ role: null })
  const r = await handleAxitools(d as never, { userId: 'u', op: 'guildRoles', workspaceId: 'w', guildId: 'g' })
  expect(r).toEqual({ status: 403, body: { error: 'not_member' } })
})

test('stored mode, no shared key => 409 no_key', async () => {
  const { d } = deps({ secret: null })
  const r = await handleAxitools(d as never, { userId: 'u', op: 'listGuilds', workspaceId: 'w' })
  expect(r.status).toBe(409)
})

test('discordAction by a non-write member => 403 not_authorized', async () => {
  const { d } = deps({ role: 'read' })
  const r = await handleAxitools(d as never, {
    userId: 'u', op: 'discordAction', workspaceId: 'w', guildId: 'g', action: 'member_kick', params: {}
  })
  expect(r).toEqual({ status: 403, body: { error: 'not_authorized' } })
})

test('discordAction by an owner calls the client and returns data', async () => {
  const { d, client } = deps({ role: 'owner' })
  const r = await handleAxitools(d as never, {
    userId: 'u', op: 'discordAction', workspaceId: 'w', guildId: 'g', action: 'role_assign', params: { roleId: 'r' }
  })
  expect(r.status).toBe(200)
  expect(client.discordAction).toHaveBeenCalledWith('g', 'role_assign', { roleId: 'r' })
})

test('a "write" role may discordAction', async () => {
  const { d } = deps({ role: 'write' })
  const r = await handleAxitools(d as never, {
    userId: 'u', op: 'discordAction', workspaceId: 'w', guildId: 'g', action: 'role_assign', params: {}
  })
  expect(r.status).toBe(200)
})

test('validation mode (key supplied) skips membership entirely', async () => {
  const { d, client } = deps()
  const r = await handleAxitools(d as never, { userId: 'u', op: 'listGuilds', key: VALID_KEY })
  expect(r.status).toBe(200)
  expect(d.db.role).not.toHaveBeenCalled()
  expect(d.db.getAxitoolsSecret).not.toHaveBeenCalled()
  expect(client.listGuilds).toHaveBeenCalled()
})

test('validation mode with a malformed key => 400', async () => {
  const { d } = deps()
  const r = await handleAxitools(d as never, { userId: 'u', op: 'listGuilds', key: 'not-a-key' })
  expect(r.status).toBe(400)
})

test('discordAction in validation mode => 400 (stored-only)', async () => {
  const { d } = deps()
  const r = await handleAxitools(d as never, {
    userId: 'u', op: 'discordAction', guildId: 'g', action: 'member_kick', params: {}, key: VALID_KEY
  })
  expect(r.status).toBe(400)
})

test('stored mode with a corrupt stored key => 400', async () => {
  const { d } = deps()
  d.decrypt = vi.fn(async () => 'garbage') as never
  const r = await handleAxitools(d as never, { userId: 'u', op: 'listGuilds', workspaceId: 'w' })
  expect(r.status).toBe(400)
})

test('guildRoles without guildId => 400', async () => {
  const { d } = deps()
  const r = await handleAxitools(d as never, { userId: 'u', op: 'guildRoles', workspaceId: 'w' })
  expect(r.status).toBe(400)
})

test('discordAction without action => 400', async () => {
  const { d } = deps({ role: 'owner' })
  const r = await handleAxitools(d as never, { userId: 'u', op: 'discordAction', workspaceId: 'w', guildId: 'g', params: {} })
  expect(r.status).toBe(400)
})

test('upstream failure => 502 carrying the message', async () => {
  const client = fakeClient({ listGuilds: vi.fn(async () => { throw new Error('bot down') }) })
  const { d } = deps({ client })
  const r = await handleAxitools(d as never, { userId: 'u', op: 'listGuilds', workspaceId: 'w' })
  expect(r.status).toBe(502)
  expect((r.body as { error: string; message: string }).error).toBe('upstream_error')
  expect((r.body as { message: string }).message).toBe('bot down')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 supabase/functions/axitools/handler.test.ts`
Expected: FAIL — cannot find module `./handler`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/axitools/handler.ts`:

```ts
// supabase/functions/axitools/handler.ts
// Pure proxy handler for the `axitools` edge function. Resolves the AxiTools key
// (validation mode = caller-supplied candidate key; stored mode = workspace's
// encrypted shared key), authorizes the caller, calls the AxiTools client, and
// maps the result to an HTTP { status, body }. No I/O — everything is injected.
import { parseAxitoolsKey } from '../_shared/axivaleKey.ts'
import type { AxitoolsClientLike } from '../_shared/axitools.ts'

export interface AxitoolsInput {
  userId: string
  op?: string
  key?: string
  workspaceId?: string
  guildId?: string
  includeMembers?: boolean
  action?: string
  params?: Record<string, unknown>
}

export interface AxitoolsDeps {
  decrypt: (enc: string, secret: string) => Promise<string>
  keySecret: string
  client: (baseUrl: string, token: string) => AxitoolsClientLike
  db: {
    role(ws: string, uid: string): Promise<string | null>
    getAxitoolsSecret(ws: string): Promise<string | null>
  }
}

type Result = { status: number; body: unknown }

const READ_OPS = new Set(['listGuilds', 'guildRoles', 'discordOverview', 'membersLinked'])
const WRITE_OPS = new Set(['discordAction'])
const WRITE_ROLES = new Set(['owner', 'write']) // mirrors can_write() in 0002_rls_policies.sql

const bad = (): Result => ({ status: 400, body: { error: 'bad_request' } })

export async function handleAxitools(deps: AxitoolsDeps, input: AxitoolsInput): Promise<Result> {
  const op = input.op
  if (!op || (!READ_OPS.has(op) && !WRITE_OPS.has(op))) return bad()
  if (op !== 'listGuilds' && !input.guildId) return bad()
  if (op === 'discordAction' && !input.action) return bad()

  // Resolve the key + authorize.
  let parsed: { baseUrl: string; token: string } | null
  if (input.key !== undefined) {
    // Validation mode: any signed-in user, but writes are stored-only.
    if (WRITE_OPS.has(op)) return bad()
    parsed = parseAxitoolsKey(input.key)
    if (!parsed) return bad()
  } else {
    // Stored mode: must be a member; discordAction needs a write-capable role.
    if (!input.workspaceId) return bad()
    const role = await deps.db.role(input.workspaceId, input.userId)
    if (!role) return { status: 403, body: { error: 'not_member' } }
    if (WRITE_OPS.has(op) && !WRITE_ROLES.has(role)) {
      return { status: 403, body: { error: 'not_authorized' } }
    }
    const enc = await deps.db.getAxitoolsSecret(input.workspaceId)
    if (!enc) return { status: 409, body: { error: 'no_key' } }
    parsed = parseAxitoolsKey(await deps.decrypt(enc, deps.keySecret))
    if (!parsed) return bad() // stored key corrupt
  }

  const client = deps.client(parsed.baseUrl, parsed.token)
  try {
    const data = await callOp(client, op, input)
    return { status: 200, body: { data } }
  } catch (e) {
    return { status: 502, body: { error: 'upstream_error', message: (e as Error).message } }
  }
}

function callOp(client: AxitoolsClientLike, op: string, input: AxitoolsInput): Promise<unknown> {
  switch (op) {
    case 'listGuilds':
      return client.listGuilds()
    case 'guildRoles':
      return client.guildRoles(input.guildId as string)
    case 'discordOverview':
      return client.discordOverview(input.guildId as string, !!input.includeMembers)
    case 'membersLinked':
      return client.membersLinked(input.guildId as string)
    case 'discordAction':
      return client.discordAction(input.guildId as string, input.action as string, input.params ?? {})
    default:
      throw new Error('unreachable')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 supabase/functions/axitools/handler.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/axitools/handler.ts supabase/functions/axitools/handler.test.ts
git commit -m "feat(edge): axitools proxy handler (key-mode, authz, routing)"
```

---

### Task 4: `axitools/index.ts` — Deno.serve wiring + deploy docs

**Files:**
- Create: `supabase/functions/axitools/index.ts`

**Interfaces:**
- Consumes: `handleAxitools`/`AxitoolsDeps` (Task 3), `AxitoolsClient` (Task 2), `decryptKey` from `../_shared/crypto.ts`. No new exports.

This is the only Deno-only file (`Deno.serve` + `esm.sh` import) — it is NOT in `npm run typecheck` and has NO unit test, exactly like every existing function `index.ts` (e.g. `refresh-roster/index.ts`). Its gate is the full suite still passing + visual diff against `refresh-roster/index.ts` + deploy/`curl`. Keep it a thin adapter only.

- [ ] **Step 1: Write the implementation**

Create `supabase/functions/axitools/index.ts`:

```ts
// supabase/functions/axitools/index.ts
// Edge entrypoint for the AxiTools/Discord proxy. Verifies the caller's Supabase
// JWT, builds injected deps (service-role DB reads + key decrypt + a fetch-backed
// AxiTools client), and delegates to the pure handler. Mirrors refresh-roster.
//
// Request body: { op, key?, workspaceId?, guildId?, includeMembers?, action?, params? }
//   - op: listGuilds | guildRoles | discordOverview | membersLinked | discordAction
//   - key present  => validation mode (uses that candidate axt1 key directly)
//   - key absent   => stored mode (decrypts workspace_secrets.axitools_key_enc)
// Response: 200 { data } on success; { error } (+ message on upstream_error) otherwise.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptKey } from '../_shared/crypto.ts'
import { AxitoolsClient } from '../_shared/axitools.ts'
import { handleAxitools } from './handler.ts'

Deno.serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const keySecret = Deno.env.get('LEADER_KEY_SECRET')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
  })
  const {
    data: { user }
  } = await userClient.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const db = createClient(url, service)
  const deps = {
    decrypt: decryptKey,
    keySecret,
    client: (baseUrl: string, token: string) => new AxitoolsClient(fetch, baseUrl, token),
    db: {
      role: async (ws: string, uid: string) => {
        const { data, error } = await db
          .from('workspace_members')
          .select('role')
          .eq('workspace_id', ws)
          .eq('user_id', uid)
          .maybeSingle()
        if (error) throw new Error(error.message)
        return (data as { role?: string } | null)?.role ?? null
      },
      getAxitoolsSecret: async (ws: string) => {
        const { data, error } = await db
          .from('workspace_secrets')
          .select('axitools_key_enc')
          .eq('workspace_id', ws)
          .maybeSingle()
        if (error) throw new Error(error.message)
        return (data as { axitools_key_enc?: string } | null)?.axitools_key_enc ?? null
      }
    }
  }

  const r = await handleAxitools(deps as never, {
    userId: user.id,
    op: body?.op as string | undefined,
    key: body?.key as string | undefined,
    workspaceId: body?.workspaceId as string | undefined,
    guildId: body?.guildId as string | undefined,
    includeMembers: body?.includeMembers as boolean | undefined,
    action: body?.action as string | undefined,
    params: body?.params as Record<string, unknown> | undefined
  })
  return new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: { 'Content-Type': 'application/json' }
  })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
```

- [ ] **Step 2: Verify the file by inspection**

Open `supabase/functions/refresh-roster/index.ts` side by side and confirm the new `index.ts` matches its shape: same env var names, same `auth.getUser()` 401 guard, same service-role `db` client, same `new Response(JSON.stringify(r.body), { status: r.status, … })` return. Confirm the deps object exactly matches the `AxitoolsDeps` interface from Task 3 (field names `decrypt`, `keySecret`, `client`, `db.role`, `db.getAxitoolsSecret`).

- [ ] **Step 3: Run the full suite (no regressions)**

Run: `npm test`
Expected: all suites pass, including the three new ones from Tasks 1-3. (`index.ts` itself has no test — it is not imported by any `.test.ts`.)

- [ ] **Step 4: Record the deploy + manual smoke (no automated gate)**

The function deploys with the existing toolchain and **no new secrets** (reuses `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LEADER_KEY_SECRET`):

```bash
supabase functions deploy axitools
```

Manual smoke once deployed (cannot run in CI — needs a real session JWT and an `axt1.` key). Document these two `curl`s in the commit body so they're discoverable:

```bash
# Validation mode: list the Discord guilds a candidate key can see.
curl -sS -X POST "$SUPABASE_URL/functions/v1/axitools" \
  -H "Authorization: Bearer $USER_JWT" -H "content-type: application/json" \
  -d '{"op":"listGuilds","key":"axt1.<...>.<...>"}'

# Stored mode: roles for a guild using the workspace's shared key.
curl -sS -X POST "$SUPABASE_URL/functions/v1/axitools" \
  -H "Authorization: Bearer $USER_JWT" -H "content-type: application/json" \
  -d '{"op":"guildRoles","workspaceId":"<ws>","guildId":"<discord-guild-id>"}'
```

Expected: `200 { "data": … }`; a bad/absent JWT → `401 { "error": "unauthorized" }`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/axitools/index.ts
git commit -m "feat(edge): axitools proxy entrypoint (Deno.serve)

Deploy: supabase functions deploy axitools (no new secrets).
Manual smoke (needs a real JWT + axt1 key):
  POST /functions/v1/axitools {op:listGuilds,key:axt1...}      -> 200 {data}
  POST /functions/v1/axitools {op:guildRoles,workspaceId,guildId} -> 200 {data}"
```

---

## Self-Review Notes

- **Spec coverage:** single `axitools` function (Tasks 1-4); five ops routed in the handler (Task 3); validation vs stored key modes (Task 3); per-op authz incl. write-gated `discordAction` with roles `('owner','write')` (Task 3, Global Constraints); `{ data }` success / `{ error }` envelope + full error table 400/401/403/409/502 (Task 3 handler + Task 4 index 401); ported client with desktop error semantics (Task 2); `axt1.` key parser, Deno+Node safe (Task 1); deploy + no new secrets + manual curl (Task 4). GW2 validation deliberately browser-direct (no function) — nothing to implement. No DB/migration, no `src/main`/renderer change.
- **Type consistency:** `AxitoolsClientLike` (Task 2) is the type `AxitoolsDeps.client` returns (Task 3) and `AxitoolsClient` (Task 2) implements it (Task 4 constructs it). `parseAxitoolsKey` return shape `{ baseUrl, token }` (Task 1) is what the handler destructures (Task 3). `decryptKey(payload, base64Secret)` (existing `_shared/crypto.ts`) matches `AxitoolsDeps.decrypt` signature and the Task 4 wiring. Op string set is identical in `READ_OPS`/`WRITE_OPS` (handler), `callOp` switch, and the client method names.
- **Deferred/again-stated:** the 401-unauthorized path lives in `index.ts` (Task 4), not the handler — the handler assumes an authenticated `userId`, matching `refresh-roster`. This is why the handler has no 401 test.
- **Known intentional deviation from a literal spec reading:** the Deno client port omits `resilientFetch` retry/timeout (Global Constraints); the spec's "timeout → did not respond" was illustrative of desktop semantics. A fetch rejection → `AxitoolsError` → 502 covers the upstream-failure requirement.
