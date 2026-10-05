// supabase/functions/refresh-roster/handler.test.ts
import { test, expect, vi } from 'vitest'
import { handleRefresh } from './handler'
import { rlsMember, UNAVAILABLE } from '../_shared/policy'

function deps(member: boolean, allowed: (ws: string) => Promise<boolean> = async () => true) {
  return {
    keySecret: 's', decrypt: vi.fn(async () => 'leaderkey'),
    allowed: vi.fn(allowed),
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

test('non-member keeps not_member without a policy check', async () => {
  const d = deps(false)
  expect((await handleRefresh(d as any, { userId: 'u', guildId: 'g' })).body).toEqual({ error: 'not_member' })
  expect(d.allowed).not.toHaveBeenCalled()
})

test('a revoked member is refused before the leader key is read', async () => {
  const d = deps(true, async () => false)
  const r = await handleRefresh(d as any, { userId: 'u', guildId: 'g' })
  expect(r).toEqual({ status: 403, body: UNAVAILABLE })
  expect(d.allowed).toHaveBeenCalledWith('g')
  expect(d.db.getSecret).not.toHaveBeenCalled()
  expect(d.fetchMembers).not.toHaveBeenCalled()
  expect(d.db.upsertMembers).not.toHaveBeenCalled()
})

test('an is_member RPC error fails open', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  const d = deps(true, rlsMember({ rpc: async () => { throw new Error('network') } }))
  expect((await handleRefresh(d as any, { userId: 'u', guildId: 'g' })).status).toBe(200)
  expect(err).toHaveBeenCalled()
  err.mockRestore()
})
