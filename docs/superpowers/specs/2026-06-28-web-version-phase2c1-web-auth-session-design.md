# Web Version — Phase 2c-1: Web Auth + Session Foundation

**Date:** 2026-06-28
**Status:** Approved (sensible-defaults run)

## Background & Goal

The `WebAxiClient` skeleton (2b-3a) has every data/auth method as a
`notImplemented` stub. **2c-1** implements the **auth foundation** those data
methods will build on: an injected Supabase browser client + the three auth
methods (`authStatus`/`authSignIn`/`authSignOut`) + effective-workspace
resolution, mirroring the desktop's auth flow but using a browser OAuth redirect
instead of the localhost loopback. Mock-tested (injected fake Supabase client);
real validation needs a browser + the live Supabase project.

**Locked decisions (from discussion):** deploy = Cloudflare Pages at
`https://roster.axi.link`; OAuth = standard Supabase Discord; redirect =
`globalThis.location.origin` (auto-adapts to `roster.axi.link` in prod and
`localhost:5293` in dev — both already allowlisted in Supabase Auth by the user).

## How the desktop does it (mirror this)

- `auth:status` → `restoreSession()`; no session → `{ signedIn: false }`; else
  `effectiveWorkspace()` → `{ signedIn: true, role, workspaceId, userId }`.
- `effectiveWorkspace()` → `auth.getUser()`; query
  `workspace_members.select('workspace_id, role').eq('user_id', user.id)`; choose
  the membership matching the active-guild setting (`activeGuildId`) else the
  first; return `{ workspaceId, role }` or null.
- `AuthStatus { signedIn: boolean; role?: string; workspaceId?: string; userId?: string }`
- `AuthSignInResult { accountName: string; role: string | null; workspaceId: string | null }`

## Scope

**In scope** (new files under `src/renderer/src/lib/webClient/`, plus wiring the
three auth methods in the existing `webClient.ts`):
- `supabaseClient.ts` — `createBrowserSupabase(url, anonKey): SupabaseClient`
  with web auth options (`persistSession: true`, `autoRefreshToken: true`,
  `detectSessionInUrl: true`).
- `auth.ts` — `webAuthStatus`, `webSignIn`, `webSignOut`,
  `resolveEffectiveWorkspace`, taking an injected `SupabaseClient` + the settings
  adapter + a `redirectTo`.
- `webClient.ts` — extend `WebClientDeps` with `supabase?: SupabaseClient` and
  `redirectTo?: string`; wire `authStatus`/`authSignIn`/`authSignOut` to the
  helpers. All other methods stay as they are (still `notImplemented` for data).

**Out of scope / deferred:**
- The data methods (guilds, annotations, roster, members, invites, pipeline,
  audit, etc.) — later 2c slices, now that they have a session + workspace to
  build on.
- The Vite web build, the web entry that installs the client via `setClient`, and
  the Cloudflare Pages deploy (a later 2c slice, using the `cloudflare` skill).
- Any `src/main`/`src/preload`/existing-renderer change.

## Architecture

### `supabaseClient.ts`
```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
export function createBrowserSupabase(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  })
}
```
Unlike the desktop (`persistSession: false`, manual token handling), the browser
client persists the session in `localStorage` and auto-detects the OAuth callback
in the URL — the standard Supabase SPA setup.

### `auth.ts`
Helpers take an injected `SupabaseClient` (tests pass a fake cast
`as unknown as SupabaseClient`, matching the repo's existing test style):

```ts
resolveEffectiveWorkspace(sb, settings, userId): Promise<{ workspaceId; role } | null>
//   sb.from('workspace_members').select('workspace_id, role').eq('user_id', userId)
//   -> choose membership where workspace_id === settings.get('activeGuildId'), else [0]

webAuthStatus(sb, settings): Promise<AuthStatus>
//   sb.auth.getSession() -> no session -> { signedIn: false }
//   else { id } = (await sb.auth.getUser()).data.user
//        ws = resolveEffectiveWorkspace(sb, settings, id)
//        -> { signedIn: true, role: ws?.role, workspaceId: ws?.workspaceId, userId: id }

webSignIn(sb, redirectTo): Promise<AuthSignInResult | null>
//   sb.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo } })
//   -> returns null (the browser redirects away; status is resolved on the
//      post-redirect load via webAuthStatus)

webSignOut(sb): Promise<void>  //   sb.auth.signOut()
```

### `webClient.ts` wiring
- `WebClientDeps` gains `supabase?: SupabaseClient` and `redirectTo?: string`.
- `redirect = deps.redirectTo ?? globalThis.location?.origin ?? ''`.
- `authStatus` → if `deps.supabase` present, `webAuthStatus(deps.supabase, settings)`; else `{ signedIn: false }` (graceful — an unconfigured client is just "signed out", not a crash).
- `authSignIn` → `webSignIn(requireSupabase(), redirect)`.
- `authSignOut` → `webSignOut(requireSupabase())`.
- `requireSupabase()` throws a clear `"Supabase client not configured"` if
  `deps.supabase` is absent (sign-in/out genuinely cannot proceed without it).

## Error Handling

`webAuthStatus` swallows query failures to `{ signedIn: false }` (mirrors the
desktop's `.catch(() => null)` on `effectiveWorkspace`) — a transient membership
read shouldn't crash the app into an error state; it degrades to signed-out.
`signInWithOAuth`/`signOut` errors propagate (the renderer's sign-in flow shows
them). `authStatus` never throws.

## Testing

Vitest (node env), `--pool=forks --poolOptions.forks.maxForks=2`. Fakes injected;
no real network.

- **`auth.test.ts`:**
  - `webAuthStatus`: no session → `{ signedIn: false }`; session + one membership
    → `{ signedIn: true, role, workspaceId, userId }`; with multiple memberships
    and a matching `activeGuildId` setting → picks that workspace; with no match →
    picks the first; a `from().select().eq()` throw → `{ signedIn: false }`.
  - `webSignIn`: calls `signInWithOAuth` with `provider: 'discord'` and the given
    `redirectTo`; resolves `null`.
  - `webSignOut`: calls `sb.auth.signOut()`.
- **`webClient.test.ts` additions:** `authStatus()` with an injected fake supabase
  returns `signedIn: true`; `authStatus()` with no supabase → `{ signedIn: false }`;
  `authSignIn()`/`authSignOut()` with no supabase throw "Supabase client not
  configured".
- **`supabaseClient.test.ts`:** `createBrowserSupabase('https://x.supabase.co', 'anon')`
  returns an object exposing `auth.getSession`/`from` (constructs without
  networking).
- Full suite + `npm run typecheck` green; `createWebClient` still returns a
  conformant `AxiClient`.

## Out of Scope (2c-1)

- Data-method implementations; the web build/entry/deploy; any non-webClient file.
