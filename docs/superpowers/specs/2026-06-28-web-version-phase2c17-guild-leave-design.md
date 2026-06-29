# Web Version — Phase 2c-17: Web Guild Leave (non-owner self-leave)

**Date:** 2026-06-28 · **Status:** Approved

## Goal
Let a non-owner member **leave** a guild from the web — the missing half of
`removeGuild` that 2c-16 had to defer because `workspace_members` RLS only
permits owner-delete. Add a self-leave RLS policy + re-enable the non-owner
branch of `webRemoveGuild`. Owner-side guild deletion stays deferred.

## Background (why 2c-16 deferred this)
`supabase/migrations/0002_rls_policies.sql:42` has the only delete policy:
`wm_delete on workspace_members for delete using (is_owner(workspace_id))`.
A non-owner deleting their own row is RLS-filtered to **zero rows**; PostgREST
returns success with no error, so the old `webRemoveGuild` cleared the local
active guild and the membership silently persisted (reappeared on next
`listGuilds`). The opus whole-branch review caught this; 2c-16 shipped
`webRemoveGuild` as a full no-op.

## The fix

### Migration `0010_self_leave.sql`
```sql
-- Let any member delete their OWN membership row (leave a guild). The existing
-- wm_delete policy is owner-only; permissive policies are OR-combined, so a row
-- is deletable when is_owner(ws) OR it is the caller's own row. This scopes
-- strictly to user_id = auth.uid(): a member cannot delete other members, and it
-- grants owners nothing they didn't already have via wm_delete.
create policy wm_self_leave on workspace_members
  for delete using (user_id = auth.uid());
```
- Permissive (default) → OR-combined with `wm_delete`. Net effect: delete allowed
  when `is_owner(ws)` **or** `user_id = auth.uid()`.
- A member can only ever match their **own** row (`user_id = auth.uid()`), so this
  cannot delete other members.
- Owners already could delete any row (including their own) via `wm_delete`; this
  adds nothing for them.

### `webRemoveGuild` (re-enable the non-owner branch)
Restore the pre-deferral logic, keeping owner deferred:
- Resolve my role for `id` (`roleFor`).
- **Non-owner** (`write`/`read`) → `workspace_members.delete()
  .eq('workspace_id', id).eq('user_id', me)`; if `id` was the active guild,
  clear `activeGuildId`.
- **Owner / not-a-member** → no-op (owner-side destructive guild deletion stays a
  separate, deliberate future feature; a desktop "remove" only forgets locally
  and never deletes the server workspace, so there's no parity action to mirror).
- Never throws.

## Deploy requirement [FLAG]
Code alone does NOT enable this — the policy must be applied to the live Supabase
instance: `supabase db push` (applies pending migrations) or paste the `create
policy` statement into the dashboard SQL editor. Until then `webRemoveGuild`'s
delete is still RLS-filtered to zero rows (the same silent-no-op 2c-16 found), so
the local active-guild clear must remain conditional on a successful delete to
avoid the UI lying. → `webRemoveGuild` checks the delete result: clear
`activeGuildId` only when `error` is null AND at least one row was returned
(`.select()` the delete so a zero-row filter is detectable). If nothing was
deleted, leave the active guild untouched.

## Architecture
- New `supabase/migrations/0010_self_leave.sql` (the policy above).
- Modify `src/renderer/src/lib/webClient/guilds.ts` — `webRemoveGuild` only (the
  helpers `roleFor`/`summaryFor`/`shareBody` and `webUpsertGuild`/`webClaimGuild`
  are unchanged). Use `.delete(...).select('user_id')` so the returned `data`
  array length reveals whether RLS actually deleted the row; only then clear the
  active guild.
- `webClient.ts` wiring is already `removeGuild: async (id) => { if
  (deps.supabase) await webRemoveGuild(deps.supabase, settings, id) }` — no change.

## Testing
Vitest (node), fakes only. Extend the `guilds.test.ts` fake's
`workspace_members.delete()` chain to support `.select(...)` returning
`{ data, error }` so the row-count guard is testable.
- non-owner leave, RLS permits (delete returns one row) → delete called with
  `(workspace_id=id, user_id=me)`; `activeGuildId` cleared when it matched.
- non-owner leave, RLS still blocks (delete returns zero rows, e.g. migration not
  yet applied) → `activeGuildId` is NOT cleared (no UI lie).
- owner → no delete, no-op.
- not-a-member → no delete, no-op.
- `webClient.test.ts` unchanged no-supabase path: `removeGuild` resolves
  undefined.
- Full suite (`--pool=forks --poolOptions.forks.maxForks=2`) + `npm run
  typecheck` + `npm run build:web` green. (Migrations have no unit harness in this
  repo; the policy is validated by the row-count behavior test + manual apply.)

## Out of scope
- Owner-side destructive guild deletion (cascade wipe of secrets/members/roster/
  audit) — a separate designed feature.
- Preventing a sole owner from orphaning a guild (the client never calls delete
  for owners; a stricter policy is unnecessary).
- Realtime reaction to a member leaving; retention/pipeline server persistence.
