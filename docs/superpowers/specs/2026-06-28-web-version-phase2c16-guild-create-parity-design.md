# Web Version — Phase 2c-16: Web Guild Create/Configure Parity

**Date:** 2026-06-28 · **Status:** Approved

## Goal
Give the web app **full parity** for creating and configuring a guild — the same
"Add a guild" form the desktop uses, working in the browser. Replace the three
honest-but-limited 2c-15 guild stubs (`upsertGuild`→null, `claimGuild`→error,
`removeGuild`→no-op) with real implementations that drive the **same Edge
Functions** the desktop uses. No rebuilt UI.

## Why this is possible (the 2c-15 "desktop-only" framing was over-conservative)
The GW2 leader key and AxiTools key are **never required to live on the desktop**:
the desktop merely collects them from the user and POSTs them to Edge Functions
that **encrypt + store them server-side**. Supabase is the source of truth; the
local `guildStore` is a cache. A browser can call the identical functions over
HTTPS, so both clients can create/configure a guild.

- `claim-guild` (`functions/claim-guild`): input `{apiKey, guildId, guildName?,
  discordGuildId?, discordGuildName?}`; verifies GW2 leadership, then
  `upsertWorkspace` (`has_leader_key:true`) + `insertSecret`
  (`leader_key_enc = encrypt(apiKey)`) + `insertMember(role:'owner')`. Returns
  `{workspaceId, role:'owner'}` or `{error}` (403 `not_leader`, 409
  `already_claimed`).
- `share-keys` (`functions/share-keys`, owner-only): input `{guildId, share:true,
  apiKey, axitoolsKey?, gw2GuildName?, discordGuildId?, discordGuildName?,
  memberRoleId?, bridgeRepos?}`; upserts `workspace_secrets`
  (`leader_key_enc`, `axitools_key_enc`) + updates `workspaces`
  (`guild_name`/`discord_guild_id`/`discord_guild_name`/`member_role_id`/
  `bridge_repos`) + sets `keys_shared`.
- The existing `GuildEditor` form already runs on web — every call it makes
  (`gw2AccountInfo`, `axitoolsListGuilds`, `discordOverview`, `boundGw2Guilds`)
  works today. Only its **save** (`upsertGuild`) and the Sharing-tab `claimGuild`
  are dead. This slice revives them.

## The model: workspace_id = GW2 guild id
`input.gw2GuildId` IS the workspace id. A guild without a GW2 guild id cannot be
created on the server (no workspace_id) — web `upsertGuild` returns `null` for a
keyless input. [FLAG] desktop's Discord-only local profiles have no web analogue.

## Method behaviors (`webClient/guilds.ts`)

### `upsertGuild(input: GuildProfileInput): GuildSummary | null`
`ws = input.gw2GuildId`. If empty → `null`.

- **Create** (`!input.id`):
  1. `invoke('claim-guild', { body: { apiKey: input.gw2ApiKey, guildId: ws,
     guildName: input.name, discordGuildId: input.discordGuildId,
     discordGuildName: input.discordGuildName } })`.
     - Success `{workspaceId, role}` → continue.
     - `{error:'already_claimed'}` → query `workspace_members` for `(ws, me)`;
       if I'm `owner` → continue (re-configure); else → `null` (claimed by
       someone else — surfaced via the save-error UI touch below).
     - `{error:'not_leader'}` or any other error → `null`.
  2. `invoke('share-keys', { body: { guildId: ws, share: true,
     apiKey: input.gw2ApiKey, axitoolsKey: input.axitoolsKey || undefined,
     gw2GuildName: input.gw2GuildName, discordGuildId: input.discordGuildId,
     discordGuildName: input.discordGuildName, memberRoleId: input.memberRoleId,
     bridgeRepos: input.bridgeRepos } })` (best-effort; create still succeeds if
     config push fails — the workspace exists).
  3. `settings` set active workspace = `ws` (the `activeWorkspaceId` key 2c-1/2c-3
     read from). 
  4. Return `summaryFor(input, ws, active:true)`.
- **Edit** (`input.id` present — workspace already exists):
  - Resolve my role (`resolveEffectiveWorkspace`/membership).
  - `owner` → `share-keys` (same body as create step 2).
  - `write` → `workspaces` RLS update `{ member_role_id: input.memberRoleId,
    bridge_repos: input.bridgeRepos }` `.eq('workspace_id', ws)` (mirrors desktop
    `pushSharedConfig` write-branch).
  - `read`/none → no-op.
  - Return `summaryFor(input, ws, active = (ws === current active))`.
- Never throws → returns `null` on any caught error.
- **`retentionEnabled`/`pipelineEnabled` are ignored** — desktop-local-only flags
  with no server storage; web already hardcodes them (`false`/`true`) in
  `webGetGuild`. [FLAG] persisting them server-side is a separate enhancement.

### `claimGuild(): ClaimGuildResult`
Web already claims inside `upsertGuild`, so the Sharing-tab button is a confirm:
resolve the active workspace + my role; `owner` → `{ok:true, workspaceId}`; member
but not owner → `{ok:false, error:'Only the owner can claim this guild.'}`; no
active workspace → `{ok:false, error:'Add a guild first.'}`. Never throws.

### `removeGuild(id): void`
- Resolve my role for `id`.
- **Non-owner** → leave: `workspace_members.delete().eq('workspace_id', id)
  .eq('user_id', me)`. If `id` was active, clear the active-workspace setting.
- **Owner** → **deferred** no-op. [FLAG] deleting a guild you own wipes the
  workspace for every member (not a local hide like desktop); a deliberate
  destructive-confirm flow is out of scope for this slice. Owners manage deletion
  from the desktop for now.
- Never throws.

## Shared-UI touch (one small change to `GuildEditor.save()`)
Leadership is only verified at `claim-guild` time, so a non-leader can fill the
form and save. Today `save()` (`GuildSettings.tsx:243`) toasts "Guild added"
unconditionally. Change: `save()` checks the `upsertGuild` result — `null` →
toast an error ("Couldn't add guild — check you're a GW2 guild leader and the keys
are valid.") and do **not** call `onDone()`; non-null → existing success path.
Harmless to desktop (desktop `upsertGuild` returns a summary on the local save,
so it keeps toasting success; its claim is a separate step). The embedded-autosave
path (line 269) is unchanged (edits return a summary).

## Architecture
- New `src/renderer/src/lib/webClient/guilds.ts`: `webUpsertGuild`,
  `webClaimGuild`, `webRemoveGuild` + a `summaryFor(input, ws, active)` helper
  building `GuildSummary` from a `GuildProfileInput`. Imports
  `GuildSummary`/`GuildProfileInput`/`ClaimGuildResult` from
  `../../../../preload/index.d`; reuses `activeWorkspaceId` +
  `resolveEffectiveWorkspace` (2c-1/2c-3) for role/active resolution; uses
  `settings` for the active-workspace write.
- `webClient.ts`: re-point `upsertGuild`/`claimGuild`/`removeGuild` from the
  2c-15 `admin.ts` honest-defaults to `guilds.ts` (guarded by `deps.supabase` —
  no supabase → keep the safe defaults: `upsertGuild`→null, `claimGuild`→
  `{ok:false,error:'Not signed in'}`, `removeGuild`→no-op). The 2c-15
  `webUpsertGuild`/`webClaimGuild`/`webRemoveGuild` exports in `admin.ts` are
  removed (admin.ts keeps the invite/adopt/retention methods).
- `GuildSettings.tsx`: the `save()` result-check above.

## Testing
Vitest (node), fakes only. Chainable Supabase builder + `functions.invoke` spy +
`workspace_members` select for role resolution.
- `webUpsertGuild` create: invokes `claim-guild` then `share-keys` with the
  mapped bodies; sets active workspace; returns a `GuildSummary{id:ws,active:true}`.
- create, `already_claimed` + I'm owner → skips claim error, still calls
  `share-keys`, returns summary; `already_claimed` + not owner → `null`;
  `not_leader` → `null`; empty `gw2GuildId` → `null` (no invoke).
- edit (`input.id` set) owner → `share-keys` only (no `claim-guild`); write →
  `workspaces.update({member_role_id,bridge_repos})` only.
- `webClaimGuild`: owner active ws → `{ok:true,workspaceId}`; non-owner →
  `{ok:false,error}`; none → `{ok:false,error}`.
- `webRemoveGuild`: non-owner → deletes own membership row (+ clears active if it
  matched); owner → no delete (no-op).
- `webClient.test.ts`: no-supabase `upsertGuild`→null, `claimGuild.ok===false`,
  `removeGuild` resolves undefined (unchanged safe defaults).
- `GuildSettings` save-error: a small RTL/unit test asserting `save()` does not
  call `onDone` and toasts an error when `upsertGuild` resolves `null` (if the
  component is awkward to mount, a focused test on the extracted handler is
  acceptable — keep the logic test-reachable).
- Full suite (`--pool=forks --poolOptions.forks.maxForks=2`) + `npm run typecheck`
  + `npm run build:web` green.

## Out of scope
- Server persistence for `retentionEnabled`/`pipelineEnabled`.
- Owner-side destructive guild deletion (the confirm flow).
- Keyless / Discord-only guild creation on web.
- Any change to the Edge Functions, migrations, or desktop main-process code.
