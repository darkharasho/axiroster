# Web Version — Phase 2c-17: Web Guild Leave — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a non-owner member leave a guild from the web — add a self-leave RLS policy and re-enable `webRemoveGuild`'s non-owner branch with a row-count guard so it stays honest before the migration is applied.

**Architecture:** One new migration (`0010_self_leave.sql`) adds a permissive `for delete using (user_id = auth.uid())` policy on `workspace_members`. `webRemoveGuild` deletes the caller's own membership via `.delete()...select('user_id')` and clears the active guild only when a row was actually returned.

**Tech Stack:** Postgres RLS (Supabase), TypeScript, React renderer, Vitest, `@supabase/supabase-js`. No new deps.

## Global Constraints

- Change is exactly: new `supabase/migrations/0010_self_leave.sql` + `webRemoveGuild` in `src/renderer/src/lib/webClient/guilds.ts` (and its fake/tests in `guilds.test.ts`). Do NOT touch any other migration, Edge Function, `src/main`, `src/shared`, `src/preload`, other renderer files, `webClient.ts`, or the `roleFor`/`summaryFor`/`shareBody`/`webUpsertGuild`/`webClaimGuild` code in `guilds.ts`.
- `webRemoveGuild` NEVER throws.
- Non-owner (`write`/`read`) → delete own membership; owner / not-a-member → no-op (owner-side guild deletion stays deferred).
- Clear `activeGuildId` ONLY when the delete returned ≥1 row AND it matched `id` — so an RLS-filtered zero-row delete (migration not yet applied) does NOT clear it. No UI lie.
- The migration policy text is exactly `for delete using (user_id = auth.uid())` named `wm_self_leave` — permissive (no `as restrictive`).
- Run vitest with `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` + `npm run build:web` green.

Reused interfaces (unchanged):
- `roleFor(sb, ws): Promise<string | null>` (private in `guilds.ts`) — returns my role for `ws` or `null` if not a member.
- `WebSettings` `.get('activeGuildId')` / `.set('activeGuildId', '')`.

---

### Task 1: Self-leave migration + re-enabled `webRemoveGuild`

**Files:**
- Create: `supabase/migrations/0010_self_leave.sql`
- Modify: `src/renderer/src/lib/webClient/guilds.ts` (`webRemoveGuild` only)
- Modify: `src/renderer/src/lib/webClient/guilds.test.ts` (fake `delete().eq().eq().select()` + the removeGuild tests)

**Interfaces:**
- Produces: `webRemoveGuild(sb, settings, id): Promise<void>` — non-owner leaves; owner/non-member no-op; clears active guild only on a confirmed delete.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0010_self_leave.sql`:
```sql
-- Let any member delete their OWN membership row (leave a guild). The existing
-- wm_delete policy (0002) is owner-only; permissive policies are OR-combined, so
-- a row is deletable when is_owner(ws) OR it is the caller's own row. Scoped
-- strictly to user_id = auth.uid(): a member cannot delete other members, and it
-- grants owners nothing they didn't already have via wm_delete.
create policy wm_self_leave on workspace_members
  for delete using (user_id = auth.uid());
```

- [ ] **Step 2: Update the test fake + write the failing tests**

In `src/renderer/src/lib/webClient/guilds.test.ts`:

(a) Add a `deleteRows` option and make the `workspace_members.delete()` chain support a trailing `.select(...)` returning `{ data, error }`. Change the `fakeSb` options type and the delete chain:
```ts
function fakeSb(opts: {
  members?: { workspace_id: string; role: string }[]
  invoke?: ReturnType<typeof vi.fn>
  deleteRows?: { user_id: string }[]
} = {}) {
  const rec: {
    wsUpdate?: Record<string, unknown>
    wsUpdateId?: string
    deletedWs?: string
    deletedUser?: string
  } = {}
  // ...existing invoke/auth...
  // workspace_members branch — replace the delete chain with:
  //   delete: () => ({ eq: (_c, ws) => ({ eq: (_c2, uid) => ({
  //     select: () => { rec.deletedWs = ws; rec.deletedUser = uid;
  //       return Promise.resolve({ data: opts.deleteRows ?? [{ user_id: uid }], error: null }) } }) }) })
```
Full replacement of the `workspace_members` `delete` property:
```ts
          delete: () => ({
            eq: (_c: string, ws: string) => ({
              eq: (_c2: string, uid: string) => ({
                select: () => {
                  rec.deletedWs = ws
                  rec.deletedUser = uid
                  return Promise.resolve({ data: opts.deleteRows ?? [{ user_id: uid }], error: null })
                }
              })
            })
          })
```

(b) Replace the existing `removeGuild is a no-op on web (deferred …)` test with these four:
```ts
test('removeGuild: non-owner leaves (RLS permits) → deletes own membership + clears active', async () => {
  const { sb, rec } = fakeSb({ members: [{ workspace_id: 'g1', role: 'read' }], deleteRows: [{ user_id: 'u1' }] })
  const s = settings()
  s.set('activeGuildId', 'g1')
  await webRemoveGuild(sb, s, 'g1')
  expect(rec.deletedWs).toBe('g1')
  expect(rec.deletedUser).toBe('u1')
  expect(s.get('activeGuildId')).toBe('')
})

test('removeGuild: non-owner but RLS still blocks (0 rows) → active NOT cleared', async () => {
  const { sb, rec } = fakeSb({ members: [{ workspace_id: 'g1', role: 'read' }], deleteRows: [] })
  const s = settings()
  s.set('activeGuildId', 'g1')
  await webRemoveGuild(sb, s, 'g1')
  expect(rec.deletedWs).toBe('g1') // delete was attempted
  expect(s.get('activeGuildId')).toBe('g1') // but nothing was removed → no UI lie
})

test('removeGuild: owner → no delete, no-op', async () => {
  const { sb, rec } = fakeSb({ members: [{ workspace_id: 'g1', role: 'owner' }] })
  await webRemoveGuild(sb, settings(), 'g1')
  expect(rec.deletedWs).toBeUndefined()
})

test('removeGuild: not a member → no delete, no-op', async () => {
  const { sb, rec } = fakeSb({ members: [] })
  await webRemoveGuild(sb, settings(), 'g1')
  expect(rec.deletedWs).toBeUndefined()
})
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/guilds.test.ts`
Expected: FAIL — current `webRemoveGuild` is a no-op, so `rec.deletedWs` is `undefined` for the non-owner-leave test, and `activeGuildId` is not cleared.

- [ ] **Step 4: Re-implement `webRemoveGuild`**

Replace the entire `webRemoveGuild` function in `src/renderer/src/lib/webClient/guilds.ts` with:
```ts
export async function webRemoveGuild(sb: SupabaseClient, settings: WebSettings, id: string): Promise<void> {
  try {
    const {
      data: { user }
    } = await sb.auth.getUser()
    if (!user?.id) return
    const role = await roleFor(sb, id)
    // Owner-side guild deletion is destructive (wipes the workspace for every
    // member) and is a separate, deliberate future feature; a non-member has
    // nothing to leave. Only a non-owner member leaves here.
    if (role === null || role === 'owner') return
    const { data, error } = await sb
      .from('workspace_members')
      .delete()
      .eq('workspace_id', id)
      .eq('user_id', user.id)
      .select('user_id')
    // Clear the active guild only if RLS actually removed our row. Until the
    // wm_self_leave policy (migration 0010) is applied, the delete is filtered to
    // zero rows — don't pretend the leave worked.
    if (!error && Array.isArray(data) && data.length > 0 && settings.get('activeGuildId') === id) {
      settings.set('activeGuildId', '')
    }
  } catch {
    /* never throws */
  }
}
```

- [ ] **Step 5: Run — expect PASS (4 removeGuild tests + the rest of the file)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/guilds.test.ts`
Expected: PASS (the 8 upsert/claim tests still pass; the 4 new removeGuild tests pass). If a chain-shape mismatch surfaces, fix the fake — not the module.

- [ ] **Step 6: Full suite + gates**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/` → PASS.
Run: `npm test` → all pass. Run: `npm run typecheck` → clean. Run: `npm run build:web` → succeeds.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0010_self_leave.sql src/renderer/src/lib/webClient/guilds.ts src/renderer/src/lib/webClient/guilds.test.ts
git commit -m "feat(web): non-owner guild leave — wm_self_leave RLS policy + row-count-guarded removeGuild"
```

---

## Self-Review Notes

- **Spec coverage:** migration `0010_self_leave.sql` with the exact permissive policy → Step 1. Re-enabled non-owner `webRemoveGuild` with `.delete()...select('user_id')` row-count guard, owner/non-member no-op, never-throws → Step 4. Active-guild cleared only on confirmed delete (no UI lie pre-migration) → Step 4 + the "0 rows" test in Step 2. `webClient.ts` wiring already correct (unchanged) — not touched. Owner-side deletion + realtime out of scope (not implemented).
- **Placeholder scan:** none — migration SQL, the full `webRemoveGuild` body, the fake delta, and all four tests are complete.
- **Type consistency:** `webRemoveGuild(sb, settings, id)` matches the existing `webClient.ts` call `webRemoveGuild(deps.supabase, settings, id)`. `roleFor` returns `string | null` (used as `role === 'owner'` / `role === null`). The fake's `delete().eq().eq().select()` order matches the `.delete().eq('workspace_id', id).eq('user_id', user.id).select('user_id')` call. `deleteRows` defaults to one row (RLS-permitted) so the 8 unrelated tests are unaffected.
- **Deploy note (carried from spec):** the migration must be applied to the live Supabase (`supabase db push` or dashboard SQL) before leave works in production; the row-count guard keeps the UI honest until then.
