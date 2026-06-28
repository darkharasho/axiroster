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
  expect((invoke.mock.calls as unknown[][])[0][0]).toBe('share-keys')
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

test('removeGuild is a no-op on web (deferred — no server-side leave path)', async () => {
  const { sb, rec } = fakeSb({ members: [{ workspace_id: 'g1', role: 'read' }] })
  const s = settings()
  s.set('activeGuildId', 'g1')
  await webRemoveGuild(sb, s, 'g1')
  expect(rec.deletedWs).toBeUndefined()
  expect(s.get('activeGuildId')).toBe('g1')
})
