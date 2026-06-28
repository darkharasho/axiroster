# Web Version — Phase 2c-7: Web Workspace + Invites Methods

**Date:** 2026-06-28
**Status:** Approved (sensible-defaults run)

## Goal
Implement the `WebAxiClient` methods the App shell calls on mount —
`listGuilds`, `listWorkspaceRoles`, `listInvites` (the ones currently throwing
`notImplemented` and breaking the shell) — plus the closely-related
`getGuild`, `setActiveGuild`, `respondInvite`. These map the desktop's local
guild-profile model onto the Supabase **workspace** model. They **degrade to
empty/no-op instead of throwing**, so the shell stays robust.

## The model mapping
On web there is no local GuildStore; a "guild" is a **workspace the user is a
member of** (`workspace_members` → `workspaces`). The workspace **is** the GW2
guild (`workspace_id` = gw2 guild id). Secrets (`gw2ApiKey`/`axitoolsKey`) aren't
readable on web, so they map to `''`.

## Methods (note: these return their desktop shapes directly, NOT `Result`)

- **`listGuilds(): GuildSummary[]`** — `getUser` → memberships
  (`workspace_members.select('workspace_id, role').eq('user_id', uid)`) →
  `workspaces.select('*').in('workspace_id', ids)`; map each row + the member's
  role to a `GuildSummary`. `active = workspace_id === (settings 'activeGuildId'
  || first membership id)`. On any failure → `[]`.
- **`listWorkspaceRoles(): Record<string,string>`** — the memberships as
  `{ workspace_id: role }`. Failure → `{}`. (Drives the rail role badges.)
- **`getGuild(id): GuildProfile | null`** — one `workspaces` row → `GuildProfile`
  (keys `''`). Not a member / missing → `null`.
- **`setActiveGuild(id): void`** — `settings.set('activeGuildId', id)` (localStorage).
- **`listInvites(): PendingInvite[]`** — `invoke('list-invites')` →
  `data.invites` (the function returns `{ invites: {id, workspaceId, role,
  guildName}[] }`). Failure → `[]`.
- **`respondInvite(inviteId, action): <AxiRosterApi return>`** —
  `invoke('respond-invite', { body: { inviteId, action } })`; map the function
  body to the contract's return type (read it from `preload/index.d`). On error →
  `{ ok: false, error }`.

### `GuildSummary` from a `workspaces` row (+ member role + active id)
`{ id: workspace_id, name: guild_name || 'Guild', active: workspace_id ===
activeId, gw2GuildName: guild_name, gw2GuildId: workspace_id, gw2AccountName: '',
hasGw2Key: false, discordGuildName: discord_guild_name, discordGuildId:
discord_guild_id, hasAxitoolsKey: Boolean(discord_guild_id), memberRoleId:
member_role_id, bridgeRepos: bridge_repos ?? [], shared: true, axitoolsShared:
Boolean(keys_shared), retentionEnabled: false, pipelineEnabled: true }`

### `GuildProfile` from a `workspaces` row
Same field set as `GuildSummary` minus `active`/`hasGw2Key`/`hasAxitoolsKey`/
`gw2GuildName-as-name`, plus `gw2ApiKey: ''`, `axitoolsKey: ''`. (Implementer maps
the exact `GuildProfile` fields from `preload/index.d`.)

## Architecture
New `src/renderer/src/lib/webClient/workspace.ts`:
- helpers: `getMemberships(sb, uid)`, `wsRowToSummary(row, role, activeId)`,
  `wsRowToProfile(row)`, `activeIdFrom(settings, ids)`.
- `webListGuilds`, `webGetGuild`, `webSetActiveGuild`, `webListWorkspaceRoles`,
  `webListInvites`, `webRespondInvite`. Reuse `invokeAxitools`? No — these call
  `list-invites`/`respond-invite` (not `axitools`), so a small local
  `invoke(sb, fn, body)` mapping suffices; or call `sb.functions.invoke` directly.
- Imports `SupabaseClient`; `GuildSummary`/`GuildProfile`/`PendingInvite` +
  `respondInvite`'s return type from `../../../../preload/index.d`; `WebSettings`.

`webClient.ts` wiring: replace the six `ni(...)` stubs. The Supabase-backed ones
use a guard that returns the **empty value** when `deps.supabase` is absent
(`[]`/`{}`/`null`) so the shell never crashes pre-auth; `setActiveGuild` just
writes settings (no supabase needed).

## Testing
Vitest (node), fakes only:
- `webListGuilds`: a fake with memberships `[{w1,owner}]` + a `workspaces` row →
  one `GuildSummary` with `active:true` (matching the `activeGuildId` setting, or
  first); no user → `[]`.
- `webListWorkspaceRoles`: memberships → `{ w1: 'owner' }`.
- `webSetActiveGuild`: writes `activeGuildId` to the settings storage.
- `webGetGuild`: a `workspaces` row → `GuildProfile` (keys `''`); missing → `null`.
- `webListInvites`: `invoke('list-invites')` returning `{ invites: [...] }` →
  that array; error → `[]`.
- `webRespondInvite`: `invoke('respond-invite', {body:{inviteId, action}})`
  shape.
- `webClient.test.ts`: smoke that `listGuilds()`/`listWorkspaceRoles()`/
  `listInvites()` return `[]`/`{}`/`[]` with no supabase (no throw).
- Full suite + typecheck green; `createWebClient` stays conformant.

## Out of scope
- `discordMembers`, the Supabase-direct CRUD (annotation/link/tag/member edits),
  the other invite methods (`createInvite`/`pendingSentInvites`/`revokeInvite`/
  `redeemInvite`), `upsertGuild`/`removeGuild`, pipeline, audit — later slices.
