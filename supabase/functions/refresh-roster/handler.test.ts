// supabase/functions/refresh-roster/handler.test.ts
import { test, expect, vi } from 'vitest'
import { handleRefresh } from './handler'

function deps(member: boolean) {
  return {
    keySecret: 's', decrypt: vi.fn(async () => 'leaderkey'),
    fetchMembers: vi.fn(async () => [{ name: 'A.1', rank: 'Member', joined: null }]),
    db: {
      isMember: vi.fn(async () => member),
      getSecret: vi.fn(async () => 'enc'),
      upsertMembers: vi.fn(async () => {})
    }
  }
}

test('non-member => 403', async () => {
  const r = await handleRefresh(deps(false) as any, { userId: 'u', guildId: 'g' })
  expect(r.status).toBe(403)
})

test('member refresh upserts members', async () => {
  const d = deps(true)
  const r = await handleRefresh(d as any, { userId: 'u', guildId: 'g' })
  expect(r.status).toBe(200)
  expect(d.db.upsertMembers).toHaveBeenCalledWith('g', expect.arrayContaining([
    expect.objectContaining({ member_id: 'A.1' })
  ]))
})
