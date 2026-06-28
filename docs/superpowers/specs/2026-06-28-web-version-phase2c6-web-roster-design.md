# Web Version — Phase 2c-6: Web Roster (buildRoster + refreshRoster)

**Date:** 2026-06-28
**Status:** Approved (sensible-defaults run)

## Goal
Implement the web client's **roster** — `buildRoster()` and `refreshRoster()` —
so the roster panel populates. `buildRoster` pre-fetches the workspace + synced
members + annotations + links from Supabase, then feeds them into the **shared
`assembleRoster`** (relocated in 2c-2), with Discord pulled via the Phase-1
`axitools` Edge Function and GW2 sourced from the synced `roster_members` table
(no client-side live pull). Mock-tested; real validation in the browser.

## How `assembleRoster` is fed (it applies the adapters + reconcile internally)
`RosterAssemblyDeps` (from `src/shared/roster/assembleRoster`) mixes async source
fetchers and **synchronous** local accessors. The web client pre-fetches the
Supabase data, then provides:

| dep | web source |
|---|---|
| `activeGuild()` | a `GuildMeta` built from the active `workspaces` row |
| `membersLinked(gid)` | `invokeAxitools({op:'membersLinked', workspaceId, guildId})` → raw (throws on failure so the assembler's Discord try/catch fires) |
| `discordOverview(gid)` | `invokeAxitools({op:'discordOverview', workspaceId, guildId, includeMembers:true})` → raw |
| `inGameMembers()` / `guildRanks()` | `[]` — web uses the synced source, never a live client pull |
| `syncedMembers()` | pre-fetched `roster_members.payload` → `InGameMemberRaw[]` |
| `manualLinks()` | pre-fetched `roster_links` → `{accountName, memberId}[]` |
| `annotations()` | pre-fetched `roster_annotations` (non-reserved) → `AnnotationRaw[]` |
| `bridgeMetrics(repos)` / `attendance(repos)` | `new AxibridgeClient(repos)` browser-direct (GitHub raw is CORS-ok); best-effort |

### GuildMeta from a `workspaces` row
`workspaces(workspace_id, guild_name, discord_guild_id, discord_guild_name,
has_leader_key, keys_shared, member_role_id, bridge_repos)`. The workspace **is**
the GW2 guild (`workspace_id` = gw2 guild id). Mapping:
- `gw2GuildId = workspace_id`, `gw2GuildName = guild_name`
- `discordGuildId = discord_guild_id`, `discordGuildName = discord_guild_name`
- `memberRoleId = member_role_id`, `bridgeRepos = bridge_repos` (jsonb array)
- `hasAxitoolsKey = Boolean(discord_guild_id)` — attempt the Discord source when a
  server is configured; the function returns `no_key` (→ a Discord-unavailable
  warning) if the workspace has no AxiTools key. [DECISION] proxy, since the web
  client can't read `workspace_secrets` (service-role only).
- `hasGw2Key = false` — **forces the synced roster source**; the browser never
  does a live leader-only GW2 pull. [FLAG] the assembler's `gw2Source` banner will
  read "No GW2 API key" on web even though the roster comes from sync; the source
  banners are desktop-oriented and can be refined later. The roster itself is
  correct (from `roster_members`, which the server keeps fresh via `refresh-roster`).
- `retentionEnabled = false` — attendance fetch off on web for now (best-effort).

## Table/column shapes (from the desktop's `supabaseSync`)
- `roster_members(workspace_id, member_id, payload jsonb)` — `payload` is the GW2
  member `{name, rank, joined}`.
- `roster_links(workspace_id, account_name, member_id)`.
- `roster_annotations(workspace_id, member_id, nickname, aliases jsonb, notes,
  tags jsonb, main_account, …)`.

## refreshRoster
`refreshRoster()` → `invoke('refresh-roster', { body: { guildId: workspaceId } })`
→ `{ count }` (the server re-pulls GW2 with the shared key and upserts
`roster_members`). Returns `RosterRefreshResult { count }`; throws on a
no-active-workspace / invoke error (mirrors the desktop). The renderer then
rebuilds the roster.

## Architecture
New `src/renderer/src/lib/webClient/roster.ts`:
- `webBuildRoster(sb, settings): Promise<Result<RosterPayload>>` — resolve active
  workspace, `Promise.all` the four Supabase reads, build `GuildMeta` + the
  `RosterAssemblyDeps`, `return ok(await assembleRoster(deps))`; any throw →
  `fail(message)`.
- `webRefreshRoster(sb, settings): Promise<RosterRefreshResult>`.
- helpers: `unwrap(result)` (Result→data or throw), `wsRowToGuildMeta`, row
  mappers for members/links/annotations.
- Reuses `invokeAxitools`/`activeWorkspaceId` from `./discordGw2`,
  `assembleRoster`/`RosterAssemblyDeps`/`GuildMeta`/`RosterPayload` +
  `isReservedAnnotationKey` + `AxibridgeClient` from `../../../../shared/…`.

`webClient.ts` wiring: `buildRoster` → `withSb(sb => webBuildRoster(sb, settings))`;
`refreshRoster` → `withSb`-style but returning `RosterRefreshResult` (a no-supabase
case throws "Supabase client not configured" — `refreshRoster` isn't a `Result`).

## Testing
Vitest (node), fakes only:
- `webBuildRoster`: a fake supabase returning canned `workspaces`/`roster_members`/
  `roster_links`/`roster_annotations` + a stubbed `functions.invoke` for
  `membersLinked`/`discordOverview` → assert `ok`, `payload.members` reflects the
  synced members reconciled with annotations/links, `sources.gw2.count` = synced
  count, no throw. With `bridge_repos: []` the `AxibridgeClient` is never called
  (no network).
- A Discord-invoke failure → the payload still returns with a "Discord
  unavailable" warning (assembler resilience).
- `webRefreshRoster`: invokes `refresh-roster` with `{guildId: workspaceId}` →
  returns `{ count }`; no active workspace → throws.
- Full suite + typecheck green; `createWebClient` stays a conformant `AxiClient`.

## Out of scope
- `discordMembers`, the Supabase-direct CRUD (annotations/links/tags/members/
  pipeline edits), invites/claim, audit/retention — later slices.
- Refining the web source banners.
