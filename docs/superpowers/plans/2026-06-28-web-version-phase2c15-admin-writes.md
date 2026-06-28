# Web Version — Phase 2c-15: Web Admin Writes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the last 9 `notImplemented` methods (invites + adoptSharedKeys + logRetention, plus honest desktop-only defaults for claimGuild/upsertGuild/removeGuild), taking the web `AxiClient` to ZERO stubs.

**Architecture:** New `admin.ts` module + wiring in `webClient.ts` (replacing the final `ni(...)` stubs and removing the now-unused `ni` helper).

**Tech Stack:** TypeScript, React renderer, Vitest, `@supabase/supabase-js`. No new deps.

## Global Constraints

- Confined to `src/renderer/src/lib/webClient/` (one new module + tests + edits to `webClient.ts`/`webClient.test.ts`). Do NOT touch `src/main`/`src/shared`/`src/preload`/other-renderer/contract.
- After this, `createWebClient` has NO `ni(...)` stubs — every `AxiClient` method is real. Remove the now-unused `ni` helper + the `notImplemented` import from `webClient.ts` (keep `notImplemented.ts` + its test). `createWebClient` stays conformant; typecheck (incl. no-unused) green.
- The clean reads never throw (`pendingSentInvites`→`[]`, `createInvite` catch→`{error}`, `logRetention` best-effort). `claimGuild`→`{ok:false,error}`; `upsertGuild`→`null`; `removeGuild`/`adoptSharedKeys` honest no-ops.
- Renderer→preload via `../../../../preload/index.d`; reuse `activeWorkspaceId` from `./discordGw2`. `crypto.getRandomValues` (browser + node).
- Run vitest `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` green.

---

### Task 1: `admin.ts` + wiring + stub cleanup

**Files:**
- Create: `src/renderer/src/lib/webClient/admin.ts`, `.../admin.test.ts`
- Modify: `src/renderer/src/lib/webClient/webClient.ts` (+ `webClient.test.ts`)

- [ ] **Step 1: Write the failing test**

`src/renderer/src/lib/webClient/admin.test.ts`:
```ts
import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  webCreateInvite,
  webRedeemInvite,
  webPendingSentInvites,
  webRevokeInvite,
  webAdoptSharedKeys,
  webClaimGuild,
  webUpsertGuild,
  webRemoveGuild,
  webLogRetention
} from './admin'
import { createWebSettings } from './settings'

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

// builder supporting insert().select().single(), select().eq().is().order() (thenable),
// delete().eq().eq() (thenable), upsert(). Records insert/upsert/delete payloads.
function fakeSb(opts: { rows?: unknown[]; invoke?: ReturnType<typeof vi.fn>; insertCode?: string } = {}) {
  const rec: { insert?: Record<string, unknown>; upsert?: unknown; deleted?: boolean } = {}
  const invitesBuilder = () => {
    const b: Record<string, unknown> = {}
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      is: () => b,
      order: () => b,
      insert: (row: Record<string, unknown>) => {
        rec.insert = row
        return { select: () => ({ single: async () => ({ data: { code: opts.insertCode ?? 'CODE1234' } }) }) }
      },
      upsert: async (rows: unknown) => {
        rec.upsert = rows
        return { error: null }
      },
      delete: () => ({ eq: () => ({ eq: async () => { rec.deleted = true; return { error: null } } }) }),
      then: (res: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: opts.rows ?? [], error: null }).then(res)
    })
    return b
  }
  const sb = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) =>
      t === 'workspace_members'
        ? { select: () => ({ eq: () => Promise.resolve({ data: [{ workspace_id: 'w1', role: 'owner' }] }) }) }
        : invitesBuilder(),
    functions: { invoke: opts.invoke ?? vi.fn(async () => ({ data: {}, error: null })) }
  } as unknown as SupabaseClient
  return { sb, rec }
}

test('createInvite inserts a write/read invite and returns the code', async () => {
  const { sb, rec } = fakeSb({ insertCode: 'ABCD1234' })
  const r = await webCreateInvite(sb, settings(), { role: 'write', discordId: 'd9' })
  expect(r).toEqual({ code: 'ABCD1234' })
  expect(rec.insert).toMatchObject({ workspace_id: 'w1', role: 'write', discord_id: 'd9', created_by: 'u1' })
})

test('createInvite rejects an invalid role', async () => {
  const { sb } = fakeSb()
  expect(await webCreateInvite(sb, settings(), { role: 'owner' })).toEqual({ error: 'invalid_role' })
})

test('redeemInvite invokes redeem-invite and maps the result', async () => {
  const invoke = vi.fn(async () => ({ data: { workspaceId: 'w1', role: 'write' }, error: null }))
  const { sb } = fakeSb({ invoke })
  expect(await webRedeemInvite(sb, '  CODE  ')).toEqual({ ok: true, workspaceId: 'w1', role: 'write' })
  expect(invoke).toHaveBeenCalledWith('redeem-invite', { body: { code: 'CODE' } })
  expect((await webRedeemInvite(sb, '')).ok).toBe(false)
})

test('pendingSentInvites maps rows to SentInvite', async () => {
  const { sb } = fakeSb({ rows: [{ id: 'i1', discord_id: 'd1', code: null, role: 'read', created_at: 't' }] })
  expect(await webPendingSentInvites(sb, settings())).toEqual([
    { id: 'i1', discordId: 'd1', code: null, role: 'read' }
  ])
})

test('revokeInvite deletes and returns ok', async () => {
  const { sb, rec } = fakeSb()
  expect(await webRevokeInvite(sb, settings(), 'i1')).toEqual({ ok: true })
  expect(rec.deleted).toBe(true)
})

test('adopt/claim/upsert/remove return honest web defaults', async () => {
  expect(await webAdoptSharedKeys()).toEqual({ adopted: false })
  expect((await webClaimGuild()).ok).toBe(false)
  expect(await webUpsertGuild({} as never)).toBeNull()
  await expect(webRemoveGuild('w1')).resolves.toBeUndefined()
})

test('logRetention upserts mapped retention rows', async () => {
  const { sb, rec } = fakeSb()
  await webLogRetention(sb, settings(), [{ date: '2026-06-20', memberKey: 'A', score: 0.5, tier: 't1' }])
  expect(rec.upsert).toEqual([{ workspace_id: 'w1', date: '2026-06-20', member_key: 'A', score: 0.5, tier: 't1' }])
})
```

- [ ] **Step 2: Run — expect FAIL (missing module)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/admin.test.ts`
Expected: FAIL — cannot find `./admin`.

- [ ] **Step 3: Implement `admin.ts`**

```ts
// src/renderer/src/lib/webClient/admin.ts
// The remaining web write methods: invite create/redeem/list-sent/revoke
// (workspace_invites + redeem-invite fn), retention logging (retention_snapshots),
// and honest "desktop-only" defaults for the guild-claim/add/remove flows that
// require a local GW2 leader key the browser doesn't hold.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { InviteResult, SentInvite, ClaimGuildResult, GuildProfileInput, GuildSummary } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { activeWorkspaceId } from './discordGw2'

function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}

export async function webCreateInvite(
  sb: SupabaseClient,
  settings: WebSettings,
  payload: { discordId?: string; code?: string; role?: string }
): Promise<InviteResult> {
  try {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) return {}
    if (payload.role !== 'write' && payload.role !== 'read') return { error: 'invalid_role' }
    const {
      data: { user }
    } = await sb.auth.getUser()
    const row: Record<string, unknown> = { workspace_id: ws, created_by: user?.id ?? null, role: payload.role }
    if (payload.discordId) row.discord_id = payload.discordId
    else row.code = payload.code || generateInviteCode()
    const { data } = await sb.from('workspace_invites').insert(row).select('code').single()
    return { code: (data as { code?: string } | null)?.code }
  } catch {
    return { error: 'failed' }
  }
}

export async function webRedeemInvite(
  sb: SupabaseClient,
  code: string
): Promise<{ ok: boolean; error?: string; role?: string; workspaceId?: string }> {
  const trimmed = (code ?? '').trim()
  if (!trimmed) return { ok: false, error: 'Enter an invite code' }
  try {
    const { data, error } = await sb.functions.invoke('redeem-invite', { body: { code: trimmed } })
    const r = (data ?? {}) as { error?: string; workspaceId?: string; role?: string }
    if (error || r.error)
      return { ok: false, error: r.error ?? (error as { message?: string } | null)?.message ?? 'Could not redeem' }
    return { ok: true, workspaceId: r.workspaceId, role: r.role }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function webPendingSentInvites(sb: SupabaseClient, settings: WebSettings): Promise<SentInvite[]> {
  try {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) return []
    const { data } = await sb
      .from('workspace_invites')
      .select('id, discord_id, code, role, created_at')
      .eq('workspace_id', ws)
      .is('redeemed_by', null)
      .order('created_at', { ascending: true })
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      discordId: r.discord_id != null ? String(r.discord_id) : null,
      code: r.code != null ? String(r.code) : null,
      role: String(r.role)
    }))
  } catch {
    return []
  }
}

export async function webRevokeInvite(
  sb: SupabaseClient,
  settings: WebSettings,
  inviteId: string
): Promise<{ ok: boolean }> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return { ok: false }
  const { error } = await sb.from('workspace_invites').delete().eq('id', inviteId).eq('workspace_id', ws)
  return { ok: !error }
}

export async function webAdoptSharedKeys(): Promise<{ adopted: boolean }> {
  // On web the member already uses the workspace's shared keys server-side (Edge
  // Functions); there is no local guild profile to adopt.
  return { adopted: false }
}

export async function webClaimGuild(): Promise<ClaimGuildResult> {
  return { ok: false, error: 'Claiming a guild needs the desktop app (it uses your GW2 leader API key).' }
}

export async function webUpsertGuild(_input: GuildProfileInput): Promise<GuildSummary | null> {
  // Adding/editing a guild profile is a desktop/owner-with-keys flow; on web you
  // join a workspace via invite or claim.
  return null
}

export async function webRemoveGuild(_id: string): Promise<void> {
  // no-op on web
}

export async function webLogRetention(
  sb: SupabaseClient,
  settings: WebSettings,
  snapshots: { date: string; memberKey: string; score: number; tier: string }[]
): Promise<void> {
  try {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws || !Array.isArray(snapshots) || snapshots.length === 0) return
    const rows = snapshots.map((s) => ({
      workspace_id: ws,
      date: s.date,
      member_key: s.memberKey,
      score: s.score,
      tier: s.tier
    }))
    await sb.from('retention_snapshots').upsert(rows, { onConflict: 'workspace_id,date,member_key' })
  } catch {
    /* best-effort */
  }
}
```

- [ ] **Step 4: Run — expect PASS (7 tests)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/admin.test.ts`
Expected: PASS. (Adjust the fake if a chain is missing — not the module.)

- [ ] **Step 5: Wire in `webClient.ts` + remove the stub plumbing**

1. Add import: `import { webCreateInvite, webRedeemInvite, webPendingSentInvites, webRevokeInvite, webAdoptSharedKeys, webClaimGuild, webUpsertGuild, webRemoveGuild, webLogRetention } from './admin'`.
2. Replace the nine remaining `ni(...)` stubs:
   ```ts
   createInvite: async (payload) => (deps.supabase ? webCreateInvite(deps.supabase, settings, payload) : {}),
   redeemInvite: async (code) => (deps.supabase ? webRedeemInvite(deps.supabase, code) : { ok: false, error: 'Not signed in' }),
   pendingSentInvites: async () => (deps.supabase ? webPendingSentInvites(deps.supabase, settings) : []),
   revokeInvite: async (inviteId) => (deps.supabase ? webRevokeInvite(deps.supabase, settings, inviteId) : { ok: false }),
   adoptSharedKeys: async () => webAdoptSharedKeys(),
   claimGuild: async () => webClaimGuild(),
   upsertGuild: async (input) => webUpsertGuild(input),
   removeGuild: async (id) => webRemoveGuild(id),
   logRetention: async (snapshots) => {
     if (deps.supabase) await webLogRetention(deps.supabase, settings, snapshots)
   },
   ```
3. There should now be NO `ni(...)` calls left in `webClient.ts`. Remove the now-unused `ni` helper definition and the `notImplemented` import (keep the `notImplemented.ts` module + its test). Verify with `grep -n "\bni(" src/renderer/src/lib/webClient/webClient.ts` → no matches.

- [ ] **Step 6: Update `webClient.test.ts`**

The conformance test that asserts a stub throws "not implemented" (using `upsertGuild`) is now invalid — `upsertGuild` returns `null`. REMOVE that test (or repoint it: assert `await c.upsertGuild({} as never)` resolves `null`). Add a smoke:
```ts
test('admin write methods return safe values without supabase', async () => {
  const c = createWebClient({ storage: fakeStorage() })
  expect(await c.createInvite({ role: 'write' })).toEqual({})
  expect(await c.pendingSentInvites()).toEqual([])
  expect(await c.upsertGuild({} as never)).toBeNull()
  expect((await c.claimGuild()).ok).toBe(false)
})
```

- [ ] **Step 7: Run web-client suite + full suite + typecheck**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/`
Expected: PASS. Run: `npm test` → all pass. Run: `npm run typecheck` → clean (no unused `ni`/`notImplemented`). Run: `npm run build:web` → succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/lib/webClient
git commit -m "feat(web): admin writes (invites/adopt/retention) + desktop-only guild stubs — zero notImplemented left"
```

---

## Self-Review Notes

- **Spec coverage:** invites create/redeem/list-sent/revoke (workspace_invites + redeem-invite fn), `adoptSharedKeys`/`claimGuild`/`upsertGuild`/`removeGuild` honest defaults, `logRetention` (retention_snapshots upsert) (Step 3); wired + the last `ni(...)` stubs removed (Step 5); the conformance "throws" test removed/repointed (Step 6); tests for each (Step 1). `src/main`/`src/shared`/`src/preload` untouched.
- **Zero stubs:** after Step 5, `createWebClient` implements every `AxiClient` method for real; `ni`/`notImplemented` import removed from `webClient.ts`.
- **Type consistency:** returns match the contract (`InviteResult`/`{ok;error?;role?;workspaceId?}`/`SentInvite[]`/`{ok}`/`{adopted}`/`ClaimGuildResult`/`GuildSummary|null`/`void`/`void`). `createInvite` role-gate + insert mirror the desktop handler; `pendingSentInvites`/`revokeInvite` mirror their handlers; `logRetention` uses the Phase-0 `retention_snapshots` shape.
- **Flagged divergence:** claim/upsert/remove guild are honest desktop-only placeholders (browser has no local GW2 leader key); the web add-guild/claim UX is a deferred product decision.
