# Web Version — Phase 2c-12: Web Members — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `listMembers`/`setMemberRole`/`revokeMember`/`discordMembers` (direct `workspace_members` table ops + axitools `discordOverview`), replacing the `notImplemented` stubs so the members panel + Discord member list work.

**Architecture:** New `members.ts` module + wiring in `webClient.ts`.

**Tech Stack:** TypeScript, React renderer, Vitest, `@supabase/supabase-js`. No new deps.

## Global Constraints

- Confined to `src/renderer/src/lib/webClient/` (one new module + tests + edits to `webClient.ts`/`webClient.test.ts`). Do NOT touch `src/main`/`src/shared`/`src/preload`/other-renderer/contract.
- `createWebClient` stays conformant; only the four named methods change from `ni(...)`.
- `listMembers`/`discordMembers` NEVER throw (catch → `[]`); `setMemberRole`/`revokeMember` return `void` and no-op on no-workspace/no-supabase. `setMemberRole` accepts only `'write'`/`'read'`.
- Renderer→preload via `../../../../preload/index.d`; renderer→shared via `../../../../shared/…`; reuse `activeWorkspaceId`/`invokeAxitools` from `./discordGw2`.
- Run vitest `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` green.

---

### Task 1: `members.ts` + wiring

**Files:**
- Create: `src/renderer/src/lib/webClient/members.ts`, `.../members.test.ts`
- Modify: `src/renderer/src/lib/webClient/webClient.ts` (+ `webClient.test.ts`)

**Interfaces:**
- Consumes: `SupabaseClient`; `WorkspaceMember`/`DiscordRosterMember` (`../../../../preload/index.d`); `WebSettings` (`./settings`); `activeWorkspaceId`/`invokeAxitools` (`./discordGw2`); `asDiscordMembers` (`../../../../shared/roster/adapters`).
- Produces: `webListMembers`, `webSetMemberRole`, `webRevokeMember`, `webDiscordMembers`.

- [ ] **Step 1: Write the failing test**

`src/renderer/src/lib/webClient/members.test.ts`:
```ts
import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { webListMembers, webSetMemberRole, webRevokeMember, webDiscordMembers } from './members'
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

// chainable builder: select/eq chain (+ thenable {data}); update/delete are spies
// returning a chainable whose terminal .eq resolves. `single` for maybeSingle.
function builder(cfg: { rows?: unknown; single?: unknown }) {
  const update = vi.fn(() => b)
  const del = vi.fn(() => b)
  const b: Record<string, unknown> = {}
  Object.assign(b, {
    select: () => b,
    eq: () => b,
    update,
    delete: del,
    maybeSingle: async () => ({ data: cfg.single ?? null }),
    then: (res: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: cfg.rows ?? [], error: null }).then(res)
  })
  return b as Record<string, unknown> & { update: typeof update; delete: typeof del }
}

function fakeSb(builders: Record<string, ReturnType<typeof builder>>, invoke?: ReturnType<typeof vi.fn>): SupabaseClient {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => builders[t],
    functions: { invoke: invoke ?? vi.fn(async () => ({ data: { data: {} }, error: null })) }
  } as unknown as SupabaseClient
}

const members = () => builder({ rows: [{ workspace_id: 'w1', role: 'owner' }] })

test('webListMembers maps workspace_members rows', async () => {
  const wm = builder({
    rows: [{ user_id: 'u2', discord_id: 'd2', discord_username: 'bob', discord_global_name: 'Bob', role: 'write' }]
  })
  // workspace_members is used by BOTH activeWorkspaceId and the listing; give it the membership rows
  const wmForActive = builder({ rows: [{ workspace_id: 'w1', role: 'owner' }] })
  // route: first from('workspace_members') call (activeWorkspaceId) -> wmForActive; but our fake returns one builder per table.
  // Simplify: make workspace_members return the LISTING rows AND include workspace_id so activeWorkspaceId picks w1.
  const wm2 = builder({
    rows: [
      { workspace_id: 'w1', role: 'owner', user_id: 'u2', discord_id: 'd2', discord_username: 'bob', discord_global_name: 'Bob' }
    ]
  })
  const r = await webListMembers(fakeSb({ workspace_members: wm2 }), createWebSettings(fakeStorage()))
  expect(r).toEqual([
    { userId: 'u2', discordId: 'd2', discordName: 'bob', discordGlobalName: 'Bob', role: 'owner' }
  ])
})

test('webSetMemberRole updates only for write/read; ignores other roles', async () => {
  const wm = members()
  await webSetMemberRole(fakeSb({ workspace_members: wm }), createWebSettings(fakeStorage()), 'u2', 'write')
  expect(wm.update).toHaveBeenCalledWith({ role: 'write' })
  const wm2 = members()
  await webSetMemberRole(fakeSb({ workspace_members: wm2 }), createWebSettings(fakeStorage()), 'u2', 'owner')
  expect(wm2.update).not.toHaveBeenCalled()
})

test('webRevokeMember deletes the membership', async () => {
  const wm = members()
  await webRevokeMember(fakeSb({ workspace_members: wm }), createWebSettings(fakeStorage()), 'u2')
  expect(wm.delete).toHaveBeenCalled()
})

test('webDiscordMembers returns non-bot mapped members', async () => {
  const invoke = vi.fn(async () => ({
    data: { data: { members: [{ id: 'm1', name: 'a', display_name: 'A' }, { id: 'b1', name: 'bot', bot: true }] } },
    error: null
  }))
  const sb = fakeSb(
    { workspace_members: members(), workspaces: builder({ single: { discord_guild_id: 'd1' } }) },
    invoke
  )
  const r = await webDiscordMembers(sb, createWebSettings(fakeStorage()))
  expect(r).toEqual([{ id: 'm1', name: 'a', displayName: 'A' }])
})

test('webDiscordMembers with no discord guild returns []', async () => {
  const sb = fakeSb({ workspace_members: members(), workspaces: builder({ single: { discord_guild_id: '' } }) })
  expect(await webDiscordMembers(sb, createWebSettings(fakeStorage()))).toEqual([])
})
```

- [ ] **Step 2: Run — expect FAIL (missing module)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/members.test.ts`
Expected: FAIL — cannot find `./members`.

- [ ] **Step 3: Implement `members.ts`**

```ts
// src/renderer/src/lib/webClient/members.ts
// Web workspace-member management: list/setRole/revoke against workspace_members
// (role changes are owner-gated by RLS), plus the Discord member list via the
// axitools function. Mirrors the desktop members:* / discord:members handlers.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkspaceMember, DiscordRosterMember } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { activeWorkspaceId, invokeAxitools } from './discordGw2'
import { asDiscordMembers } from '../../../../shared/roster/adapters'

export async function webListMembers(sb: SupabaseClient, settings: WebSettings): Promise<WorkspaceMember[]> {
  try {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) return []
    const { data } = await sb
      .from('workspace_members')
      .select('user_id, discord_id, discord_username, discord_global_name, role')
      .eq('workspace_id', ws)
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      userId: String(r.user_id),
      discordId: r.discord_id != null ? String(r.discord_id) : '',
      discordName: r.discord_username != null ? String(r.discord_username) : '',
      discordGlobalName: r.discord_global_name != null ? String(r.discord_global_name) : '',
      role: String(r.role)
    }))
  } catch {
    return []
  }
}

export async function webSetMemberRole(
  sb: SupabaseClient,
  settings: WebSettings,
  userId: string,
  role: string
): Promise<void> {
  if (role !== 'write' && role !== 'read') return
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  await sb.from('workspace_members').update({ role }).eq('workspace_id', ws).eq('user_id', userId)
}

export async function webRevokeMember(
  sb: SupabaseClient,
  settings: WebSettings,
  userId: string
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  await sb.from('workspace_members').delete().eq('workspace_id', ws).eq('user_id', userId)
}

export async function webDiscordMembers(
  sb: SupabaseClient,
  settings: WebSettings
): Promise<DiscordRosterMember[]> {
  try {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) return []
    const { data: wsRow } = await sb
      .from('workspaces')
      .select('discord_guild_id')
      .eq('workspace_id', ws)
      .maybeSingle()
    const discordGuildId = (wsRow as { discord_guild_id?: string } | null)?.discord_guild_id
    if (!discordGuildId) return []
    const r = await invokeAxitools(sb, {
      op: 'discordOverview',
      workspaceId: ws,
      guildId: discordGuildId,
      includeMembers: true
    })
    if (!r.ok) return []
    return asDiscordMembers(r.data)
      .filter((m) => !m.bot)
      .map((m) => ({ id: m.id, name: m.name ?? m.id, displayName: m.display_name ?? m.name ?? m.id }))
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run — expect PASS (5 tests)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/members.test.ts`
Expected: PASS. (Adjust the `builder` fake if a chain method is missing — not the module.)

- [ ] **Step 5: Wire in `webClient.ts`**

1. Add import: `import { webListMembers, webSetMemberRole, webRevokeMember, webDiscordMembers } from './members'`.
2. Replace the stubs:
   ```ts
   listMembers: async () => (deps.supabase ? webListMembers(deps.supabase, settings) : []),
   setMemberRole: async (userId, role) => {
     if (deps.supabase) await webSetMemberRole(deps.supabase, settings, userId, role)
   },
   revokeMember: async (userId) => {
     if (deps.supabase) await webRevokeMember(deps.supabase, settings, userId)
   },
   discordMembers: async () => (deps.supabase ? webDiscordMembers(deps.supabase, settings) : []),
   ```
   Leave every other `ni(...)` method unchanged.

- [ ] **Step 6: Add `webClient.test.ts` smoke**

```ts
test('members methods are empty/no-op without supabase', async () => {
  const c = createWebClient({ storage: fakeStorage() })
  expect(await c.listMembers()).toEqual([])
  expect(await c.discordMembers()).toEqual([])
  await expect(c.revokeMember('u2')).resolves.toBeUndefined()
})
```

- [ ] **Step 7: Run web-client suite + full suite + typecheck**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/`
Expected: PASS. Run: `npm test` → all pass. Run: `npm run typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/lib/webClient
git commit -m "feat(web): members — list/setRole/revoke + discordMembers"
```

---

## Self-Review Notes

- **Spec coverage:** `webListMembers` (workspace_members → WorkspaceMember, never-throws), `webSetMemberRole` (write/read only, RLS-gated update), `webRevokeMember` (delete), `webDiscordMembers` (workspace discord_guild_id → axitools discordOverview → shared `asDiscordMembers` → filter bots → DiscordRosterMember, never-throws) (Step 3); wired with no-supabase guards (Step 5); tests for mapping, role-gating, delete, bot-filtering, no-guild empty, no-supabase smoke (Steps 1, 6). Other methods stay `ni(...)`; `src/main`/`src/shared`/`src/preload` untouched.
- **Type consistency:** returns `WorkspaceMember[]`/`void`/`void`/`DiscordRosterMember[]` matching `AxiRosterApi`; column mapping (`discord_username`→`discordName`, `discord_global_name`→`discordGlobalName`) matches the desktop handler.
- **Reuse:** `asDiscordMembers` from shared (relocated 2c-2); `invokeAxitools`/`activeWorkspaceId` from `./discordGw2`.
