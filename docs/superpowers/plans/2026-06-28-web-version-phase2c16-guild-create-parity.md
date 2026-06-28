# Web Version — Phase 2c-16: Web Guild Create/Configure Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing "Add a guild" form work on web by implementing real `upsertGuild`/`claimGuild`/`removeGuild` against the same `claim-guild` + `share-keys` Edge Functions the desktop uses.

**Architecture:** New `src/renderer/src/lib/webClient/guilds.ts` holds the three methods + a `summaryFor` helper + a `roleFor` lookup. `webClient.ts` re-points the three method wirings from `admin.ts` to `guilds.ts`. One small shared-UI change: `GuildEditor.save()` surfaces a failed create instead of always toasting success.

**Tech Stack:** TypeScript, React renderer, Vitest, `@supabase/supabase-js`. No new deps.

## Global Constraints

- Change confined to `src/renderer/src/lib/webClient/` (new `guilds.ts` + `guilds.test.ts`; edits to `webClient.ts`, `admin.ts`, `admin.test.ts`) and the one `GuildSettings.tsx` `save()` touch (+ its test). Do NOT touch `src/main`, `src/shared`, `src/preload`, `supabase/`, migrations, or other renderer files.
- `workspace_id === input.gw2GuildId`. Empty `gw2GuildId` → `upsertGuild` returns `null` (no Edge Function call).
- All three methods NEVER throw — return `null` / `{ok:false,error}` / `undefined` on any caught error.
- `retentionEnabled`/`pipelineEnabled` are NOT persisted (desktop-local-only). `summaryFor` sets them from the input echo only; the Edge Functions are never sent them.
- Edit (`input.id` present) must NOT call `claim-guild` (would 409). Owner→`share-keys`; write→`workspaces` RLS update `{member_role_id, bridge_repos}`; read/none→no-op.
- `removeGuild`: non-owner → delete own membership (+ clear `activeGuildId` if it matched); owner → no-op (deferred destructive flow).
- No-supabase fallbacks stay safe: `upsertGuild`→`null`, `claimGuild`→`{ok:false,error:'Not signed in'}`, `removeGuild`→no-op.
- Run vitest with `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` + `npm run build:web` green.

Exact Edge Function shapes (verbatim):
- `claim-guild` body `{ apiKey, guildId, guildName?, discordGuildId?, discordGuildName? }` → `{ workspaceId, role }` or `{ error }` (`'not_leader'` 403, `'already_claimed'` 409).
- `share-keys` body `{ guildId, share:true, apiKey, axitoolsKey?, gw2GuildName?, discordGuildId?, discordGuildName?, memberRoleId?, bridgeRepos? }` (owner-only).

Reused interfaces (from earlier phases):
- `resolveEffectiveWorkspace(sb, settings, userId): Promise<{workspaceId, role} | null>` (`./auth`).
- `activeWorkspaceId(sb, settings): Promise<string | null>` (`./discordGw2`).
- `WebSettings` with `.get('activeGuildId')` / `.set('activeGuildId', id)` / `.remove(key)` (`./settings`).
- `GuildProfileInput` fields used: `id?`, `name`, `gw2ApiKey`, `gw2GuildId`, `gw2GuildName`, `gw2AccountName`, `axitoolsKey`, `discordGuildId`, `discordGuildName`, `memberRoleId`, `bridgeRepos: {owner,repo}[]`, `shared`, `axitoolsShared`, `retentionEnabled`, `pipelineEnabled`.
- `GuildSummary` fields: `id, name, active, gw2GuildName, gw2GuildId, gw2AccountName, hasGw2Key, discordGuildName, discordGuildId, hasAxitoolsKey, memberRoleId, bridgeRepos, shared, axitoolsShared, retentionEnabled, pipelineEnabled`.

---

### Task 1: `guilds.ts` — web guild create/configure/remove

**Files:**
- Create: `src/renderer/src/lib/webClient/guilds.ts`, `src/renderer/src/lib/webClient/guilds.test.ts`
- Modify: `src/renderer/src/lib/webClient/webClient.ts`, `admin.ts`, `admin.test.ts`

**Interfaces:**
- Produces: `webUpsertGuild(sb, settings, input): Promise<GuildSummary | null>`, `webClaimGuild(sb, settings): Promise<ClaimGuildResult>`, `webRemoveGuild(sb, settings, id): Promise<void>`.
- Consumes: `resolveEffectiveWorkspace` (`./auth`), `WebSettings` (`./settings`).

- [ ] **Step 1: Write the failing test**

`src/renderer/src/lib/webClient/guilds.test.ts`:
```ts
import { test, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { webUpsertGuild, webClaimGuild, webRemoveGuild } from './guilds'
import { createWebSettings } from './settings'
import type { GuildProfileInput } from '../../../../preload/index.d'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size
    }
  } as Storage
}
const settings = () => createWebSettings(fakeStorage())

// members: array of {workspace_id, role} for the signed-in user. invoke: spy.
// Records workspaces.update + workspace_members.delete calls.
function fakeSb(opts: {
  members?: { workspace_id: string; role: string }[]
  invoke?: ReturnType<typeof vi.fn>
} = {}) {
  const rec: { wsUpdate?: Record<string, unknown>; wsUpdateId?: string; deletedWs?: string; deletedUser?: string } = {}
  const invoke = opts.invoke ?? vi.fn(async () => ({ data: { workspaceId: 'g1', role: 'owner' }, error: null }))
  const sb = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => {
      if (t === 'workspace_members') {
        return {
          select: () => ({ eq: () => Promise.resolve({ data: opts.members ?? [{ workspace_id: 'g1', role: 'owner' }] }) }),
          delete: () => ({
            eq: (_c: string, ws: string) => ({
              eq: (_c2: string, uid: string) => {
                rec.deletedWs = ws
                rec.deletedUser = uid
                return Promise.resolve({ error: null })
              }
            })
          })
        }
      }
      // workspaces
      return {
        update: (vals: Record<string, unknown>) => ({
          eq: (_c: string, ws: string) => {
            rec.wsUpdate = vals
            rec.wsUpdateId = ws
            return Promise.resolve({ error: null })
          }
        })
      }
    },
    functions: { invoke }
  } as unknown as SupabaseClient
  return { sb, rec, invoke }
}

const baseInput = (over: Partial<GuildProfileInput> = {}): GuildProfileInput => ({
  id: undefined,
  name: 'Saga',
  gw2ApiKey: 'KEY-1',
  gw2GuildId: 'g1',
  gw2GuildName: '[SAGA] Saga',
  gw2AccountName: 'Rasho.1234',
  axitoolsKey: 'axt1.abc',
  discordGuildId: 'd1',
  discordGuildName: 'Saga Discord',
  memberRoleId: 'r1',
  bridgeRepos: [{ owner: 'o', repo: 'r' }],
  shared: false,
  axitoolsShared: false,
  retentionEnabled: false,
  pipelineEnabled: true,
  ...over
})

test('create: claims then shares keys, sets active, returns summary', async () => {
  const { sb, invoke } = fakeSb({ members: [] })
  const s = settings()
  const out = await webUpsertGuild(sb, s, baseInput())
  expect(invoke).toHaveBeenNthCalledWith(1, 'claim-guild', {
    body: { apiKey: 'KEY-1', guildId: 'g1', guildName: 'Saga', discordGuildId: 'd1', discordGuildName: 'Saga Discord' }
  })
  expect(invoke).toHaveBeenNthCalledWith(2, 'share-keys', {
    body: {
      guildId: 'g1',
      share: true,
      apiKey: 'KEY-1',
      axitoolsKey: 'axt1.abc',
      gw2GuildName: '[SAGA] Saga',
      discordGuildId: 'd1',
      discordGuildName: 'Saga Discord',
      memberRoleId: 'r1',
      bridgeRepos: [{ owner: 'o', repo: 'r' }]
    }
  })
  expect(s.get('activeGuildId')).toBe('g1')
  expect(out).toMatchObject({ id: 'g1', name: 'Saga', active: true, hasGw2Key: true, hasAxitoolsKey: true })
})

test('create: empty gw2GuildId returns null without any invoke', async () => {
  const { sb, invoke } = fakeSb({ members: [] })
  expect(await webUpsertGuild(sb, settings(), baseInput({ gw2GuildId: '' }))).toBeNull()
  expect(invoke).not.toHaveBeenCalled()
})

test('create: already_claimed by me → skip claim error, still shares', async () => {
  const invoke = vi
    .fn()
    .mockResolvedValueOnce({ data: { error: 'already_claimed' }, error: null }) // claim-guild
    .mockResolvedValueOnce({ data: {}, error: null }) // share-keys
  const { sb } = fakeSb({ members: [{ workspace_id: 'g1', role: 'owner' }], invoke })
  const out = await webUpsertGuild(sb, settings(), baseInput())
  expect(invoke).toHaveBeenCalledTimes(2)
  expect(invoke.mock.calls[1][0]).toBe('share-keys')
  expect(out?.id).toBe('g1')
})

test('create: already_claimed by someone else → null', async () => {
  const invoke = vi.fn().mockResolvedValueOnce({ data: { error: 'already_claimed' }, error: null })
  const { sb } = fakeSb({ members: [], invoke }) // not a member ⇒ not owner
  expect(await webUpsertGuild(sb, settings(), baseInput())).toBeNull()
  expect(invoke).toHaveBeenCalledTimes(1)
})

test('create: not_leader → null', async () => {
  const invoke = vi.fn().mockResolvedValueOnce({ data: { error: 'not_leader' }, error: null })
  const { sb } = fakeSb({ members: [], invoke })
  expect(await webUpsertGuild(sb, settings(), baseInput())).toBeNull()
})

test('edit (owner): shares keys only, no claim', async () => {
  const invoke = vi.fn(async () => ({ data: {}, error: null }))
  const { sb } = fakeSb({ members: [{ workspace_id: 'g1', role: 'owner' }], invoke })
  const out = await webUpsertGuild(sb, settings(), baseInput({ id: 'g1' }))
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(invoke.mock.calls[0][0]).toBe('share-keys')
  expect(out?.id).toBe('g1')
})

test('edit (write): updates workspaces config, no invoke', async () => {
  const invoke = vi.fn()
  const { sb, rec } = fakeSb({ members: [{ workspace_id: 'g1', role: 'write' }], invoke })
  await webUpsertGuild(sb, settings(), baseInput({ id: 'g1' }))
  expect(invoke).not.toHaveBeenCalled()
  expect(rec.wsUpdate).toEqual({ member_role_id: 'r1', bridge_repos: [{ owner: 'o', repo: 'r' }] })
  expect(rec.wsUpdateId).toBe('g1')
})

test('claimGuild: owner active ws → ok', async () => {
  const { sb } = fakeSb({ members: [{ workspace_id: 'g1', role: 'owner' }] })
  const s = settings()
  s.set('activeGuildId', 'g1')
  expect(await webClaimGuild(sb, s)).toEqual({ ok: true, workspaceId: 'g1' })
})

test('claimGuild: non-owner → error', async () => {
  const { sb } = fakeSb({ members: [{ workspace_id: 'g1', role: 'read' }] })
  const r = await webClaimGuild(sb, settings())
  expect(r.ok).toBe(false)
})

test('claimGuild: no membership → error', async () => {
  const { sb } = fakeSb({ members: [] })
  expect((await webClaimGuild(sb, settings())).ok).toBe(false)
})

test('removeGuild: non-owner leaves (deletes own membership) + clears active', async () => {
  const { sb, rec } = fakeSb({ members: [{ workspace_id: 'g1', role: 'read' }] })
  const s = settings()
  s.set('activeGuildId', 'g1')
  await webRemoveGuild(sb, s, 'g1')
  expect(rec.deletedWs).toBe('g1')
  expect(rec.deletedUser).toBe('u1')
  expect(s.get('activeGuildId')).toBe('')
})

test('removeGuild: owner is a no-op (no delete)', async () => {
  const { sb, rec } = fakeSb({ members: [{ workspace_id: 'g1', role: 'owner' }] })
  await webRemoveGuild(sb, settings(), 'g1')
  expect(rec.deletedWs).toBeUndefined()
})
```

- [ ] **Step 2: Run — expect FAIL (missing module)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/guilds.test.ts`
Expected: FAIL — cannot find `./guilds`.

- [ ] **Step 3: Implement `guilds.ts`**

```ts
// src/renderer/src/lib/webClient/guilds.ts
// Web guild create/configure/remove parity. Drives the same Edge Functions the
// desktop uses (claim-guild + share-keys); workspace_id === gw2GuildId. The
// desktop's save-local-then-claim two-step collapses to one server round-trip
// because the browser has no local guild cache to bridge them.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GuildSummary, GuildProfileInput, ClaimGuildResult } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { resolveEffectiveWorkspace } from './auth'

// My role for a specific workspace id (null if I'm not a member of it).
async function roleFor(sb: SupabaseClient, ws: string): Promise<string | null> {
  const {
    data: { user }
  } = await sb.auth.getUser()
  if (!user?.id) return null
  const { data } = await sb
    .from('workspace_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('workspace_id', ws)
    .maybeSingle()
  return data ? String((data as { role: unknown }).role) : null
}

function summaryFor(input: GuildProfileInput, ws: string, active: boolean): GuildSummary {
  return {
    id: ws,
    name: input.name,
    active,
    gw2GuildName: input.gw2GuildName,
    gw2GuildId: input.gw2GuildId,
    gw2AccountName: input.gw2AccountName,
    hasGw2Key: Boolean(input.gw2ApiKey),
    discordGuildName: input.discordGuildName,
    discordGuildId: input.discordGuildId,
    hasAxitoolsKey: Boolean(input.axitoolsKey),
    memberRoleId: input.memberRoleId,
    bridgeRepos: input.bridgeRepos,
    shared: input.shared ?? false,
    axitoolsShared: input.axitoolsShared ?? false,
    retentionEnabled: input.retentionEnabled ?? false,
    pipelineEnabled: input.pipelineEnabled !== false
  }
}

function shareBody(input: GuildProfileInput, ws: string): Record<string, unknown> {
  return {
    guildId: ws,
    share: true,
    apiKey: input.gw2ApiKey,
    axitoolsKey: input.axitoolsKey || undefined,
    gw2GuildName: input.gw2GuildName,
    discordGuildId: input.discordGuildId,
    discordGuildName: input.discordGuildName,
    memberRoleId: input.memberRoleId,
    bridgeRepos: input.bridgeRepos
  }
}

export async function webUpsertGuild(
  sb: SupabaseClient,
  settings: WebSettings,
  input: GuildProfileInput
): Promise<GuildSummary | null> {
  try {
    const ws = input.gw2GuildId
    if (!ws) return null // no GW2 guild ⇒ no workspace_id ⇒ can't create on the server

    if (!input.id) {
      // Create: claim, then push config.
      const { data, error } = await sb.functions.invoke('claim-guild', {
        body: {
          apiKey: input.gw2ApiKey,
          guildId: ws,
          guildName: input.name,
          discordGuildId: input.discordGuildId,
          discordGuildName: input.discordGuildName
        }
      })
      const res = (data ?? {}) as { error?: string; workspaceId?: string; role?: string }
      if (error || res.error) {
        // Re-configuring a guild I already own is fine; anything else fails.
        if (res.error === 'already_claimed' && (await roleFor(sb, ws)) === 'owner') {
          // fall through to share-keys
        } else {
          return null
        }
      }
      await sb.functions.invoke('share-keys', { body: shareBody(input, ws) }).catch(() => {})
      settings.set('activeGuildId', ws)
      return summaryFor(input, ws, true)
    }

    // Edit: push config by role (mirrors desktop pushSharedConfig).
    const role = await roleFor(sb, ws)
    if (role === 'owner') {
      await sb.functions.invoke('share-keys', { body: shareBody(input, ws) }).catch(() => {})
    } else if (role === 'write') {
      await sb
        .from('workspaces')
        .update({ member_role_id: input.memberRoleId, bridge_repos: input.bridgeRepos })
        .eq('workspace_id', ws)
    }
    const active = settings.get('activeGuildId') === ws
    return summaryFor(input, ws, active)
  } catch {
    return null
  }
}

export async function webClaimGuild(sb: SupabaseClient, settings: WebSettings): Promise<ClaimGuildResult> {
  try {
    const {
      data: { user }
    } = await sb.auth.getUser()
    if (!user?.id) return { ok: false, error: 'Not signed in' }
    const ws = await resolveEffectiveWorkspace(sb, settings, user.id)
    if (!ws) return { ok: false, error: 'Add a guild first.' }
    if (ws.role !== 'owner') return { ok: false, error: 'Only the owner can claim this guild.' }
    return { ok: true, workspaceId: ws.workspaceId }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function webRemoveGuild(sb: SupabaseClient, settings: WebSettings, id: string): Promise<void> {
  try {
    const {
      data: { user }
    } = await sb.auth.getUser()
    if (!user?.id) return
    const role = await roleFor(sb, id)
    if (role === null || role === 'owner') return // owner-delete is deferred (destructive)
    await sb.from('workspace_members').delete().eq('workspace_id', id).eq('user_id', user.id)
    if (settings.get('activeGuildId') === id) settings.set('activeGuildId', '')
  } catch {
    /* never throws */
  }
}
```

- [ ] **Step 4: Run — expect PASS (12 tests)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/guilds.test.ts`
Expected: PASS. If the fake's `maybeSingle`/`delete` chain shape is off, fix the fake — not the module.

- [ ] **Step 5: Remove the 3 guild stubs from `admin.ts`**

Delete `webAdoptSharedKeys`? NO — keep it. Delete only `webClaimGuild`, `webUpsertGuild`, `webRemoveGuild` from `admin.ts` (lines ~97-109) and drop the now-unused `ClaimGuildResult`/`GuildProfileInput`/`GuildSummary` imports there IF they become unused (keep any still used). Remove the three corresponding tests from `admin.test.ts` (the `adopt/claim/upsert/remove return honest web defaults` test → trim to just `adoptSharedKeys`). `adoptSharedKeys` stays in `admin.ts`.

- [ ] **Step 6: Re-wire `webClient.ts`**

Add import: `import { webUpsertGuild, webClaimGuild, webRemoveGuild } from './guilds'`. Remove `webUpsertGuild`/`webClaimGuild`/`webRemoveGuild` from the `./admin` import (keep `webAdoptSharedKeys` etc.). Replace the three wirings:
```ts
upsertGuild: async (input) => (deps.supabase ? webUpsertGuild(deps.supabase, settings, input) : null),
removeGuild: async (id) => {
  if (deps.supabase) await webRemoveGuild(deps.supabase, settings, id)
},
claimGuild: async () => (deps.supabase ? webClaimGuild(deps.supabase, settings) : { ok: false, error: 'Not signed in' }),
```

- [ ] **Step 7: Run web-client suite + full suite + gates**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/` → PASS.
Run: `npm test` → all pass. Run: `npm run typecheck` → clean. Run: `npm run build:web` → succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/lib/webClient
git commit -m "feat(web): real upsertGuild/claimGuild/removeGuild over claim-guild + share-keys"
```

---

### Task 2: Surface a failed guild create in `GuildEditor.save()`

**Files:**
- Modify: `src/renderer/src/components/GuildSettings.tsx` (the `save()` function ~243-247)
- Test: `src/renderer/src/components/guildEditorSave.test.ts` (new, logic-focused)

**Interfaces:**
- Consumes: `client.upsertGuild(input): Promise<GuildSummary | null>`, `toast(msg, variant?)` from `../lib/toast`.

- [ ] **Step 1: Write the failing test**

The save decision is trivial to test if extracted. Add an exported pure helper to `GuildSettings.tsx` and test it.

`src/renderer/src/components/guildEditorSave.test.ts`:
```ts
import { test, expect } from 'vitest'
import { saveOutcome } from './GuildSettings'

test('null result → error outcome, do not finish', () => {
  expect(saveOutcome(null)).toEqual({
    ok: false,
    message: "Couldn't add guild — check you're a GW2 guild leader and the keys are valid.",
    variant: 'error'
  })
})

test('summary result → success outcome', () => {
  expect(saveOutcome({ id: 'g1' } as never)).toEqual({ ok: true, message: 'Guild added', variant: 'success' })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/components/guildEditorSave.test.ts`
Expected: FAIL — `saveOutcome` not exported.

- [ ] **Step 3: Add `saveOutcome` and use it in `save()`**

`GuildSummary` is ALREADY imported in the `import type { ... } from '../../../preload/index.d'` block (line ~9) — do NOT add another import. Near the top of `GuildSettings.tsx` (after the imports), add:
```ts
export function saveOutcome(result: GuildSummary | null): {
  ok: boolean
  message: string
  variant: 'success' | 'error'
} {
  return result
    ? { ok: true, message: 'Guild added', variant: 'success' }
    : {
        ok: false,
        message: "Couldn't add guild — check you're a GW2 guild leader and the keys are valid.",
        variant: 'error'
      }
}
```
(If `GuildSummary` is already imported in the existing `import type { ... } from '../../../preload/index.d'` block at line 4, add it there instead of a second import.)

Replace `save()` (lines ~242-247):
```ts
  // Explicit create (the add-a-guild flow). Editing an existing guild autosaves.
  const save = async (): Promise<void> => {
    const result = await client.upsertGuild(buildInput())
    const outcome = saveOutcome(result)
    toast(outcome.message, outcome.variant)
    if (outcome.ok) onDone()
  }
```
(The embedded-autosave path at ~265-276 is UNCHANGED — edits return a summary.)

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/components/guildEditorSave.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite + gates**

Run: `npm test` → all pass. Run: `npm run typecheck` → clean. Run: `npm run build:web` → succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/GuildSettings.tsx src/renderer/src/components/guildEditorSave.test.ts
git commit -m "feat(web): surface failed guild create in GuildEditor save (non-leader/invalid keys)"
```

---

## Self-Review Notes

- **Spec coverage:** `upsertGuild` create (claim→share→active→summary, already_claimed-by-me, by-other, not_leader, empty-gw2GuildId) + edit (owner share-keys / write workspaces.update) → Task 1 Steps 1,3. `claimGuild` confirm → Task 1. `removeGuild` non-owner-leave / owner-no-op → Task 1. Re-wire + admin.ts stub removal → Task 1 Steps 5-6. Save-error UI touch → Task 2. retentionEnabled/pipelineEnabled echoed in `summaryFor`, never sent to functions (Global Constraints + `shareBody` omits them). `src/main`/`supabase`/migrations untouched.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `webUpsertGuild(sb, settings, input)` / `webClaimGuild(sb, settings)` / `webRemoveGuild(sb, settings, id)` signatures match the wiring in Step 6 and the spec. `GuildSummary`/`GuildProfileInput`/`ClaimGuildResult` field names verified against `preload/index.d`. `shareBody`/`summaryFor`/`roleFor` referenced consistently. `settings.set('activeGuildId','')` matches `webSetActiveGuild`'s key.
- **Flagged divergence (carried from spec):** keyless guild → null; owner-delete deferred; retention/pipeline not server-persisted — all encoded in code + constraints, not silently dropped.
