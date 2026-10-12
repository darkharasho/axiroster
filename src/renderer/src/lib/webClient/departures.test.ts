import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('./discordGw2', () => ({ activeWorkspaceId: vi.fn(async () => 'w1') }))

import { webDeparturesGet } from './departures'
import { createWebSettings } from './settings'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() { return m.size }
  } as Storage
}

function builder(rows: unknown, error: unknown = null) {
  const eq = vi.fn(() => b)
  const like = vi.fn(() => b)
  const b: Record<string, unknown> = {
    select: () => b,
    eq,
    like,
    order: () => b,
    range: () => b,
    then: (res: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve({ data: rows, error }).then(res)
  }
  return Object.assign(b, { eq, like })
}

const sb = (ann: ReturnType<typeof builder>): SupabaseClient =>
  ({ from: (t: string) => (t === 'roster_annotations' ? ann : undefined) }) as unknown as SupabaseClient

test('reads departure:* rows for the active workspace', async () => {
  const ann = builder([{ member_id: 'departure:foo.1', notes: '{"account":"Foo.1"}' }, { member_id: 'departure:bar.2', notes: null }])
  const rows = await webDeparturesGet(sb(ann), createWebSettings(fakeStorage()))
  expect(ann.eq).toHaveBeenCalledWith('workspace_id', 'w1')
  expect(ann.like).toHaveBeenCalledWith('member_id', 'departure:%')
  expect(rows).toEqual([
    { key: 'departure:foo.1', notes: '{"account":"Foo.1"}' },
    { key: 'departure:bar.2', notes: '' }
  ])
})

test('a query error reads as no departures', async () => {
  expect(await webDeparturesGet(sb(builder(null, { message: 'x' })), createWebSettings(fakeStorage()))).toEqual([])
})

test('pages past the 1000-row PostgREST cap', async () => {
  const pages = [
    Array.from({ length: 1000 }, (_, i) => ({ member_id: `departure:a${i}`, notes: '' })),
    [{ member_id: 'departure:z', notes: '' }]
  ]
  let call = 0
  const range = vi.fn(() => Promise.resolve({ data: pages[call++] ?? [], error: null }))
  const b: Record<string, unknown> = { select: () => b, eq: () => b, like: () => b, order: () => b, range }
  const rows = await webDeparturesGet(sb(b as ReturnType<typeof builder>), createWebSettings(fakeStorage()))
  expect(rows).toHaveLength(1001)
  expect(range).toHaveBeenNthCalledWith(1, 0, 999)
  expect(range).toHaveBeenNthCalledWith(2, 1000, 1999)
})
