// supabase/functions/get-shared-keys/handler.test.ts
import { test, expect, vi } from 'vitest'
import { handleGetSharedKeys } from './handler'
import { rlsMember, UNAVAILABLE } from '../_shared/policy'

function deps(opts: { member?: boolean; allowed?: (ws: string) => Promise<boolean> } = {}) {
  return {
    keySecret: 's',
    decrypt: vi.fn(async (enc: string) => `plain:${enc}`),
    allowed: vi.fn(opts.allowed ?? (async () => true)),
    db: {
      isMember: vi.fn(async () => opts.member ?? true),
      getWorkspace: vi.fn(async () => ({ guild_name: 'G', discord_guild_id: '1100000000000000001', discord_guild_name: 'S',
        member_role_id: 'r', bridge_repos: ['a/b'], retention_enabled: true, pipeline_enabled: null })),
      getSecrets: vi.fn(async () => ({ leader_key_enc: 'lk', axitools_key_enc: 'ak' }))
    }
  }
}

test('guildId is required', async () => {
  expect(await handleGetSharedKeys(deps() as never, { userId: 'u' })).toEqual({ status: 400, body: { error: 'guildId required' } })
})

test('a non-member is refused as before, without asking the policy', async () => {
  const d = deps({ member: false })
  expect(await handleGetSharedKeys(d as never, { userId: 'u', guildId: 'g' })).toEqual({ status: 403, body: { error: 'not_member' } })
  expect(d.allowed).not.toHaveBeenCalled()
  expect(d.db.getSecrets).not.toHaveBeenCalled()
})

test('a revoked member is refused before any config or secret is read', async () => {
  const d = deps({ allowed: async () => false })
  expect(await handleGetSharedKeys(d as never, { userId: 'u', guildId: 'g' })).toEqual({ status: 403, body: UNAVAILABLE })
  expect(d.allowed).toHaveBeenCalledWith('g')
  expect(d.db.getWorkspace).not.toHaveBeenCalled()
  expect(d.db.getSecrets).not.toHaveBeenCalled()
  expect(d.decrypt).not.toHaveBeenCalled()
})

test('an allowed member gets the decrypted keys and guild config', async () => {
  const r = await handleGetSharedKeys(deps() as never, { userId: 'u', guildId: 'g' })
  expect(r).toEqual({ status: 200, body: {
    apiKey: 'plain:lk', axitoolsShared: true, axitoolsKey: 'plain:ak', gw2GuildId: 'g', gw2GuildName: 'G',
    discordGuildId: '1100000000000000001', discordGuildName: 'S', memberRoleId: 'r', bridgeRepos: ['a/b'],
    retentionEnabled: true, pipelineEnabled: true
  } })
})

test('an is_member RPC error fails open', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  const d = deps({ allowed: rlsMember({ rpc: async () => ({ data: null, error: new Error('rpc down') }) }) })
  expect((await handleGetSharedKeys(d as never, { userId: 'u', guildId: 'g' })).status).toBe(200)
  expect(err).toHaveBeenCalled()
  err.mockRestore()
})
