import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  webCreateInvite,
  webRedeemInvite,
  webPendingSentInvites,
  webRevokeInvite,
  webAdoptSharedKeys,
  webLogRetention
} from './admin'
import { createWebSettings } from './settings'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size
    }
  } as Storage
}
const settings = () => createWebSettings(fakeStorage())

// builder supporting insert().select().single(), select().eq().is().order() (thenable),
// delete().eq().eq() (thenable), upsert(). Records insert/upsert/delete payloads.
function fakeSb(opts: { rows?: unknown[]; invoke?: ReturnType<typeof vi.fn>; insertCode?: string; members?: { workspace_id: string; role: string }[] } = {}) {
  const rec: { insert?: Record<string, unknown>; upsert?: unknown; deleted?: boolean } = {}
  const invitesBuilder = () => {
    const b: Record<string, unknown> = {}
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      is: () => b,
      order: () => b,
      insert: (row: Record<string, unknown>) => {
        rec.insert = row
        return { select: () => ({ single: async () => ({ data: { code: opts.insertCode ?? 'CODE1234' } }) }) }
      },
      upsert: async (rows: unknown) => {
        rec.upsert = rows
        return { error: null }
      },
      delete: () => ({ eq: () => ({ eq: async () => { rec.deleted = true; return { error: null } } }) }),
      then: (res: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: opts.rows ?? [], error: null }).then(res)
    })
    return b
  }
  const sb = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) =>
      t === 'workspace_members'
        ? { select: () => ({ eq: () => Promise.resolve({ data: opts.members ?? [{ workspace_id: 'w1', role: 'owner' }] }) }) }
        : invitesBuilder(),
    functions: { invoke: opts.invoke ?? vi.fn(async () => ({ data: {}, error: null })) }
  } as unknown as SupabaseClient
  return { sb, rec }
}

test('createInvite inserts a write/read invite and returns the code', async () => {
  const { sb, rec } = fakeSb({ insertCode: 'ABCD1234' })
  const r = await webCreateInvite(sb, settings(), { role: 'write', discordId: 'd9' })
  expect(r).toEqual({ code: 'ABCD1234' })
  expect(rec.insert).toMatchObject({ workspace_id: 'w1', role: 'write', discord_id: 'd9', created_by: 'u1' })
})

test('createInvite returns an explicit error when there is no active workspace', async () => {
  const { sb } = fakeSb({ members: [] })
  expect(await webCreateInvite(sb, settings(), { role: 'write' })).toEqual({ error: 'No active guild selected.' })
})

test('createInvite rejects an invalid role', async () => {
  const { sb } = fakeSb()
  expect(await webCreateInvite(sb, settings(), { role: 'owner' })).toEqual({ error: 'invalid_role' })
})

test('redeemInvite invokes redeem-invite and maps the result', async () => {
  const invoke = vi.fn(async () => ({ data: { workspaceId: 'w1', role: 'write' }, error: null }))
  const { sb } = fakeSb({ invoke })
  expect(await webRedeemInvite(sb, '  CODE  ')).toEqual({ ok: true, workspaceId: 'w1', role: 'write' })
  expect(invoke).toHaveBeenCalledWith('redeem-invite', { body: { code: 'CODE' } })
  expect((await webRedeemInvite(sb, '')).ok).toBe(false)
})

test('pendingSentInvites maps rows to SentInvite', async () => {
  const { sb } = fakeSb({ rows: [{ id: 'i1', discord_id: 'd1', code: null, role: 'read', created_at: 't' }] })
  expect(await webPendingSentInvites(sb, settings())).toEqual([
    { id: 'i1', discordId: 'd1', code: null, role: 'read' }
  ])
})

test('revokeInvite deletes and returns ok', async () => {
  const { sb, rec } = fakeSb()
  expect(await webRevokeInvite(sb, settings(), 'i1')).toEqual({ ok: true })
  expect(rec.deleted).toBe(true)
})

test('adoptSharedKeys returns not-adopted', async () => {
  expect(await webAdoptSharedKeys()).toEqual({ adopted: false })
})

test('logRetention upserts mapped retention rows', async () => {
  const { sb, rec } = fakeSb()
  await webLogRetention(sb, settings(), [{ date: '2026-06-20', memberKey: 'A', score: 0.5, tier: 't1' }])
  expect(rec.upsert).toEqual([{ workspace_id: 'w1', date: '2026-06-20', member_key: 'A', score: 0.5, tier: 't1' }])
})
