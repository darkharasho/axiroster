# Web Version — Phase 2c-15: Web Admin Writes (invites/adopt/retention + divergent guild stubs)

**Date:** 2026-06-28 · **Status:** Approved (sensible-defaults run)

## Goal
Implement the last 9 `notImplemented` methods, taking the web `AxiClient` to ZERO
stubs: the invite write-flows + adoptSharedKeys + logRetention (clean), and honest
"desktop-only" defaults for the three web-divergent guild methods.

## Clean methods (direct table / Edge Function)
- **`createInvite({discordId?, code?, role?}): InviteResult`** — role must be
  `'write'`/`'read'` (else `{error:'invalid_role'}`); insert `workspace_invites`
  `{ workspace_id, created_by: user.id, role, (discord_id | code:generated) }`,
  `.select('code').single()` → `{ code }`. No workspace → `{}`.
- **`redeemInvite(code): {ok; error?; role?; workspaceId?}`** —
  `invoke('redeem-invite', { body: { code: code.trim() } })`; map result (error →
  `{ok:false,error}`; else `{ok:true, workspaceId, role}`). Empty code →
  `{ok:false, error:'Enter an invite code'}`.
- **`pendingSentInvites(): SentInvite[]`** —
  `workspace_invites.select('id, discord_id, code, role, created_at').eq(
  workspace_id).is('redeemed_by', null).order('created_at')` → map
  `{ id, discordId, code, role }`. Never-throws → `[]`.
- **`revokeInvite(inviteId): {ok}`** — `delete().eq('id', inviteId).eq(
  'workspace_id', ws)` → `{ ok: !error }`.
- **`adoptSharedKeys(): {adopted}`** — `{ adopted: false }` no-op. On web the
  member already uses the workspace's shared keys server-side (via the Edge
  Functions); there is no local guild profile to "adopt." [FLAG]
- **`logRetention(snapshots): void`** — upsert `retention_snapshots`
  `{ workspace_id, date, member_key, score, tier }` (onConflict
  `'workspace_id,date,member_key'`). No workspace → no-op. Never-throws.

## Web-divergent guild methods (honest defaults — these need a local GW2 leader key the browser doesn't have)
- **`claimGuild(): ClaimGuildResult`** → `{ ok: false, error: 'Claiming a guild
  needs the desktop app (it uses your GW2 leader API key).' }`. [FLAG] claiming
  inherently requires a key the web client can't hold.
- **`upsertGuild(input): GuildSummary | null`** → `null` (no-op). Adding/editing a
  guild profile is a desktop/owner-with-keys flow; on web you join a workspace via
  invite/claim. [FLAG]
- **`removeGuild(id): void`** → no-op. [FLAG]

## Architecture
New `src/renderer/src/lib/webClient/admin.ts`: `webCreateInvite`, `webRedeemInvite`,
`webPendingSentInvites`, `webRevokeInvite`, `webAdoptSharedKeys`, `webClaimGuild`,
`webUpsertGuild`, `webRemoveGuild`, `webLogRetention` + a `generateInviteCode()`
helper. Imports `InviteResult`/`SentInvite`/`ClaimGuildResult` from
`../../../../preload/index.d`; reuse `activeWorkspaceId` from `./discordGw2`.
`webClient.ts` wires all 9 (no-supabase → the empty/`{adopted:false}`/null/no-op).
**After this, no `ni(...)` stubs remain in `webClient.ts`** — `createWebClient`
fully implements `AxiClient` (the `notImplemented` import may be removed if unused).

## Testing
Vitest (node), fakes only.
- `createInvite`: `'write'` → inserts a row + returns `{code}`; invalid role →
  `{error:'invalid_role'}`; with `discordId` → row has `discord_id` (no generated
  code).
- `redeemInvite`: invoke('redeem-invite', {body:{code}}) success → `{ok:true,...}`;
  error → `{ok:false,error}`; empty → `{ok:false}` without invoking.
- `pendingSentInvites`: rows → `SentInvite[]`; never-throws.
- `revokeInvite`: delete called → `{ok:true}`.
- `adoptSharedKeys` → `{adopted:false}`; `claimGuild` → `{ok:false, error}`;
  `upsertGuild` → null; `removeGuild` → undefined.
- `logRetention`: upsert called with mapped rows; no workspace → no-op.
- `webClient.test`: assert NO method throws "not implemented" (the conformance
  test must be removed/updated since every method is now real); a smoke that
  `createInvite`/`pendingSentInvites` return empties without supabase.
- Full suite + typecheck green; `createWebClient` conformant.

## Out of scope
- The web add-guild/claim UX redesign (the divergent stubs are honest placeholders).
