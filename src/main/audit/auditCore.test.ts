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

test('filterAuditEvents person filter: GW2 membership events by account, Discord events by target id', () => {
  const events = [
    ev('gw2:1', 'gw2', '2026-06-25T00:00:00Z', { actor: 'Foo.1234', type: 'kick', raw: { user: 'Foo.1234', kicked_by: 'Off.1' } }),
    ev('gw2:2', 'gw2', '2026-06-24T00:00:00Z', { actor: 'Foo.1234', type: 'stash', raw: { user: 'Foo.1234' } }),
    ev('gw2:3', 'gw2', '2026-06-23T00:00:00Z', { actor: 'Other.9', target: 'Foo.1234', type: 'kick', raw: { user: 'Other.9', kicked_by: 'Foo.1234' } }),
    ev('discord:4', 'discord', '2026-06-22T00:00:00Z', { type: 'member_ban', raw: { target_id: '42', actor_id: '7' } }),
    ev('discord:5', 'discord', '2026-06-21T00:00:00Z', { type: 'member_kick', raw: { target_id: '99', actor_id: '42' } }),
    ev('discord:6', 'discord', '2026-06-20T00:00:00Z', { type: 'member_join', raw: { actor_id: '42' } }),
    ev('gw2:7', 'gw2', '2026-06-19T00:00:00Z', { actor: 'Alt.5555', type: 'joined', raw: { user: 'Alt.5555' } })
  ]
  const person = { accounts: ['Foo.1234', 'Alt.5555'], discordIds: ['42'] }
  // gw2:2 (their own stash move), gw2:3 and discord:5 (they did it to someone else) are excluded.
  expect(filterAuditEvents(events, { person }).map((e) => e.uid)).toEqual(['gw2:1', 'discord:4', 'discord:6', 'gw2:7'])
  expect(filterAuditEvents(events, { person: { accounts: ['Foo.1234'], discordIds: [] } }).map((e) => e.uid)).toEqual(['gw2:1'])
  expect(filterAuditEvents(events, { person: { accounts: [], discordIds: [] } })).toEqual([])
})

test('filterAuditEvents applies the limit after the person filter', () => {
  const noise = Array.from({ length: 5 }, (_, i) => ev(`gw2:n${i}`, 'gw2', `2026-07-0${i + 1}T00:00:00Z`, { actor: 'X.1', type: 'joined' }))
  const mine = ev('gw2:m', 'gw2', '2026-06-01T00:00:00Z', { actor: 'Foo.1234', type: 'joined' })
  expect(filterAuditEvents([...noise, mine], { person: { accounts: ['Foo.1234'], discordIds: [] }, limit: 2 }).map((e) => e.uid)).toEqual(['gw2:m'])
})
