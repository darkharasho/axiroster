import { test, expect } from 'vitest'
import { mergeAuditEvents, filterAuditEvents, countsBySource, auditWsConnFor } from './auditCore'
import type { AuditEvent } from '../auditNormalize'

function ev(uid: string, source: 'gw2' | 'discord', time: string, extra: Partial<AuditEvent> = {}): AuditEvent {
  return { uid, source, id: uid.split(':')[1], time, type: 't', summary: `s-${uid}`, raw: null, ...extra }
}

test('mergeAuditEvents dedupes by uid, sorts newest-first, returns added count', () => {
  const acc: AuditEvent[] = []
  expect(mergeAuditEvents(acc, [ev('gw2:1', 'gw2', '2026-06-20T00:00:00Z'), ev('gw2:2', 'gw2', '2026-06-22T00:00:00Z')])).toBe(2)
  expect(mergeAuditEvents(acc, [ev('gw2:2', 'gw2', '2026-06-22T00:00:00Z')])).toBe(0)
  expect(acc.map((e) => e.uid)).toEqual(['gw2:2', 'gw2:1'])
})

test('filterAuditEvents filters by source, type, search, and limit', () => {
  const events = [
    ev('gw2:1', 'gw2', '2026-06-22T00:00:00Z', { actor: 'Alice', type: 'joined' }),
    ev('discord:9', 'discord', '2026-06-21T00:00:00Z', { actor: 'Bob', type: 'kick', summary: 'Bob kicked' })
  ]
  expect(filterAuditEvents(events, { source: 'discord' }).map((e) => e.uid)).toEqual(['discord:9'])
  expect(filterAuditEvents(events, { type: 'joined' }).map((e) => e.uid)).toEqual(['gw2:1'])
  expect(filterAuditEvents(events, { search: 'bob' }).map((e) => e.uid)).toEqual(['discord:9'])
  expect(filterAuditEvents(events, { limit: 1 }).length).toBe(1)
})

test('countsBySource splits gw2 vs discord', () => {
  expect(countsBySource([ev('gw2:1', 'gw2', '2026-06-20T00:00:00Z'), ev('discord:9', 'discord', '2026-06-21T00:00:00Z')]))
    .toEqual({ gw2: 1, discord: 1 })
})

test('auditWsConnFor only returns the connection whose workspace IS this guild', () => {
  const conn = { workspaceId: 'WS-EWW', url: 'u' }
  // Matching guild → the connection is usable.
  expect(auditWsConnFor('WS-EWW', conn)).toBe(conn)
  // A different guild must NOT ride another workspace's connection (this is how
  // one guild's log ended up inside another's workspace).
  expect(auditWsConnFor('WS-DEFI', conn)).toBeNull()
  // No guild id (Discord-only profile) or no connection → local only.
  expect(auditWsConnFor(null, conn)).toBeNull()
  expect(auditWsConnFor('', conn)).toBeNull()
  expect(auditWsConnFor('WS-EWW', null)).toBeNull()
})
