import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { webAuditList, webAuditRefresh } from './audit'
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

// Chainable builder: .select/.eq/.or/.order/.limit chain and the object is
// thenable (resolves { data: rows }). Records eq/or calls for assertions.
function builder(rows: unknown) {
  const calls = { eq: [] as [string, unknown][], or: [] as string[] }
  const b: Record<string, unknown> = {}
  Object.assign(b, {
    select: () => b,
    eq: (c: string, v: unknown) => {
      calls.eq.push([c, v])
      return b
    },
    or: (s: string) => {
      calls.or.push(s)
      return b
    },
    order: () => b,
    limit: () => b,
    then: (res: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(res)
  })
  ;(b as { calls: typeof calls }).calls = calls
  return b as Record<string, unknown> & { calls: typeof calls }
}

function fakeSb(rowsByTable: Record<string, unknown>) {
  const builders: Record<string, ReturnType<typeof builder>> = {}
  const sb = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => (builders[t] ??= builder(rowsByTable[t] ?? []))
  } as unknown as SupabaseClient
  return { sb, builders }
}

const EV = {
  uid: 'gw2:1',
  source: 'gw2',
  id: '1',
  time: '2026-06-22T00:00:00Z',
  type: 'joined',
  summary: 'x',
  raw: null
}

test('webAuditList maps payloads and sets updatedAt to the first event time', async () => {
  const { sb } = fakeSb({
    workspace_members: [{ workspace_id: 'w1', role: 'owner' }],
    audit_events: [{ payload: EV }]
  })
  const r = await webAuditList(sb, createWebSettings(fakeStorage()))
  expect(r.events).toEqual([EV])
  expect(r.updatedAt).toBe('2026-06-22T00:00:00Z')
})

test('webAuditList applies source + search filters', async () => {
  const { sb, builders } = fakeSb({
    workspace_members: [{ workspace_id: 'w1', role: 'owner' }],
    audit_events: []
  })
  await webAuditList(sb, createWebSettings(fakeStorage()), { source: 'discord', search: 'bob' })
  const aud = builders['audit_events']
  expect(aud.calls.eq).toContainEqual(['source', 'discord'])
  expect(aud.calls.or[0]).toMatch(/actor\.ilike\.%bob%/)
})

test('webAuditList with no workspace returns empty', async () => {
  const sb = {
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => builder([])
  } as unknown as SupabaseClient
  expect(await webAuditList(sb, createWebSettings(fakeStorage()))).toEqual({ events: [], updatedAt: '' })
})

test('webAuditRefresh is a no-op returning ok(0)', async () => {
  expect(await webAuditRefresh()).toEqual({ ok: true, data: 0 })
})
