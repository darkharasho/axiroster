// supabase/functions/claim-guild/handler.test.ts
import { test, expect, vi } from 'vitest'
import { handleClaim } from './handler'

function deps(owners: number) {
  return {
    keySecret: Buffer.from(new Uint8Array(32).fill(1)).toString('base64'),
    verify: vi.fn(async () => ({ isLeader: owners === 0, members: [] })),
    encrypt: vi.fn(async () => 'enc'),
    blocked: vi.fn(async () => false),
    accountName: vi.fn(async () => 'Name.1234'),
    db: {
      countOwners: vi.fn(async () => owners),
      upsertWorkspace: vi.fn(async () => {}),
      insertSecret: vi.fn(async () => {}),
      insertMember: vi.fn(async () => {})
    }
  }
}

const input = { userId: 'u1', discordId: 'd1', apiKey: 'k', guildId: 'g', guildName: 'G' }

test('first leader claims as owner', async () => {
  const d = deps(0)
  const r = await handleClaim(d as any, input)
  expect(r.status).toBe(200)
  expect(d.db.insertMember).toHaveBeenCalledWith(expect.objectContaining({ role: 'owner', workspace_id: 'g' }))
  expect(d.db.insertSecret).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: 'g', leader_key_enc: 'enc' }))
})

test('already claimed => 409', async () => {
  const r = await handleClaim(deps(1) as any, input)
  expect(r.status).toBe(409)
})

test('non-leader => 403', async () => {
  const d = deps(0)
  d.verify = vi.fn(async () => ({ isLeader: false, members: [] }))
  const r = await handleClaim(d as any, input)
  expect(r.status).toBe(403)
})

test('a revoked caller is refused before anything is verified or written', async () => {
  const d = deps(0)
  d.blocked = vi.fn(async () => true)
  const r = await handleClaim(d as any, input)
  expect(r).toEqual({ status: 403, body: { error: 'unavailable', message: 'Access unavailable for this account.' } })
  expect(d.verify).not.toHaveBeenCalled()
  expect(d.db.upsertWorkspace).not.toHaveBeenCalled()
  expect(d.db.insertMember).not.toHaveBeenCalled()
})

test('the check covers the Discord user, GW2 account, GW2 guild and Discord server', async () => {
  const d = deps(0)
  await handleClaim(d as any, { ...input, discordGuildId: '1100000000000000001' })
  expect(d.accountName).toHaveBeenCalledWith('k')
  expect(d.blocked).toHaveBeenCalledWith([
    { kind: 'discord_user', value: 'd1' },
    { kind: 'gw2_account', value: 'Name.1234' },
    { kind: 'gw2_guild', value: 'g' },
    { kind: 'discord_server', value: '1100000000000000001' }
  ])
})
