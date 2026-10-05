// supabase/functions/respond-invite/handler.test.ts
import { test, expect, vi } from 'vitest'
import { handleRespond } from './handler'
import { isBlocked, UNAVAILABLE } from '../_shared/policy'

const INVITE = { id: 'i', workspace_id: 'g', role: 'write', code: null, discord_id: 'd1', redeemed_by: null }

function deps(opts: { invite?: unknown; blocked?: (ids: unknown) => Promise<boolean> } = {}) {
  return {
    blocked: vi.fn(opts.blocked ?? (async () => false)),
    serverOf: vi.fn(async () => '1100000000000000001'),
    db: {
      getInvite: vi.fn(async () => (opts.invite === undefined ? INVITE : opts.invite)),
      upsertMember: vi.fn(async () => {}),
      markRedeemed: vi.fn(async () => {}),
      deleteInvite: vi.fn(async () => {})
    }
  }
}

test('inviteId and a valid action are required', async () => {
  const r = await handleRespond(deps() as never, { userId: 'u', discordId: 'd1', inviteId: 'i', action: 'maybe' })
  expect(r.status).toBe(400)
})

test('an invite for someone else is not available', async () => {
  const r = await handleRespond(deps() as never, { userId: 'u', discordId: 'other', inviteId: 'i', action: 'accept' })
  expect(r).toEqual({ status: 404, body: { error: 'invite not available' } })
})

test('accept grants membership and marks the invite redeemed', async () => {
  const d = deps()
  const r = await handleRespond(d as never, { userId: 'u', discordId: 'd1', inviteId: 'i', action: 'accept' })
  expect(r).toEqual({ status: 200, body: { ok: true, workspaceId: 'g', role: 'write' } })
  expect(d.db.upsertMember).toHaveBeenCalledWith({ workspace_id: 'g', user_id: 'u', discord_id: 'd1', role: 'write' })
  expect(d.db.markRedeemed).toHaveBeenCalledWith('i', 'u')
})

test('a revoked caller or workspace is refused before membership and the invite stays open', async () => {
  const d = deps({ blocked: async () => true })
  const r = await handleRespond(d as never, { userId: 'u', discordId: 'd1', inviteId: 'i', action: 'accept' })
  expect(r).toEqual({ status: 403, body: UNAVAILABLE })
  expect(d.serverOf).toHaveBeenCalledWith('g')
  expect(d.blocked).toHaveBeenCalledWith([
    { kind: 'discord_user', value: 'd1' },
    { kind: 'gw2_guild', value: 'g' },
    { kind: 'discord_server', value: '1100000000000000001' }
  ])
  expect(d.db.upsertMember).not.toHaveBeenCalled()
  expect(d.db.markRedeemed).not.toHaveBeenCalled()
})

test('a policy lookup error fails open', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  const d = deps({
    invite: { ...INVITE, discord_id: '123456789012345678' },
    blocked: (ids: any) => isBlocked(async () => { throw new Error('db down') }, ids)
  })
  const r = await handleRespond(d as never, { userId: 'u', discordId: '123456789012345678', inviteId: 'i', action: 'accept' })
  expect(r.status).toBe(200)
  expect(d.db.upsertMember).toHaveBeenCalled()
  expect(err).toHaveBeenCalled()
  err.mockRestore()
})

test('reject drops the invite without a policy check', async () => {
  const d = deps({ blocked: async () => true })
  const r = await handleRespond(d as never, { userId: 'u', discordId: 'd1', inviteId: 'i', action: 'reject' })
  expect(r).toEqual({ status: 200, body: { ok: true, rejected: true } })
  expect(d.db.deleteInvite).toHaveBeenCalledWith('i')
  expect(d.blocked).not.toHaveBeenCalled()
})

test('a membership write error is a 500 and the invite stays open', async () => {
  const d = deps()
  d.db.upsertMember.mockRejectedValueOnce(new Error('boom'))
  const r = await handleRespond(d as never, { userId: 'u', discordId: 'd1', inviteId: 'i', action: 'accept' })
  expect(r).toEqual({ status: 500, body: { error: 'boom' } })
  expect(d.db.markRedeemed).not.toHaveBeenCalled()
})
