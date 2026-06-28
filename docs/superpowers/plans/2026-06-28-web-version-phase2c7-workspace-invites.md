# Web Version — Phase 2c-7: Web Workspace + Invites Methods — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `listGuilds`, `getGuild`, `setActiveGuild`, `listWorkspaceRoles`, `listInvites`, `respondInvite` for the web client (mapping the desktop guild model to Supabase workspaces), replacing their `notImplemented` stubs so the App shell loads cleanly. They degrade to empty/no-op instead of throwing.

**Architecture:** A new `workspace.ts` module + wiring in `webClient.ts`. Reads `workspace_members`/`workspaces` directly; invites go through the `list-invites`/`respond-invite` Edge Functions.

**Tech Stack:** TypeScript, React renderer, Vitest, `@supabase/supabase-js`. No new dependencies.

## Global Constraints

- Confined to `src/renderer/src/lib/webClient/` (one new module + tests + edits to `webClient.ts`/`webClient.test.ts`). Do NOT touch `src/main`/`src/shared`/`src/preload`/other-renderer/contract.
- `createWebClient` stays a conformant `AxiClient`; only the six named methods change from `ni(...)`.
- These methods return their desktop shapes directly (NOT `Result`): `GuildSummary[]` / `GuildProfile | null` / `void` / `Record<string,string>` / `PendingInvite[]` / `{ ok; error?; workspaceId? }`. The Supabase-backed reads **never throw** — they catch into the empty value (`[]`/`{}`/`null`) so the shell is robust; `respondInvite` returns `{ ok:false, error }` on failure / no client.
- Renderer→preload import via `../../../../preload/index.d`.
- Node test env: fake `SupabaseClient`. Tests: Vitest `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` green.

---

### Task 1: `workspace.ts` (workspace + invites methods) + wiring

**Files:**
- Create: `src/renderer/src/lib/webClient/workspace.ts`, `.../workspace.test.ts`
- Modify: `src/renderer/src/lib/webClient/webClient.ts` (+ `webClient.test.ts`)

**Interfaces:**
- Consumes: `SupabaseClient`; `GuildSummary`/`GuildProfile`/`PendingInvite` (`../../../../preload/index.d`); `WebSettings` (`./settings`).
- Produces: `webListGuilds`, `webGetGuild`, `webSetActiveGuild`, `webListWorkspaceRoles`, `webListInvites`, `webRespondInvite`.

- [ ] **Step 1: Write the failing test**

`src/renderer/src/lib/webClient/workspace.test.ts`:
```ts
import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  webListGuilds,
  webGetGuild,
  webSetActiveGuild,
  webListWorkspaceRoles,
  webListInvites,
  webRespondInvite
} from './workspace'
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

// thenable resolving { data } that also supports .maybeSingle()
function res(data: unknown) {
  const p = Promise.resolve({ data }) as Promise<{ data: unknown }> & {
    maybeSingle: () => Promise<{ data: unknown }>
  }
  p.maybeSingle = () => Promise.resolve({ data: Array.isArray(data) ? (data[0] ?? null) : data })
  return p
}

const WS = {
  workspace_id: 'w1',
  guild_name: 'My Guild',
  discord_guild_id: 'd1',
  discord_guild_name: 'Disc',
  member_role_id: 'role1',
  bridge_repos: [],
  keys_shared: true
}

function fakeSb(opts: {
  userId?: string | null
  memberships?: { workspace_id: string; role: string }[]
  workspaces?: Record<string, unknown>[]
  invoke?: ReturnType<typeof vi.fn>
}): SupabaseClient {
  return {
    auth: { getUser: async () => ({ data: { user: opts.userId === null ? null : { id: opts.userId ?? 'u1' } } }) },
    from: (t: string) => ({
      select: () => ({
        eq: () => res(t === 'workspace_members' ? (opts.memberships ?? []) : (opts.workspaces ?? [])),
        in: () => res(opts.workspaces ?? [])
      })
    }),
    functions: { invoke: opts.invoke ?? vi.fn(async () => ({ data: {}, error: null })) }
  } as unknown as SupabaseClient
}

test('webListGuilds maps memberships+workspaces to GuildSummary, marking the active one', async () => {
  const settings = createWebSettings(fakeStorage())
  settings.set('activeGuildId', 'w1')
  const sb = fakeSb({ memberships: [{ workspace_id: 'w1', role: 'owner' }], workspaces: [WS] })
  const guilds = await webListGuilds(sb, settings)
  expect(guilds).toHaveLength(1)
  expect(guilds[0]).toMatchObject({
    id: 'w1',
    name: 'My Guild',
    active: true,
    gw2GuildId: 'w1',
    discordGuildId: 'd1',
    hasGw2Key: false,
    hasAxitoolsKey: true,
    axitoolsShared: true,
    shared: true,
    pipelineEnabled: true
  })
})

test('webListGuilds with no user returns []', async () => {
  expect(await webListGuilds(fakeSb({ userId: null }), createWebSettings(fakeStorage()))).toEqual([])
})

test('webListWorkspaceRoles returns the role map', async () => {
  const sb = fakeSb({ memberships: [{ workspace_id: 'w1', role: 'owner' }, { workspace_id: 'w2', role: 'write' }] })
  expect(await webListWorkspaceRoles(sb)).toEqual({ w1: 'owner', w2: 'write' })
})

test('webSetActiveGuild writes the setting', async () => {
  const store = fakeStorage()
  await webSetActiveGuild(createWebSettings(store), 'w9')
  expect(store.getItem('axiroster:setting:activeGuildId')).toBe('w9')
})

test('webGetGuild maps a workspace row to a GuildProfile (empty keys)', async () => {
  const g = await webGetGuild(fakeSb({ workspaces: [WS] }), 'w1')
  expect(g).toMatchObject({ id: 'w1', gw2ApiKey: '', axitoolsKey: '', gw2GuildId: 'w1', discordGuildId: 'd1' })
})

test('webListInvites returns the function invites; error -> []', async () => {
  const ok = fakeSb({ invoke: vi.fn(async () => ({ data: { invites: [{ id: 'i1', workspaceId: 'w1', role: 'write', guildName: 'G' }] }, error: null })) })
  expect(await webListInvites(ok)).toEqual([{ id: 'i1', workspaceId: 'w1', role: 'write', guildName: 'G' }])
  const bad = fakeSb({ invoke: vi.fn(async () => ({ data: null, error: { message: 'x' } })) })
  expect(await webListInvites(bad)).toEqual([])
})

test('webRespondInvite invokes respond-invite with inviteId+action', async () => {
  const invoke = vi.fn(async () => ({ data: { ok: true, workspaceId: 'w1' }, error: null }))
  const r = await webRespondInvite(fakeSb({ invoke }), 'i1', 'accept')
  expect(invoke).toHaveBeenCalledWith('respond-invite', { body: { inviteId: 'i1', action: 'accept' } })
  expect(r).toEqual({ ok: true, workspaceId: 'w1' })
})
```

- [ ] **Step 2: Run — expect FAIL (missing module)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/workspace.test.ts`
Expected: FAIL — cannot find `./workspace`.

- [ ] **Step 3: Implement `workspace.ts`**

```ts
// src/renderer/src/lib/webClient/workspace.ts
// Web "guild" methods mapped to the Supabase workspace model: a guild is a
// workspace the user is a member of (workspace_members -> workspaces). Secrets
// aren't readable on web, so key fields map to ''. The reads degrade to empty
// values instead of throwing, so the App shell stays robust.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GuildSummary, GuildProfile, PendingInvite } from '../../../../preload/index.d'
import type { WebSettings } from './settings'

interface Membership {
  workspace_id: string
  role: string
}

async function userId(sb: SupabaseClient): Promise<string | null> {
  const {
    data: { user }
  } = await sb.auth.getUser()
  return user?.id ?? null
}

async function getMemberships(sb: SupabaseClient, uid: string): Promise<Membership[]> {
  const { data } = await sb.from('workspace_members').select('workspace_id, role').eq('user_id', uid)
  return (data ?? []) as Membership[]
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '')

function wsRowToSummary(row: Record<string, unknown>, activeId: string): GuildSummary {
  const id = s(row.workspace_id)
  return {
    id,
    name: s(row.guild_name) || 'Guild',
    active: id === activeId,
    gw2GuildName: s(row.guild_name),
    gw2GuildId: id,
    gw2AccountName: '',
    hasGw2Key: false,
    discordGuildName: s(row.discord_guild_name),
    discordGuildId: s(row.discord_guild_id),
    hasAxitoolsKey: Boolean(row.discord_guild_id),
    memberRoleId: s(row.member_role_id),
    bridgeRepos: Array.isArray(row.bridge_repos) ? (row.bridge_repos as GuildSummary['bridgeRepos']) : [],
    shared: true,
    axitoolsShared: Boolean(row.keys_shared),
    retentionEnabled: false,
    pipelineEnabled: true
  }
}

function wsRowToProfile(row: Record<string, unknown>): GuildProfile {
  const id = s(row.workspace_id)
  return {
    id,
    name: s(row.guild_name) || 'Guild',
    gw2ApiKey: '',
    gw2GuildId: id,
    gw2GuildName: s(row.guild_name),
    gw2AccountName: '',
    axitoolsKey: '',
    discordGuildId: s(row.discord_guild_id),
    discordGuildName: s(row.discord_guild_name),
    memberRoleId: s(row.member_role_id),
    bridgeRepos: Array.isArray(row.bridge_repos) ? (row.bridge_repos as GuildProfile['bridgeRepos']) : [],
    shared: true,
    axitoolsShared: Boolean(row.keys_shared),
    retentionEnabled: false,
    pipelineEnabled: true
  }
}

export async function webListGuilds(sb: SupabaseClient, settings: WebSettings): Promise<GuildSummary[]> {
  try {
    const uid = await userId(sb)
    if (!uid) return []
    const members = await getMemberships(sb, uid)
    if (members.length === 0) return []
    const ids = members.map((m) => m.workspace_id)
    const { data } = await sb.from('workspaces').select('*').in('workspace_id', ids)
    const rows = (data ?? []) as Record<string, unknown>[]
    const activeId = settings.get('activeGuildId') || ids[0]
    return rows.map((row) => wsRowToSummary(row, activeId))
  } catch {
    return []
  }
}

export async function webGetGuild(sb: SupabaseClient, id: string): Promise<GuildProfile | null> {
  try {
    const { data } = await sb.from('workspaces').select('*').eq('workspace_id', id).maybeSingle()
    return data ? wsRowToProfile(data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function webSetActiveGuild(settings: WebSettings, id: string): Promise<void> {
  settings.set('activeGuildId', id)
}

export async function webListWorkspaceRoles(sb: SupabaseClient): Promise<Record<string, string>> {
  try {
    const uid = await userId(sb)
    if (!uid) return {}
    const out: Record<string, string> = {}
    for (const m of await getMemberships(sb, uid)) out[m.workspace_id] = m.role
    return out
  } catch {
    return {}
  }
}

export async function webListInvites(sb: SupabaseClient): Promise<PendingInvite[]> {
  try {
    const { data, error } = await sb.functions.invoke('list-invites', { body: {} })
    if (error) return []
    return ((data as { invites?: PendingInvite[] } | null)?.invites ?? []) as PendingInvite[]
  } catch {
    return []
  }
}

export async function webRespondInvite(
  sb: SupabaseClient,
  inviteId: string,
  action: 'accept' | 'reject'
): Promise<{ ok: boolean; error?: string; workspaceId?: string }> {
  const { data, error } = await sb.functions.invoke('respond-invite', { body: { inviteId, action } })
  if (error) return { ok: false, error: (error as { message?: string }).message ?? 'request failed' }
  const d = (data ?? {}) as { ok?: boolean; workspaceId?: string }
  return { ok: d.ok ?? true, workspaceId: d.workspaceId }
}
```

- [ ] **Step 4: Run — expect PASS (7 tests)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/workspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the six methods in `webClient.ts`**

1. Add import: `import { webListGuilds, webGetGuild, webSetActiveGuild, webListWorkspaceRoles, webListInvites, webRespondInvite } from './workspace'`.
2. Replace the six `ni(...)` stubs:
   ```ts
   listGuilds: async () => (deps.supabase ? webListGuilds(deps.supabase, settings) : []),
   getGuild: async (id) => (deps.supabase ? webGetGuild(deps.supabase, id) : null),
   setActiveGuild: async (id) => webSetActiveGuild(settings, id),
   listWorkspaceRoles: async () => (deps.supabase ? webListWorkspaceRoles(deps.supabase) : {}),
   listInvites: async () => (deps.supabase ? webListInvites(deps.supabase) : []),
   respondInvite: async (inviteId, action) =>
     deps.supabase ? webRespondInvite(deps.supabase, inviteId, action) : { ok: false, error: 'Supabase client not configured' },
   ```
   Leave every other `ni(...)` method unchanged.

- [ ] **Step 6: Add `webClient.test.ts` smoke cases**

```ts
test('workspace read methods return empty (no throw) without supabase', async () => {
  const c = createWebClient({ storage: fakeStorage() })
  expect(await c.listGuilds()).toEqual([])
  expect(await c.listWorkspaceRoles()).toEqual({})
  expect(await c.listInvites()).toEqual([])
  expect(await c.getGuild('w1')).toBeNull()
})
```

- [ ] **Step 7: Run web-client suite + full suite + typecheck**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/`
Expected: PASS.

Run: `npm test` → all pass. Run: `npm run typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/lib/webClient
git commit -m "feat(web): workspace + invites methods (listGuilds/getGuild/setActiveGuild/roles/invites)"
```

---

## Self-Review Notes

- **Spec coverage:** `webListGuilds`/`webGetGuild`/`webSetActiveGuild`/`webListWorkspaceRoles`/`webListInvites`/`webRespondInvite` (Step 3); wired in `webClient.ts` with no-supabase empty-value guards (Step 5); tests cover the summary mapping + active flag, no-user empties, the role map, settings write, profile mapping, invites pass-through + error→[], and respond-invite shape (Step 1). Other data methods stay `ni(...)`; `src/main`/`src/shared`/`src/preload` untouched.
- **Shell-robust:** the mount-called reads (`listGuilds`/`listWorkspaceRoles`/`listInvites`) catch into `[]`/`{}` and the no-supabase wiring returns empties — no uncaught throw can break `App` mount.
- **Type consistency:** returns match `AxiRosterApi` (`GuildSummary[]`/`GuildProfile|null`/`void`/`Record<string,string>`/`PendingInvite[]`/`{ok;error?;workspaceId?}`). `GuildSummary`/`GuildProfile`/`PendingInvite` imported from the contract.
- **Model mapping:** workspace_id = gw2 guild id; `hasGw2Key=false`; `hasAxitoolsKey=Boolean(discord_guild_id)`; keys `''`; `shared=true`; `pipelineEnabled=true`.
