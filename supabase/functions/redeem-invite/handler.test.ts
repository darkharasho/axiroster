import { test, expect, vi } from 'vitest'
import { handleRedeem } from './handler.ts'
function deps(invite: any) {
  return { blocked: vi.fn(async () => false), db: {
    listOpenInvites: vi.fn(async () => invite ? [invite] : []),
    markRedeemed: vi.fn(async () => {}),
    insertMember: vi.fn(async () => {})
  } }
}
test('valid invite grants membership at its role', async () => {
  const d = deps({ id: 'i', workspace_id: 'g', role: 'write', code: null, discord_id: 'd1', redeemed_by: null })
  const r = await handleRedeem(d as any, { userId: 'u', discordId: 'd1' })
  expect(r.status).toBe(200)
  expect(d.db.insertMember).toHaveBeenCalledWith(expect.objectContaining({ role: 'write', user_id: 'u' }))
})
test('no invite => 404', async () => {
  const r = await handleRedeem(deps(null) as any, { userId: 'u', discordId: 'd1' })
  expect(r.status).toBe(404)
})

test('a revoked caller or workspace is refused and the invite stays open', async () => {
  const d = deps({ id: 'i', workspace_id: 'g', role: 'write', code: null, discord_id: 'd1', redeemed_by: null })
  d.blocked = vi.fn(async () => true)
  const r = await handleRedeem(d as any, { userId: 'u', discordId: 'd1' })
  expect(r).toEqual({ status: 403, body: { error: 'unavailable', message: 'Access unavailable for this account.' } })
  expect(d.blocked).toHaveBeenCalledWith([
    { kind: 'discord_user', value: 'd1' },
    { kind: 'gw2_guild', value: 'g' }
  ])
  expect(d.db.insertMember).not.toHaveBeenCalled()
  expect(d.db.markRedeemed).not.toHaveBeenCalled()
})
