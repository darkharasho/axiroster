// supabase/functions/claim-guild/handler.test.ts
import { test, expect, vi } from 'vitest'
import { handleClaim } from './handler'

function deps(owners: number) {
  return {
    keySecret: Buffer.from(new Uint8Array(32).fill(1)).toString('base64'),
    verify: vi.fn(async () => ({ isLeader: owners === 0, members: [] })),
    encrypt: vi.fn(async () => 'enc'),
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
  expect(d.db.insertSecret).toHaveBeenCalled()
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
