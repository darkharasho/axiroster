// supabase/functions/share-keys/handler.test.ts
import { test, expect, vi } from 'vitest'
import { handleShareKeys } from './handler'
import { isBlocked, UNAVAILABLE } from '../_shared/policy'

const STORED = '1100000000000000001'

function deps(opts: { role?: string | null; blocked?: (ids: unknown) => Promise<boolean> } = {}) {
  return {
    keySecret: 's',
    encrypt: vi.fn(async (plain: string) => `enc:${plain}`),
    accountName: vi.fn(async () => 'Owner.1234'),
    blocked: vi.fn(opts.blocked ?? (async () => false)),
    serverOf: vi.fn(async () => STORED),
    db: {
      role: vi.fn(async () => (opts.role === undefined ? 'owner' : opts.role)),
      upsertSecret: vi.fn(async () => null),
      updateSecret: vi.fn(async () => null),
      updateWorkspace: vi.fn(async () => null)
    }
  }
}
const input = (body: Record<string, unknown>) => ({ userId: 'u', discordId: 'd1', body: { guildId: 'g', ...body } })

test('guildId is required and only the owner may change sharing', async () => {
  expect((await handleShareKeys(deps() as never, { userId: 'u', discordId: 'd1', body: {} })).status).toBe(400)
  const r = await handleShareKeys(deps({ role: 'write' }) as never, input({ share: true, apiKey: 'k' }))
  expect(r).toEqual({ status: 403, body: { error: 'not_owner' } })
})

test('sharing on stores the encrypted keys and guild metadata', async () => {
  const d = deps()
  const r = await handleShareKeys(d as never, input({ share: true, apiKey: 'k', axitoolsKey: 'ax', discordGuildId: STORED, gw2GuildName: 'G' }))
  expect(r).toEqual({ status: 200, body: { ok: true, shared: true } })
  expect(d.db.upsertSecret).toHaveBeenCalledWith({ workspace_id: 'g', leader_key_enc: 'enc:k', axitools_key_enc: 'enc:ax' })
  expect(d.db.updateWorkspace).toHaveBeenCalledWith('g', expect.objectContaining({ keys_shared: true, has_leader_key: true, discord_guild_id: STORED, guild_name: 'G' }))
})

test('sharing on checks the stored Discord server as well as the supplied one', async () => {
  const d = deps()
  await handleShareKeys(d as never, input({ share: true, apiKey: 'k', discordGuildId: '' }))
  expect(d.serverOf).toHaveBeenCalledWith('g')
  expect(d.blocked).toHaveBeenCalledWith([
    { kind: 'discord_user', value: 'd1' },
    { kind: 'gw2_account', value: 'Owner.1234' },
    { kind: 'gw2_guild', value: 'g' },
    { kind: 'discord_server', value: '' },
    { kind: 'discord_server', value: STORED }
  ])
})

test('a revoked owner cannot turn sharing on, nor clear the stored server, and nothing is written', async () => {
  const d = deps({ blocked: async () => true })
  const r = await handleShareKeys(d as never, input({ share: true, apiKey: 'k', discordGuildId: '' }))
  expect(r).toEqual({ status: 403, body: UNAVAILABLE })
  expect(d.encrypt).not.toHaveBeenCalled()
  expect(d.db.upsertSecret).not.toHaveBeenCalled()
  expect(d.db.updateWorkspace).not.toHaveBeenCalled()
})

test('a revoked owner can still turn sharing off', async () => {
  const d = deps({ blocked: async () => true })
  const r = await handleShareKeys(d as never, input({ share: false }))
  expect(r).toEqual({ status: 200, body: { ok: true, shared: false } })
  expect(d.blocked).not.toHaveBeenCalled()
  expect(d.db.updateSecret).toHaveBeenCalledWith('g', { axitools_key_enc: null })
  expect(d.db.updateWorkspace).toHaveBeenCalledWith('g', { keys_shared: false })
})

test('sharing on without an apiKey is a 400 before any policy call', async () => {
  const d = deps()
  expect((await handleShareKeys(d as never, input({ share: true }))).status).toBe(400)
  expect(d.accountName).not.toHaveBeenCalled()
  expect(d.blocked).not.toHaveBeenCalled()
})

test('a policy lookup error fails open', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  const d = deps({ blocked: (ids: any) => isBlocked(async () => { throw new Error('db down') }, ids) })
  const r = await handleShareKeys(d as never, input({ share: true, apiKey: 'k' }))
  expect(r.status).toBe(200)
  expect(err).toHaveBeenCalled()
  err.mockRestore()
})

test('a write error while sharing on is a 500', async () => {
  const d = deps()
  d.db.upsertSecret.mockResolvedValueOnce('boom' as never)
  expect(await handleShareKeys(d as never, input({ share: true, apiKey: 'k' }))).toEqual({ status: 500, body: { error: 'boom' } })
  expect(d.db.updateWorkspace).not.toHaveBeenCalled()
})
