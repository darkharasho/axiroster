# Web Version — Phase 2c-1: Web Auth + Session Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the web client's auth foundation — an injected Supabase browser client + `authStatus`/`authSignIn`/`authSignOut` + effective-workspace resolution — wiring them into the existing `WebAxiClient`, mock-tested.

**Architecture:** Two new modules (`supabaseClient.ts` factory, `auth.ts` helpers) under `src/renderer/src/lib/webClient/`, plus extending `WebClientDeps` and the three auth methods in `webClient.ts`. The auth flow mirrors the desktop (`auth:status` → `effectiveWorkspace`) but uses a browser OAuth redirect (`signInWithOAuth`). Helpers take an injected `SupabaseClient`; tests pass a fake cast `as unknown as SupabaseClient`.

**Tech Stack:** TypeScript, React renderer, Vitest, `@supabase/supabase-js` (existing dep). No new dependencies.

## Global Constraints

- Changes confined to `src/renderer/src/lib/webClient/` (two new files + edits to `webClient.ts` + new test files). Do NOT touch `src/main`, `src/preload`, the rest of the renderer, or the `AxiClient` contract.
- `createWebClient` must still return a conformant `AxiClient` (typecheck stays green).
- The web Supabase client uses `{ auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }` (browser SPA setup) — NOT the desktop's `persistSession: false`.
- OAuth: `signInWithOAuth({ provider: 'discord', options: { redirectTo } })`; `redirectTo` defaults to `globalThis.location?.origin`.
- `authStatus` never throws (degrades to `{ signedIn: false }`); `authSignIn`/`authSignOut` throw "Supabase client not configured" when no client is injected.
- Node test env: inject fakes; never dereference real browser globals/network.
- Tests: Vitest `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` green.

---

### Task 1: Supabase browser client factory + auth helpers + wiring

**Files:**
- Create: `src/renderer/src/lib/webClient/supabaseClient.ts`, `.../supabaseClient.test.ts`
- Create: `src/renderer/src/lib/webClient/auth.ts`, `.../auth.test.ts`
- Modify: `src/renderer/src/lib/webClient/webClient.ts` (+ add cases to `webClient.test.ts`)

**Interfaces:**
- Consumes: `AxiClient` from `../client`; `createWebSettings`/`WebSettings` from `./settings`; `SupabaseClient` from `@supabase/supabase-js`; `AuthStatus`/`AuthSignInResult` from `../../../preload/index.d`.
- Produces: `createBrowserSupabase(url, anonKey)`, `webAuthStatus(sb, settings)`, `webSignIn(sb, redirectTo)`, `webSignOut(sb)`, `resolveEffectiveWorkspace(sb, settings, userId)`.

- [ ] **Step 1: Write failing tests for `supabaseClient` + `auth`**

`src/renderer/src/lib/webClient/supabaseClient.test.ts`:
```ts
import { test, expect } from 'vitest'
import { createBrowserSupabase } from './supabaseClient'

test('constructs a client exposing auth + from (no network)', () => {
  const sb = createBrowserSupabase('https://x.supabase.co', 'anon-key')
  expect(typeof sb.auth.getSession).toBe('function')
  expect(typeof sb.from).toBe('function')
})
```

`src/renderer/src/lib/webClient/auth.test.ts`:
```ts
import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { webAuthStatus, webSignIn, webSignOut } from './auth'
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

// Minimal Supabase fake. `memberships` drives from().select().eq().
function fakeSb(opts: {
  session?: unknown
  userId?: string | null
  memberships?: { workspace_id: string; role: string }[]
  membersThrows?: boolean
}): SupabaseClient {
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: opts.session ?? null } })),
      getUser: vi.fn(async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } })),
      signInWithOAuth: vi.fn(async () => ({ data: { provider: 'discord', url: 'u' }, error: null })),
      signOut: vi.fn(async () => ({ error: null }))
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(async () => {
          if (opts.membersThrows) throw new Error('rls')
          return { data: opts.memberships ?? [] }
        })
      }))
    }))
  } as unknown as SupabaseClient
}

test('webAuthStatus: no session => signed out', async () => {
  expect(await webAuthStatus(fakeSb({ session: null }), createWebSettings(fakeStorage()))).toEqual({
    signedIn: false
  })
})

test('webAuthStatus: session + one membership => resolved', async () => {
  const sb = fakeSb({
    session: { user: { id: 'u1' } },
    userId: 'u1',
    memberships: [{ workspace_id: 'w1', role: 'owner' }]
  })
  expect(await webAuthStatus(sb, createWebSettings(fakeStorage()))).toEqual({
    signedIn: true,
    role: 'owner',
    workspaceId: 'w1',
    userId: 'u1'
  })
})

test('webAuthStatus: picks the membership matching activeGuildId, else first', async () => {
  const settings = createWebSettings(fakeStorage())
  settings.set('activeGuildId', 'w2')
  const sb = fakeSb({
    session: { user: { id: 'u1' } },
    userId: 'u1',
    memberships: [
      { workspace_id: 'w1', role: 'write' },
      { workspace_id: 'w2', role: 'owner' }
    ]
  })
  expect((await webAuthStatus(sb, settings)).workspaceId).toBe('w2')
})

test('webAuthStatus: a membership-query throw degrades to signed-out workspace (still signedIn)', async () => {
  const sb = fakeSb({ session: { user: { id: 'u1' } }, userId: 'u1', membersThrows: true })
  const r = await webAuthStatus(sb, createWebSettings(fakeStorage()))
  expect(r.signedIn).toBe(true)
  expect(r.workspaceId).toBeUndefined()
})

test('webSignIn: discord OAuth with redirectTo, resolves null', async () => {
  const sb = fakeSb({})
  await expect(webSignIn(sb, 'https://roster.axi.link')).resolves.toBeNull()
  expect(sb.auth.signInWithOAuth).toHaveBeenCalledWith({
    provider: 'discord',
    options: { redirectTo: 'https://roster.axi.link' }
  })
})

test('webSignOut: calls supabase signOut', async () => {
  const sb = fakeSb({})
  await webSignOut(sb)
  expect(sb.auth.signOut).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run — expect FAIL (missing modules)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/supabaseClient.test.ts src/renderer/src/lib/webClient/auth.test.ts`
Expected: FAIL — cannot find `./supabaseClient` / `./auth`.

- [ ] **Step 3: Implement `supabaseClient.ts`**

```ts
// src/renderer/src/lib/webClient/supabaseClient.ts
// The browser Supabase client. Unlike the desktop (persistSession:false, manual
// tokens), the web SPA persists the session in localStorage and auto-detects the
// OAuth callback in the URL — the standard Supabase browser setup.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function createBrowserSupabase(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  })
}
```

- [ ] **Step 4: Implement `auth.ts`**

```ts
// src/renderer/src/lib/webClient/auth.ts
// Web auth, mirroring the desktop auth:status / effectiveWorkspace flow but with
// a browser OAuth redirect. Helpers take an injected SupabaseClient for testing.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthStatus, AuthSignInResult } from '../../../preload/index.d'
import type { WebSettings } from './settings'

export async function resolveEffectiveWorkspace(
  sb: SupabaseClient,
  settings: WebSettings,
  userId: string
): Promise<{ workspaceId: string; role: string } | null> {
  const { data } = await sb
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', userId)
  const memberships = (data ?? []) as { workspace_id: string; role: string }[]
  if (memberships.length === 0) return null
  const active = settings.get('activeGuildId')
  const chosen = (active && memberships.find((m) => m.workspace_id === active)) || memberships[0]
  return { workspaceId: String(chosen.workspace_id), role: String(chosen.role) }
}

export async function webAuthStatus(sb: SupabaseClient, settings: WebSettings): Promise<AuthStatus> {
  try {
    const {
      data: { session }
    } = await sb.auth.getSession()
    if (!session) return { signedIn: false }
    const {
      data: { user }
    } = await sb.auth.getUser()
    const userId = user?.id
    if (!userId) return { signedIn: false }
    let ws: { workspaceId: string; role: string } | null = null
    try {
      ws = await resolveEffectiveWorkspace(sb, settings, userId)
    } catch {
      ws = null // a transient membership read shouldn't crash auth; degrade to no-workspace
    }
    return { signedIn: true, role: ws?.role, workspaceId: ws?.workspaceId, userId }
  } catch {
    return { signedIn: false }
  }
}

export async function webSignIn(
  sb: SupabaseClient,
  redirectTo: string
): Promise<AuthSignInResult | null> {
  // Browser OAuth: this navigates the page away; the post-redirect load resolves
  // status via webAuthStatus, so there is no synchronous result to return.
  await sb.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo } })
  return null
}

export async function webSignOut(sb: SupabaseClient): Promise<void> {
  await sb.auth.signOut()
}
```

- [ ] **Step 5: Run — expect PASS (supabaseClient: 1, auth: 6)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/supabaseClient.test.ts src/renderer/src/lib/webClient/auth.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Wire the auth methods into `webClient.ts`**

1. Add imports:
   ```ts
   import type { SupabaseClient } from '@supabase/supabase-js'
   import { webAuthStatus, webSignIn, webSignOut } from './auth'
   ```
2. Extend `WebClientDeps`:
   ```ts
   supabase?: SupabaseClient
   redirectTo?: string
   ```
3. In `createWebClient`, after the existing `const settings = …`, add:
   ```ts
   const redirect = deps.redirectTo ?? globalThis.location?.origin ?? ''
   const requireSupabase = (): SupabaseClient => {
     if (!deps.supabase) throw new Error('Supabase client not configured')
     return deps.supabase
   }
   ```
4. Replace the three category-D auth stubs (`authStatus: ni('authStatus')`, `authSignIn: ni('authSignIn')`, `authSignOut: ni('authSignOut')`) with:
   ```ts
   authStatus: async () => (deps.supabase ? webAuthStatus(deps.supabase, settings) : { signedIn: false }),
   authSignIn: async () => webSignIn(requireSupabase(), redirect),
   authSignOut: async () => webSignOut(requireSupabase()),
   ```
   (Leave every other method exactly as it is — all other data methods stay `ni(...)`.)

- [ ] **Step 7: Add `webClient.test.ts` cases**

Append to `src/renderer/src/lib/webClient/webClient.test.ts` (reuse its `fakeStorage`; add a tiny supabase fake inline):
```ts
import type { SupabaseClient } from '@supabase/supabase-js'

function fakeSupabase(): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
      signInWithOAuth: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null })
    },
    from: () => ({ select: () => ({ eq: async () => ({ data: [{ workspace_id: 'w1', role: 'owner' }] }) }) })
  } as unknown as SupabaseClient
}

test('authStatus with an injected supabase reports signed-in', async () => {
  const c = createWebClient({ storage: fakeStorage(), supabase: fakeSupabase() })
  expect(await c.authStatus()).toMatchObject({ signedIn: true, workspaceId: 'w1', role: 'owner' })
})

test('authStatus with no supabase reports signed-out (no throw)', async () => {
  expect(await createWebClient({ storage: fakeStorage() }).authStatus()).toEqual({ signedIn: false })
})

test('authSignIn/authSignOut without supabase throw "not configured"', async () => {
  const c = createWebClient({ storage: fakeStorage() })
  await expect(c.authSignIn()).rejects.toThrow(/not configured/)
  await expect(c.authSignOut()).rejects.toThrow(/not configured/)
})
```

- [ ] **Step 8: Run web-client suite + full suite + typecheck**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/`
Expected: PASS (supabaseClient 1 + auth 6 + webClient 10 = 17, plus settings 2 + notImplemented 1 = 20 in the dir).

Run: `npm test` → all pass. Run: `npm run typecheck` → clean (`createWebClient` still returns a conformant `AxiClient`; the auth methods now have real signatures matching `AxiRosterApi`).

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/lib/webClient
git commit -m "feat(web): web auth + session foundation (Supabase OAuth, effective workspace)"
```

---

## Self-Review Notes

- **Spec coverage:** `supabaseClient.ts` browser factory with web auth opts (Step 3); `auth.ts` `webAuthStatus`/`webSignIn`/`webSignOut`/`resolveEffectiveWorkspace` mirroring the desktop flow (Step 4); `webClient.ts` wires the three auth methods + `WebClientDeps.supabase`/`redirectTo` (Step 6); tests cover no-session, single/multi membership + activeGuildId preference, membership-throw degradation, OAuth args, sign-out, and the no-supabase paths (Steps 1, 7). Data methods remain `notImplemented`; no `src/main`/`src/preload`/other-renderer change.
- **Type consistency:** helpers take `SupabaseClient` (real type); fakes cast `as unknown as SupabaseClient` (repo's existing test idiom). `AuthStatus`/`AuthSignInResult` imported from the preload contract. `webAuthStatus` returns `AuthStatus`; `webSignIn` returns `AuthSignInResult | null` — matching `AxiRosterApi.authStatus`/`authSignIn`.
- **Mirrors desktop:** `resolveEffectiveWorkspace` is the desktop `effectiveWorkspace` logic verbatim (query → active-or-first), and `webAuthStatus` matches the `auth:status` handler shape; the only divergence is browser session/redirect vs loopback, which is the intended platform difference.
- **Decisions flagged:** `redirectTo` defaults to `globalThis.location.origin` (auto-adapts prod/dev, both allowlisted); browser `persistSession: true`/`detectSessionInUrl: true`. Revisited only if the real run surfaces an auth-config issue.
