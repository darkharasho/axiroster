# Web Version — Phase 2c-3: Web Discord/GW2 Data Methods

**Date:** 2026-06-28
**Status:** Approved (sensible-defaults run)

## Background & Goal

With the shared core relocated (2c-2), the web client can now implement its first
real data methods. **2c-3** fills the **Discord/GW2 cluster** of the
`WebAxiClient` — six methods that go through the Phase-1 `axitools` Edge Function
or browser-direct GW2 — replacing their `notImplemented` stubs. Mock-tested
(fake Supabase client / stubbed fetch); real validation needs a browser + the
live Supabase project + a real AxiTools key.

## The six methods

| method | how | returns |
|---|---|---|
| `gw2AccountInfo(apiKey?)` | browser-direct: `new Gw2Client(apiKey).accountInfo()` (shared `src/shared/gw2Client`) | `Result<Gw2AccountInfo>` |
| `axitoolsListGuilds(key?)` | `functions.invoke('axitools', { op:'listGuilds', … })` | `Result<DiscordGuild[]>` |
| `axitoolsGuildRoles(guildId, key?)` | invoke `{ op:'guildRoles', guildId, … }` | `Result<unknown>` |
| `discordOverview(guildId, includeMembers, key?)` | invoke `{ op:'discordOverview', guildId, includeMembers, … }` | `Result<unknown>` |
| `boundGw2Guilds(discordGuildId, key?)` | invoke `{ op:'guildRoles', guildId:discordGuildId, … }` then `parseBoundGw2Guilds(data)` (shared adapter) | `Result<string[]>` |
| `discordAction(guildId, action, params)` | invoke `{ op:'discordAction', workspaceId, guildId, action, params }` (stored only — write) | `Result<unknown>` |

### Key mode (validation vs stored)

Mirrors the desktop's optional-`key?` and the Phase-1 function's two modes:
- **`key` provided** → validation mode: body carries `key` (no `workspaceId`).
- **`key` absent** → stored mode: body carries `workspaceId` = the active
  workspace (resolved via `resolveEffectiveWorkspace`, reusing the 2c-1 helper).
- `discordAction` has no `key` param → always stored (needs `workspaceId`).

## Architecture

New module `src/renderer/src/lib/webClient/discordGw2.ts`:

- `ok`/`fail` Result builders (`Result` from the preload contract).
- `invokeAxitools(sb, body): Promise<Result<unknown>>` — calls
  `sb.functions.invoke('axitools', { body })`; on `error` returns
  `fail(<message>)`; else returns `ok((data as { data?: unknown }).data)` (the
  function wraps success as `{ data }`).
  - **Error message extraction (best-effort, flagged):** supabase-js surfaces a
    non-2xx as a `FunctionsHttpError` whose body is in `error.context` (a
    `Response`). Try `await error.context.json()` → use its `error`/`message`;
    fall back to `error.message`. This preserves the function's specific codes
    (`no_key`, `not_authorized`, …) when available. [FLAG] the exact
    `FunctionsHttpError` shape is verified only on a real run; the fallback keeps
    it from throwing.
- `activeWorkspaceId(sb, settings): Promise<string | null>` —
  `sb.auth.getUser()` → `resolveEffectiveWorkspace(sb, settings, userId)` →
  `workspaceId` (or null).
- One exported function per method (`webGw2AccountInfo`, `webAxitoolsListGuilds`,
  `webAxitoolsGuildRoles`, `webDiscordOverview`, `webBoundGw2Guilds`,
  `webDiscordAction`), each taking the injected `sb`/`settings`/`fetch?` + the
  method args, building the validation-or-stored body, and mapping the result.
- `webGw2AccountInfo(apiKey)`: if no `apiKey` → `fail('No GW2 API key')`; else
  `try { return ok(await new Gw2Client(apiKey).accountInfo()) } catch (e) { return fail((e as Error).message) }`. (`Gw2Client` uses global `fetch` via the shared `resilientFetch`; tests stub global `fetch`.)
- `webBoundGw2Guilds`: invoke `guildRoles`; on `ok`, return
  `ok(parseBoundGw2Guilds(result.data))`; on `fail`, propagate.

`webClient.ts` wiring: replace the six `ni(...)` stubs with calls to these
helpers (passing `deps.supabase` + `settings`). A stored-mode method with no
`deps.supabase` → `fail('Supabase client not configured')` (don't throw — these
return `Result`, so a failed Result is the right shape). `gw2AccountInfo` needs
no supabase.

The renderer imports the shared modules via
`../../../../shared/gw2Client` and `../../../../shared/roster/adapters`
(webClient/ is four levels below `src/`).

## Error Handling

All six return `Result` (never throw): network/edge failures →
`{ ok: false, error }`. `invokeAxitools` swallows the supabase error into a
`fail`. `gw2AccountInfo` catches `Gw2Client` errors into a `fail`. Stored-mode
with no active workspace → `fail('No active workspace')`.

## Testing

Vitest (node), `--pool=forks --poolOptions.forks.maxForks=2`. Fakes only.

- **`discordGw2.test.ts`:**
  - `invokeAxitools`: success `{ data: { data: X }, error: null }` → `ok(X)`;
    error with `context.json()` → `fail('<code>')`; error without context →
    `fail(error.message)`.
  - `webAxitoolsListGuilds(key)` (validation) → body `{ op:'listGuilds', key }`,
    no `workspaceId`; `(no key)` (stored) → resolves active workspace into
    `{ op:'listGuilds', workspaceId }`.
  - `webBoundGw2Guilds`: invoke returns a guild-roles map → `ok([<gw2 ids>])` via
    `parseBoundGw2Guilds`.
  - `webDiscordAction`: builds `{ op:'discordAction', workspaceId, guildId, action, params }`; no active workspace → `fail`.
  - `webGw2AccountInfo`: stub global `fetch` to return tokeninfo/account →
    `ok({ accountName, permissions, … })`; no apiKey → `fail`; a fetch reject →
    `fail`.
  - `activeWorkspaceId`: getUser + membership → the chosen id; no user → null.
- **`webClient.test.ts` additions:** each of the six wired methods returns a
  `Result` (smoke) with an injected fake supabase; a stored method with no
  supabase → `{ ok: false }`.
- Full suite + `npm run typecheck` green; `createWebClient` stays a conformant
  `AxiClient`.

## Out of Scope (2c-3)

- `discordMembers` (needs the workspace's discord guild id + `asDiscordMembers`
  shaping — next slice), roster build, Supabase-direct CRUD, invites/claim.
- The Vite web build/entry/deploy.
- Any `src/main`/`src/shared`/`src/preload` change (this slice only adds a
  renderer module + wires `webClient.ts`).
