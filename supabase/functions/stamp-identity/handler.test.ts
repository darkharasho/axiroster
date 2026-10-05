// supabase/functions/stamp-identity/handler.test.ts
import { test, expect, vi } from 'vitest'
import { handleStamp } from './handler'
import { isBlocked, UNAVAILABLE } from '../_shared/policy'

const STORED = '1100000000000000001'
const discordUser = (id: string, name: string) => ({
  id, identities: [{ provider: 'discord', identity_data: { provider_id: `d-${id}`, user_name: name, full_name: name } }]
})

function deps(opts: { blocked?: (ids: unknown) => Promise<boolean>; member?: boolean } = {}) {
  return {
    blocked: vi.fn(opts.blocked ?? (async () => false)),
    serverOf: vi.fn(async () => STORED),
    db: {
      stampSelf: vi.fn(async () => {}),
      isMember: vi.fn(async () => opts.member ?? true),
      memberIds: vi.fn(async () => ['u', 'p']),
      getUser: vi.fn(async (uid: string) => discordUser(uid, `name-${uid}`)),
      stampMember: vi.fn(async () => {})
    }
  }
}

test('stamps the caller and backfills peers of a workspace they belong to', async () => {
  const d = deps()
  const r = await handleStamp(d as never, { user: discordUser('u', 'me'), guildId: 'g' })
  expect(r).toEqual({ status: 200, body: { stamped: 2 } })
  expect(d.db.stampSelf).toHaveBeenCalledWith('u', { discord_username: 'me', discord_global_name: 'me' })
  expect(d.db.stampMember).toHaveBeenCalledWith('g', 'p', { discord_id: 'd-p', discord_username: 'name-p', discord_global_name: 'name-p' })
})

test('checks the caller, the guild and its stored Discord server', async () => {
  const d = deps()
  await handleStamp(d as never, { user: discordUser('u', 'me'), guildId: 'g' })
  expect(d.serverOf).toHaveBeenCalledWith('g')
  expect(d.blocked).toHaveBeenCalledWith([
    { kind: 'discord_user', value: 'd-u' },
    { kind: 'gw2_guild', value: 'g' },
    { kind: 'discord_server', value: STORED }
  ])
})

test('without a guildId only the caller is checked and stamped', async () => {
  const d = deps()
  expect(await handleStamp(d as never, { user: discordUser('u', 'me') })).toEqual({ status: 200, body: { stamped: 1 } })
  expect(d.serverOf).not.toHaveBeenCalled()
  expect(d.blocked).toHaveBeenCalledWith([
    { kind: 'discord_user', value: 'd-u' },
    { kind: 'gw2_guild', value: undefined },
    { kind: 'discord_server', value: null }
  ])
})

test('a revoked caller or workspace is refused before anything is stamped', async () => {
  const d = deps({ blocked: async () => true })
  expect(await handleStamp(d as never, { user: discordUser('u', 'me'), guildId: 'g' })).toEqual({ status: 403, body: UNAVAILABLE })
  expect(d.db.stampSelf).not.toHaveBeenCalled()
  expect(d.db.stampMember).not.toHaveBeenCalled()
})

test('a policy lookup error fails open', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  const d = deps({ blocked: (ids: any) => isBlocked(async () => { throw new Error('db down') }, ids) })
  const u = { id: 'u', identities: [{ provider: 'discord', identity_data: { provider_id: '123456789012345678' } }] }
  expect((await handleStamp(d as never, { user: u, guildId: 'g' })).status).toBe(200)
  expect(err).toHaveBeenCalled()
  err.mockRestore()
})

test('a non-member gets only their own rows stamped', async () => {
  const d = deps({ member: false })
  expect(await handleStamp(d as never, { user: discordUser('u', 'me'), guildId: 'g' })).toEqual({ status: 200, body: { stamped: 1 } })
  expect(d.db.memberIds).not.toHaveBeenCalled()
})
