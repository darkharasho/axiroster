// supabase/functions/refresh-roster/handler.test.ts
import { test, expect, vi } from 'vitest'
import { handleRefresh } from './handler'
import { rlsMember, UNAVAILABLE } from '../_shared/policy'

function deps(
  member: boolean,
  allowed: (ws: string) => Promise<boolean> = async () => true,
  over: Record<string, unknown> = {}
) {
  return {
    keySecret: 's', decrypt: vi.fn(async () => 'leaderkey'),
    allowed: vi.fn(allowed),
    now: () => '2026-10-12T12:00:00.000Z',
    fetchMembers: vi.fn(async () => [{ name: 'A.1', rank: 'Member', joined: null }]),
    db: {
      isMember: vi.fn(async () => member),
      getSecret: vi.fn(async () => 'enc'),
      upsertMembers: vi.fn(async () => {}),
      listMemberIds: vi.fn(async () => [] as string[]),
      listDepartures: vi.fn(async () => [] as { key: string; notes: string }[]),
      listGw2Events: vi.fn(async () => []),
      listLinks: vi.fn(async () => []),
      upsertDepartures: vi.fn(async () => {}),
      deleteMembers: vi.fn(async () => {}),
      ...over
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

test('a departed account is recorded and its stale roster row deleted', async () => {
  const d = deps(true, undefined, { listMemberIds: vi.fn(async () => ['A.1', 'Gone.2']) })
  const r = await handleRefresh(d as any, { userId: 'u', guildId: 'g' })
  expect(r).toEqual({ status: 200, body: { count: 1, departures: 1 } })
  const rows = d.db.upsertDepartures.mock.calls[0][1] as { key: string; notes: string }[]
  expect(rows.map((x) => x.key)).toEqual(['departure:gone.2'])
  expect(JSON.parse(rows[0].notes).episodes[0]).toMatchObject({ kind: 'unknown', source: 'roster-diff' })
  expect(d.db.deleteMembers).toHaveBeenCalledWith('g', ['Gone.2'])
})

test('the previous roster is read before the upsert overwrites it', async () => {
  const d = deps(true)
  await handleRefresh(d as any, { userId: 'u', guildId: 'g' })
  expect(d.db.listMemberIds.mock.invocationCallOrder[0]).toBeLessThan(
    d.db.upsertMembers.mock.invocationCallOrder[0]
  )
})

test('the first refresh (no rows yet) records no diff departures and deletes nothing', async () => {
  const d = deps(true)
  const r = await handleRefresh(d as any, { userId: 'u', guildId: 'g' })
  expect(r.body).toEqual({ count: 1, departures: 0 })
  expect(d.db.upsertDepartures).not.toHaveBeenCalled()
  expect(d.db.deleteMembers).not.toHaveBeenCalled()
})

test('stale rows on first deploy are deleted without bogus episodes', async () => {
  const stale = Array.from({ length: 10 }, (_, i) => `Old${i}.1`)
  const d = deps(true, undefined, { listMemberIds: vi.fn(async () => ['A.1', ...stale]) })
  const r = await handleRefresh(d as any, { userId: 'u', guildId: 'g' })
  expect(r.body).toEqual({ count: 1, departures: 0 })
  expect(d.db.upsertDepartures).not.toHaveBeenCalled()
  expect(d.db.deleteMembers).toHaveBeenCalledWith('g', stale)
})

test('a log kick is recorded from audit_events', async () => {
  const d = deps(true, undefined, {
    listMemberIds: vi.fn(async () => ['A.1']),
    listGw2Events: vi.fn(async () => [
      { uid: 'gw2:7', source: 'gw2', type: 'kick', time: '2026-10-10T00:00:00.000Z', actor: 'Bad.3', target: 'Boss.9' }
    ])
  })
  await handleRefresh(d as any, { userId: 'u', guildId: 'g' })
  const rows = d.db.upsertDepartures.mock.calls[0][1] as { key: string; notes: string }[]
  expect(JSON.parse(rows[0].notes).episodes[0]).toMatchObject({ kind: 'kicked', actor: 'Boss.9', auditUid: 'gw2:7' })
})

test('a departures failure still returns 200 with departuresError', async () => {
  const d = deps(true, undefined, {
    listMemberIds: vi.fn(async () => ['A.1', 'Gone.2']),
    listDepartures: vi.fn(async () => { throw new Error('boom') })
  })
  const r = await handleRefresh(d as any, { userId: 'u', guildId: 'g' })
  expect(r).toEqual({ status: 200, body: { count: 1, departures: 0, departuresError: 'boom' } })
  expect(d.db.upsertMembers).toHaveBeenCalled()
  expect(d.db.deleteMembers).not.toHaveBeenCalled()
})

test('a failed previous-roster read still upserts members', async () => {
  const d = deps(true, undefined, { listMemberIds: vi.fn(async () => { throw new Error('read failed') }) })
  const r = await handleRefresh(d as any, { userId: 'u', guildId: 'g' })
  expect(r).toEqual({ status: 200, body: { count: 1, departures: 0, departuresError: 'read failed' } })
  expect(d.db.upsertMembers).toHaveBeenCalled()
  expect(d.db.listDepartures).not.toHaveBeenCalled()
})
