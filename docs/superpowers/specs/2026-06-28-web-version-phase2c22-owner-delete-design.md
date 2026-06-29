# Web Version — Phase 2c-22: Owner-Side Guild Deletion

**Date:** 2026-06-28 · **Status:** Approved (A1 + reuse removeGuild + type-to-confirm)

## Goal
Let a guild **owner** permanently delete a guild from the web — the last deferred
feature. Destructive and irreversible: it wipes the workspace and ALL its data for
every member. Guarded by an owner-only Edge Function and a type-the-name confirm.

## Why deletion is a single DELETE
Every child table references `workspaces(workspace_id) ON DELETE CASCADE`
(verified): `workspace_secrets`, `workspace_members`, `workspace_invites`,
`roster_members`, `roster_annotations`, `roster_links` (0001), `audit_events`,
`audit_cursors`, `retention_snapshots` (0009). So `DELETE FROM workspaces WHERE
workspace_id = X` cascade-wipes everything, and Postgres runs the cascade
privileged (child RLS is bypassed). No migration needed.

## Backend — Edge Function `delete-guild` (A1)
New `supabase/functions/delete-guild/index.ts`, mirroring `share-keys`'s shape:
- `preflight(req)` CORS; build a `userClient` (anon + the request `Authorization`
  header) → `getUser()`; no user → `401 {error:'unauthorized'}`.
- Body `{ guildId }`; missing → `400 {error:'guildId required'}`.
- Service-role `db` client; verify the caller owns it:
  `db.from('workspace_members').select('role').eq('workspace_id', guildId)
  .eq('user_id', user.id).maybeSingle()`; `role !== 'owner'` → `403
  {error:'not_owner'}`.
- `db.from('workspaces').delete().eq('workspace_id', guildId)` (service-role →
  cascade wipes all children); error → `500 {error}`; else `200 {ok:true}`.
No new RLS, no migration. Deployed (user-authorized) via `supabase functions
deploy delete-guild --use-api`.

## Client — reuse `removeGuild` (no contract change)
`webRemoveGuild(sb, settings, id)`'s **owner** branch (a no-op since 2c-17) now
invokes `delete-guild`:
- Resolve role (`roleFor`). `null` (non-member) → no-op. `'owner'` →
  `sb.functions.invoke('delete-guild', { body: { guildId: id } })`; on a clean
  `{ ok: true }` result, clear `activeGuildId` if it matched `id`. Otherwise
  (non-owner `write`/`read`) → leave (delete own membership, unchanged 2c-17).
- Still never throws (existing outer `try/catch`). Still returns `void`.
- Realtime (2c-21) propagates the `workspaces`/`roster_*` DELETEs to other members'
  open tabs → the guild disappears for them live.

## UI — danger action + type-to-confirm (C1)
Extend the pure `guildRemoveAction(role, web, guildName)` helper return with two
optional fields: `danger?: boolean`, `requireName?: boolean`.
- Desktop (any role) → unchanged `{ label:'Remove', … }` (no danger/requireName).
- Web **non-owner** → unchanged `{ label:'Leave', … }`.
- Web **owner** → `{ label:'Delete', title:'Delete guild', confirmText:
  'Permanently delete "<name>" and ALL its data (roster, notes, members, invites,
  audit log) for every member? This cannot be undone.', danger:true,
  requireName:true }` (was `null`).

`GuildSettings` consumes it:
- A non-`requireName` action keeps the current inline `confirm()` → `removeGuild`
  → `onRemoved()` path (desktop Remove, web Leave).
- A `requireName` action opens a small inline **danger confirm panel** (local
  state, no new file): shows `confirmText`, a text input "Type the guild name to
  confirm", a red **Delete** button enabled only when the typed value `===
  guild.name`, and a Cancel. On confirm → `await client.removeGuild(guild.id)` →
  `onRemoved()`. The `danger` flag styles the trigger button red.

## Testing
Vitest (node, pure-logic only — no RTL).
- `guildRemoveAction.test.ts`: replace the "web owner → null" test with web-owner →
  the `{ label:'Delete', danger:true, requireName:true, … }` object; desktop +
  web-non-owner cases unchanged (still `toEqual` without the optional fields).
- `guilds.test.ts`: an **owner** `webRemoveGuild` invokes `delete-guild` with
  `{ body: { guildId: id } }` and clears `activeGuildId` when it matched; a
  non-owner still deletes its own membership (the 2c-17 behavior, unchanged); a
  non-member is a no-op. (Extend the fake's `functions.invoke` to return
  `{ data: { ok: true } }`.)
- The `delete-guild` Edge Function is inline Deno — no unit harness; verified by
  review + the deploy + the owner-path `guilds.test`. [FLAG]
- The type-to-confirm panel is presentational — `typed === guild.name` gating is
  verified by typecheck + build + review.
- Full suite (`--pool=forks --poolOptions.forks.maxForks=2`) + `npm run typecheck`
  + `npm run build:web` green.

## Out of scope
- Desktop owner-delete (desktop `removeGuild` stays local-forget; the contract is
  untouched). A separate `deleteGuild` contract method. Soft-delete / undo /
  export-before-delete. Transferring ownership.
