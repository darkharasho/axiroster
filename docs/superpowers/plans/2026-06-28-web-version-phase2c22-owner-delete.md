# Web Version — Phase 2c-22: Owner-Side Guild Deletion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a guild owner permanently delete a guild from the web — an owner-gated `delete-guild` Edge Function (cascade-wipe), `webRemoveGuild`'s owner branch invoking it, and a type-the-name confirm in the UI.

**Architecture:** `DELETE FROM workspaces` cascade-wipes all child tables (FKs are `ON DELETE CASCADE`). A service-role Edge Function verifies ownership and runs it. The existing `removeGuild` contract method is reused (owner→delete, non-owner→leave); the `guildRemoveAction` helper gains `danger`/`requireName` flags driving a type-to-confirm panel.

**Tech Stack:** Deno Edge Function, TypeScript renderer, Vitest (node, pure-logic only — no RTL), Tailwind. No new deps, no migration.

## Global Constraints

- Touch ONLY: `supabase/functions/delete-guild/index.ts` (new); `src/renderer/src/lib/webClient/guilds.ts` + `guilds.test.ts`; `src/renderer/src/components/GuildSettings.tsx` + `guildRemoveAction.test.ts`. Do NOT touch `src/main`, `src/shared`, `src/preload`, other functions/migrations, or other renderer files.
- `webRemoveGuild` NEVER throws and returns `void`.
- Owner deletion goes through the Edge Function only (service-role); the browser never deletes `workspaces` directly. Non-owner leave (2c-17) is unchanged. Non-member is a no-op.
- The Edge Function mirrors `share-keys`'s shape exactly (anon userClient with the request `Authorization` header for `getUser`; service-role `db` for the privileged work; `corsHeaders`/`preflight` from `../_shared/cors.ts`).
- Type-to-confirm: the red Delete button enables only when the typed text `=== guild.name`.
- Run vitest with `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` + `npm run build:web` green. (The Deno function is not in the JS typecheck; verified by review + the controller deploy.)

Reused facts:
- `_shared/cors.ts` exports `corsHeaders: Record<string,string>` and `preflight(req): Response | null`.
- `roleFor(sb, ws): Promise<string | null>` (private in `guilds.ts`).
- `guildRemoveAction(role, web, guildName)` (exported from `GuildSettings.tsx`) currently returns `{ label; title; confirmText } | null`.

---

### Task 1: `delete-guild` Edge Function

**Files:**
- Create: `supabase/functions/delete-guild/index.ts`

(No unit harness — inline Deno function; verified by review + the owner-path test in Task 2 + the controller deploy. Do NOT add a JS test.)

- [ ] **Step 1: Write the function**

`supabase/functions/delete-guild/index.ts`:
```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, preflight } from '../_shared/cors.ts'

// Owner-only, destructive: permanently delete a workspace. Every child table FKs
// workspaces(workspace_id) ON DELETE CASCADE, so deleting the workspaces row wipes
// all roster/member/invite/secret/audit/retention data. Cascade runs privileged
// (child RLS bypassed). Service-role is required because there is no ws_delete RLS.
Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
  })
  const {
    data: { user }
  } = await userClient.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await req.json().catch(() => ({}))) as { guildId?: string }
  if (!body.guildId) return json({ error: 'guildId required' }, 400)

  const db = createClient(url, service)
  const { data: m } = await db
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', body.guildId)
    .eq('user_id', user.id)
    .maybeSingle()
  if ((m as { role?: string } | null)?.role !== 'owner') return json({ error: 'not_owner' }, 403)

  const { error } = await db.from('workspaces').delete().eq('workspace_id', body.guildId)
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true }, 200)
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}
```

- [ ] **Step 2: Sanity-check**

Re-read the file. Confirm: `preflight` guard first; `getUser` via the anon userClient carrying the request `Authorization`; owner check via the service-role `db` (`role !== 'owner'` → 403); the delete uses the service-role `db` (not the userClient); every response carries `corsHeaders`. (If `deno` is installed: `deno check supabase/functions/delete-guild/index.ts` — optional.)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/delete-guild/index.ts
git commit -m "feat(supabase): delete-guild edge function — owner-gated cascade workspace delete"
```

---

### Task 2: `webRemoveGuild` owner→delete + `guildRemoveAction` danger flags

**Files:**
- Modify: `src/renderer/src/lib/webClient/guilds.ts` (`webRemoveGuild`), `src/renderer/src/components/GuildSettings.tsx` (`guildRemoveAction`)
- Test: `src/renderer/src/lib/webClient/guilds.test.ts`, `src/renderer/src/components/guildRemoveAction.test.ts`

- [ ] **Step 1: Update the failing tests**

In `src/renderer/src/lib/webClient/guilds.test.ts`, REPLACE the test `removeGuild: owner → no delete, no-op` with:
```ts
test('removeGuild: owner → invokes delete-guild and clears active', async () => {
  const invoke = vi.fn(async () => ({ data: { ok: true }, error: null }))
  const { sb } = fakeSb({ members: [{ workspace_id: 'g1', role: 'owner' }], invoke })
  const s = settings()
  s.set('activeGuildId', 'g1')
  await webRemoveGuild(sb, s, 'g1')
  expect(invoke).toHaveBeenCalledWith('delete-guild', { body: { guildId: 'g1' } })
  expect(s.get('activeGuildId')).toBe('')
})
```
(Keep the other three removeGuild tests — non-owner-leave permits, non-owner-leave 0-rows, and not-a-member no-op — unchanged. Note: `fakeSb`'s `workspace_members` branch must serve BOTH `roleFor` (`.select().eq()` returning all members) and the non-owner `.delete().eq().eq().select()` chain; it already does from 2c-17.)

In `src/renderer/src/components/guildRemoveAction.test.ts`, REPLACE the test `web owner: button hidden (null)` with:
```ts
test('web owner: destructive Delete with type-to-confirm flags', () => {
  expect(guildRemoveAction('owner', true, 'Saga')).toEqual({
    label: 'Delete',
    title: 'Delete guild',
    confirmText:
      'Permanently delete "Saga" and ALL its data (roster, notes, members, invites, audit log) for every member? This cannot be undone.',
    danger: true,
    requireName: true
  })
})
```
(Keep the desktop and web-non-owner tests unchanged — those returns have no `danger`/`requireName` keys, so their `toEqual` still holds.)

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/guilds.test.ts src/renderer/src/components/guildRemoveAction.test.ts`
Expected: FAIL — `webRemoveGuild` owner branch is a no-op (no invoke); `guildRemoveAction('owner', true, …)` returns `null`.

- [ ] **Step 3: Implement**

In `src/renderer/src/lib/webClient/guilds.ts`, replace the `webRemoveGuild` body's role-branch. Replace this block:
```ts
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
```
with:
```ts
    const role = await roleFor(sb, id)
    if (role === null) return // not a member — nothing to do
    if (role === 'owner') {
      // Owner-side deletion: the delete-guild Edge Function verifies ownership and
      // cascade-wipes the workspace (all child tables ON DELETE CASCADE).
      const { data, error } = await sb.functions.invoke('delete-guild', { body: { guildId: id } })
      const res = (data ?? {}) as { ok?: boolean; error?: string }
      if (!error && res.ok && settings.get('activeGuildId') === id) settings.set('activeGuildId', '')
      return
    }
    // Non-owner: leave by deleting our own membership. Clear the active guild only
    // if RLS actually removed our row (wm_self_leave policy, 2c-17).
    const { data, error } = await sb
      .from('workspace_members')
      .delete()
      .eq('workspace_id', id)
      .eq('user_id', user.id)
      .select('user_id')
    if (!error && Array.isArray(data) && data.length > 0 && settings.get('activeGuildId') === id) {
      settings.set('activeGuildId', '')
    }
```

In `src/renderer/src/components/GuildSettings.tsx`, change `guildRemoveAction`'s return type and the web-owner branch:
```ts
export function guildRemoveAction(
  role: string | undefined,
  web: boolean,
  guildName: string
): { label: string; title: string; confirmText: string; danger?: boolean; requireName?: boolean } | null {
  if (!web) {
    return {
      label: 'Remove',
      title: 'Remove guild',
      confirmText: `Remove guild "${guildName}"? Its keys and selections are deleted.`
    }
  }
  if (role === 'owner') {
    return {
      label: 'Delete',
      title: 'Delete guild',
      confirmText: `Permanently delete "${guildName}" and ALL its data (roster, notes, members, invites, audit log) for every member? This cannot be undone.`,
      danger: true,
      requireName: true
    }
  }
  return {
    label: 'Leave',
    title: 'Leave guild',
    confirmText: `Leave guild "${guildName}"? You'll lose access to its roster.`
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/guilds.test.ts src/renderer/src/components/guildRemoveAction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/webClient/guilds.ts src/renderer/src/components/guildRemoveAction.test.ts src/renderer/src/components/GuildSettings.tsx
git commit -m "feat(web): owner removeGuild → delete-guild; guildRemoveAction danger/requireName flags"
```
(Note: `GuildSettings.tsx` also changes in Task 3; committing the helper here is fine — Task 3 adds the consuming UI.)

---

### Task 3: Type-to-confirm delete panel in `GuildSettings`

**Files:**
- Modify: `src/renderer/src/components/GuildSettings.tsx` (the remove-button IIFE → consume `danger`/`requireName`)

(Presentational — no new unit test; the `typed === guild.name` gate + styling are verified by typecheck + build + review. `guildRemoveAction`'s flags are already tested in Task 2.)

- [ ] **Step 1: Add confirm state + replace the remove-button IIFE**

Near the other `useState` hooks in `GuildSettings` (the default export component, not `GuildEditor`), add:
```ts
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmName, setConfirmName] = useState('')
```
Replace the existing remove-button IIFE (the `{(() => { const action = guildRemoveAction(role, isWeb(), guild.name) … })()}` block) with one that branches on `requireName`:
```tsx
          {(() => {
            const action = guildRemoveAction(role, isWeb(), guild.name)
            if (!action) return null
            if (action.requireName) {
              return (
                <button
                  onClick={() => {
                    setConfirmName('')
                    setConfirmingDelete(true)
                  }}
                  className="btn text-red-400 hover:bg-red-500/10"
                  title={action.title}
                >
                  <Trash2 size={14} /> {action.label}
                </button>
              )
            }
            return (
              <button
                onClick={async () => {
                  if (confirm(action.confirmText)) {
                    await client.removeGuild(guild.id)
                    onRemoved()
                  }
                }}
                className="btn text-ink-faint hover:text-red-400"
                title={action.title}
              >
                <Trash2 size={14} /> {action.label}
              </button>
            )
          })()}
```

- [ ] **Step 2: Add the confirm overlay**

Immediately after the `</div>` that closes the header row containing that button (i.e. as a sibling within the same section, before the `{profile ? (` block), add the modal — gated on `confirmingDelete`:
```tsx
        {confirmingDelete && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-xl border border-red-500/30 bg-panel-raised p-5 shadow-raise-lg">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-400">
                <Trash2 size={15} /> Delete “{guild.name}”
              </h3>
              <p className="mb-4 text-[13px] leading-relaxed text-ink-dim">
                Permanently delete <span className="text-ink">{guild.name}</span> and ALL its data
                (roster, notes, members, invites, audit log) for every member. This cannot be undone.
              </p>
              <label className="mb-1.5 block text-xs text-ink-faint">
                Type <span className="font-mono text-ink">{guild.name}</span> to confirm
              </label>
              <input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                className="mb-4 w-full rounded-lg border border-panel-line2 bg-panel-sunk px-3 py-2 text-[13px] text-ink shadow-sunk outline-none focus:border-red-500"
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setConfirmingDelete(false)} className="btn text-ink-dim">
                  Cancel
                </button>
                <button
                  disabled={confirmName !== guild.name}
                  onClick={async () => {
                    setConfirmingDelete(false)
                    await client.removeGuild(guild.id)
                    onRemoved()
                  }}
                  className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Delete guild
                </button>
              </div>
            </div>
          </div>
        )}
```

- [ ] **Step 3: Gates**

Run: `npm run typecheck` → clean (no unused symbols; `useState` already imported). Run: `npm run build:web` → succeeds. Run: `npm test` (`npx vitest run --pool=forks --poolOptions.forks.maxForks=2`) → all pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/GuildSettings.tsx
git commit -m "feat(web): type-to-confirm panel for owner guild deletion"
```

---

## Self-Review Notes

- **Spec coverage:** `delete-guild` Edge Function (owner-gated cascade delete, share-keys shape) → Task 1. `webRemoveGuild` owner→invoke delete-guild + clear active, non-owner leave unchanged, non-member no-op → Task 2 Step 3. `guildRemoveAction` `danger`/`requireName` for web-owner → Task 2 Step 3. Type-to-confirm UI (input gate `=== guild.name`, danger styling) → Task 3. Owner-path + helper-flag tests → Task 2 Step 1. Deploy = controller step (post-merge).
- **Placeholder scan:** none — full function, full `webRemoveGuild`/`guildRemoveAction` bodies, full UI blocks, full tests.
- **Type consistency:** `webRemoveGuild(sb, settings, id): Promise<void>` unchanged. `guildRemoveAction` return adds optional `danger?`/`requireName?` — consumed in Task 3 via `action.requireName`; the test object in Task 2 matches the impl exactly (label/title/confirmText/danger/requireName). The Edge Function body `{ guildId }` matches the `invoke('delete-guild', { body: { guildId: id } })` call and the Task 2 test assertion. `corsHeaders`/`preflight` import path `../_shared/cors.ts` matches `share-keys`.
- **No regression:** desktop `guildRemoveAction` (web=false) and web non-owner returns are byte-identical to before (no new keys), so their tests + behavior are unchanged. Non-owner leave path in `webRemoveGuild` is the verbatim 2c-17 logic, just moved below the owner branch.
