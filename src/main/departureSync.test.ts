import { test, expect, vi } from 'vitest'
import { syncDepartures, type DepartureSyncDeps } from './departureSync'

const NOW = '2026-10-12T12:00:00.000Z'

function deps(over: Partial<DepartureSyncDeps> = {}) {
  const written: Record<string, string> = {}
  let snap: string[] | null = ['A.1', 'Gone.2']
  const d: DepartureSyncDeps = {
    guildId: 'g1',
    auditGuildId: 'g1',
    snapshot: { read: () => snap, write: (a) => { snap = a } },
    auditEvents: () => [],
    reservedRows: () => [],
    links: [],
    save: vi.fn(async (key: string, notes: string) => { written[key] = notes }),
    log: vi.fn(),
    now: () => NOW,
    ...over
  }
  return { d, written, snap: () => snap }
}

test('records a vanished account and rewrites the snapshot', async () => {
  const t = deps()
  expect(await syncDepartures(t.d, [{ name: 'A.1' }])).toBe(1)
  expect(Object.keys(t.written)).toEqual(['departure:gone.2'])
  expect(t.snap()).toEqual(['A.1'])
})

test('an empty pull touches nothing, including the snapshot', async () => {
  const t = deps()
  expect(await syncDepartures(t.d, [])).toBe(0)
  expect(t.d.save).not.toHaveBeenCalled()
  expect(t.snap()).toEqual(['A.1', 'Gone.2'])
})

test('existing departure rows are respected (idempotent re-run)', async () => {
  const t = deps()
  await syncDepartures(t.d, [{ name: 'A.1' }])
  const rows = Object.entries(t.written).map(([memberId, notes]) => ({ memberId, notes }))
  const again = deps({ reservedRows: () => [...rows, { memberId: 'meta:pipeline', notes: '{}' }] })
  expect(await syncDepartures(again.d, [{ name: 'A.1' }])).toBe(0)
})

test('a failing audit store or snapshot is logged and skipped', async () => {
  const t = deps({
    auditEvents: () => { throw new Error('audit down') },
    snapshot: { read: () => { throw new Error('disk') }, write: () => {} }
  })
  expect(await syncDepartures(t.d, [{ name: 'A.1' }])).toBe(0)
  expect(t.d.log).toHaveBeenCalledTimes(2)
})

test('a mass drop is logged', async () => {
  const prev = Array.from({ length: 20 }, (_, i) => `M${i}.1`)
  const t = deps({ snapshot: { read: () => prev, write: () => {} } })
  await syncDepartures(t.d, prev.slice(0, 10).map((name) => ({ name })))
  expect(t.d.log).toHaveBeenCalledWith(expect.stringContaining('mass'))
})

test('a failed save keeps the account in the snapshot so it is retried', async () => {
  let snap: string[] | null = ['A.1', 'Gone.2']
  const base = { snapshot: { read: () => snap, write: (a: string[]) => { snap = a } } }
  const failing = deps({ ...base, save: vi.fn(async () => { throw new Error('push down') }) })
  expect(await syncDepartures(failing.d, [{ name: 'A.1' }])).toBe(0)
  expect(snap).toContain('Gone.2')

  const ok = deps(base)
  expect(await syncDepartures(ok.d, [{ name: 'A.1' }])).toBe(1)
  expect(Object.keys(ok.written)).toEqual(['departure:gone.2'])
})

test('an audit store still pointing at another guild records nothing and leaves the snapshot alone', async () => {
  const kick = { uid: 'u1', source: 'gw2', type: 'kick', time: '2026-10-11T00:00:00.000Z', actor: 'Boss.1', target: 'Gone.2' }
  const auditEvents = vi.fn(() => [kick])
  const t = deps({ auditGuildId: 'other-guild', auditEvents })
  expect(await syncDepartures(t.d, [{ name: 'A.1' }])).toBe(0)
  expect(t.d.save).not.toHaveBeenCalled()
  expect(auditEvents).not.toHaveBeenCalled()
  expect(t.snap()).toEqual(['A.1', 'Gone.2'])
  expect(t.d.log).toHaveBeenCalledWith(expect.stringContaining('another guild'))
})

test('no audit store yet (null) also skips detection', async () => {
  const t = deps({ auditGuildId: null })
  expect(await syncDepartures(t.d, [{ name: 'A.1' }])).toBe(0)
  expect(t.snap()).toEqual(['A.1', 'Gone.2'])
})

test('async (server) rows are used as the existing docs', async () => {
  const first = deps()
  await syncDepartures(first.d, [{ name: 'A.1' }])
  const rows = Object.entries(first.written).map(([memberId, notes]) => ({ memberId, notes }))
  const again = deps({ reservedRows: async () => rows })
  expect(await syncDepartures(again.d, [{ name: 'A.1' }])).toBe(0)
})

test('a failing row read aborts with the snapshot untouched', async () => {
  const t = deps({ reservedRows: async () => { throw new Error('offline') } })
  await expect(syncDepartures(t.d, [{ name: 'A.1' }])).rejects.toThrow('offline')
  expect(t.snap()).toEqual(['A.1', 'Gone.2'])
})
