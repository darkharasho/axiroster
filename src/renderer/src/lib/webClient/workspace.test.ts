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

test('webListGuilds reads retention/pipeline feature flags from the workspace row', async () => {
  const settings = createWebSettings(fakeStorage())
  const sb = fakeSb({
    memberships: [{ workspace_id: 'w1', role: 'owner' }],
    workspaces: [{ ...WS, retention_enabled: true, pipeline_enabled: false }]
  })
  const [g] = await webListGuilds(sb, settings)
  expect(g).toMatchObject({ retentionEnabled: true, pipelineEnabled: false })
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
