# Web Version — Phase 2c-12: Web Members (list/setRole/revoke/discordMembers)

**Date:** 2026-06-28 · **Status:** Approved (sensible-defaults run)

## Goal
Implement the workspace members methods so the members-management panel + the
Discord member list work on web: `listMembers`, `setMemberRole`, `revokeMember`,
`discordMembers`. Replaces those 4 `notImplemented` stubs.

## Methods (mirror the desktop; direct table / axitools; return desktop shapes)
- **`listMembers(): WorkspaceMember[]`** — `from('workspace_members').select(
  'user_id, discord_id, discord_username, discord_global_name, role').eq(
  'workspace_id', ws)` → map `{ userId, discordId, discordName(=discord_username),
  discordGlobalName(=discord_global_name), role }`. Never-throws → `[]`.
- **`setMemberRole(userId, role): void`** — only `'write'`/`'read'` allowed (else
  no-op); `from('workspace_members').update({ role }).eq('workspace_id', ws).eq(
  'user_id', userId)` (owner-gated by RLS).
- **`revokeMember(userId): void`** — `from('workspace_members').delete().eq(
  'workspace_id', ws).eq('user_id', userId)`.
- **`discordMembers(): DiscordRosterMember[]`** — resolve the active workspace's
  `discord_guild_id` (from `workspaces`); none → `[]`. `invokeAxitools({
  op:'discordOverview', workspaceId, guildId, includeMembers:true })` → unwrap →
  shared `asDiscordMembers` → `.filter(m => !m.bot)` → map `{ id, name: m.name ??
  m.id, displayName: m.display_name ?? m.name ?? m.id }`. Never-throws → `[]`.

All resolve the active workspace via `activeWorkspaceId`; no workspace / no
supabase → empty/no-op.

## Architecture
New `src/renderer/src/lib/webClient/members.ts`: `webListMembers`,
`webSetMemberRole`, `webRevokeMember`, `webDiscordMembers`. Imports
`WorkspaceMember`/`DiscordRosterMember` from `../../../../preload/index.d`;
`activeWorkspaceId`/`invokeAxitools` from `./discordGw2`; `asDiscordMembers` from
`../../../../shared/roster/adapters`. `webClient.ts` wires the 4 (no-supabase →
`[]`/no-op).

## Testing
Vitest (node), fakes only (chainable builder for workspace_members/workspaces
with `.select/.eq/.update/.delete`; `functions.invoke` for discordOverview;
`activeWorkspaceId` via auth.getUser + workspace_members).
- `webListMembers`: a member row → mapped `WorkspaceMember`; no workspace → `[]`.
- `webSetMemberRole`: `'write'` → `.update({role:'write'})` with eq filters;
  an invalid role (e.g. `'owner'`) → no `.update` call (no-op).
- `webRevokeMember`: `.delete()` with eq filters.
- `webDiscordMembers`: a `workspaces` row with `discord_guild_id` + an overview
  with a member + a bot → returns only the non-bot mapped `DiscordRosterMember`;
  no discord guild → `[]`.
- `webClient.test.ts`: no-supabase `listMembers()` → `[]`, `discordMembers()` → `[]`.
- Full suite + typecheck green; `createWebClient` stays conformant.

## Out of scope
- Pipeline, the add-guild/settings writes, the Cloudflare deploy.
