// supabase/functions/_shared/departures.test.ts
import { describe, test, expect } from 'vitest'
import {
  departureKey,
  accountFromKey,
  emptyDepartureDoc,
  parseDepartureDoc,
  serializeDepartureDoc,
  latestEpisode,
  isOpen,
  detectDepartures,
  type DetectInput,
  type DepartureDoc
} from './departures'

describe('keys', () => {
  test('departureKey trims and lowercases the account', () => {
    expect(departureKey('  Foo.1234 ')).toBe('departure:foo.1234')
  })
  test('accountFromKey strips the prefix', () => {
    expect(accountFromKey('departure:foo.1234')).toBe('foo.1234')
  })
})

describe('parseDepartureDoc', () => {
  test('empty notes yield an empty doc named from the key', () => {
    expect(parseDepartureDoc('departure:foo.1234', '')).toEqual(emptyDepartureDoc('foo.1234'))
  })

  test('corrupt or non-object JSON yields an empty doc', () => {
    expect(parseDepartureDoc('departure:foo.1234', '{nope')).toEqual(emptyDepartureDoc('foo.1234'))
    expect(parseDepartureDoc('departure:foo.1234', '[1,2]')).toEqual(emptyDepartureDoc('foo.1234'))
  })

  test('partial docs are filled in and unknown enums fall back', () => {
    const doc = parseDepartureDoc(
      'departure:foo.1234',
      JSON.stringify({
        account: 'Foo.1234',
        dismissedSuggestions: ['d1', 7, ''],
        episodes: [
          { kind: 'weird', at: '2026-01-01T00:00:00.000Z', source: 'bogus' },
          { kind: 'left' } // no `at` → dropped
        ]
      })
    )
    expect(doc.account).toBe('Foo.1234')
    expect(doc.memberId).toBeNull()
    expect(doc.note).toBe('')
    expect(doc.dismissedSuggestions).toEqual(['d1'])
    expect(doc.episodes).toEqual([
      {
        kind: 'unknown',
        actor: null,
        at: '2026-01-01T00:00:00.000Z',
        source: 'manual',
        auditUid: null,
        reason: '',
        rejoinedAt: null
      }
    ])
  })

  test('episodes come back newest first', () => {
    const doc = parseDepartureDoc(
      'departure:foo.1234',
      JSON.stringify({
        account: 'Foo.1234',
        episodes: [
          { kind: 'left', at: '2025-01-01T00:00:00.000Z', source: 'gw2-log' },
          { kind: 'kicked', at: '2026-01-01T00:00:00.000Z', source: 'gw2-log', actor: 'Boss.1' }
        ]
      })
    )
    expect(doc.episodes.map((e) => e.kind)).toEqual(['kicked', 'left'])
  })

  test('serialize → parse round-trips', () => {
    const doc: DepartureDoc = {
      account: 'Foo.1234',
      memberId: 'd1',
      dismissedSuggestions: ['d2'],
      note: 'toxic in chat',
      episodes: [
        {
          kind: 'kicked',
          actor: 'Boss.1',
          at: '2026-01-01T00:00:00.000Z',
          source: 'gw2-log',
          auditUid: 'gw2:9',
          reason: 'afk',
          rejoinedAt: null
        }
      ]
    }
    expect(parseDepartureDoc(departureKey(doc.account), serializeDepartureDoc(doc))).toEqual(doc)
  })
})

describe('latestEpisode / isOpen', () => {
  test('an empty doc has no latest episode and is not open', () => {
    const d = emptyDepartureDoc('Foo.1234')
    expect(latestEpisode(d)).toBeNull()
    expect(isOpen(d)).toBe(false)
  })
  test('open until the latest episode has rejoinedAt', () => {
    const d = parseDepartureDoc(
      'departure:foo.1234',
      JSON.stringify({ episodes: [{ kind: 'left', at: '2026-01-01T00:00:00.000Z', source: 'gw2-log' }] })
    )
    expect(isOpen(d)).toBe(true)
    d.episodes[0].rejoinedAt = '2026-02-01T00:00:00.000Z'
    expect(isOpen(d)).toBe(false)
  })
})

const NOW = '2026-10-12T12:00:00.000Z'
const DAY = 86_400_000
const ago = (days: number): string => new Date(Date.parse(NOW) - days * DAY).toISOString()
const kick = (id: number, user: string, by: string | undefined, time: string) => ({
  uid: `gw2:${id}`, source: 'gw2', type: 'kick', time, actor: user, target: by
})
const joinedEv = (id: number, user: string, time: string) => ({
  uid: `gw2:${id}`, source: 'gw2', type: 'joined', time, actor: user
})
const run = (over: Partial<DetectInput> = {}) =>
  detectDepartures({
    previous: null,
    current: [{ name: 'Stay.1000' }],
    auditEvents: [],
    existing: new Map(),
    links: [],
    now: NOW,
    ...over
  })
const asMap = (docs: DepartureDoc[]) => new Map(docs.map((d) => [departureKey(d.account), d]))
const docFor = (docs: DepartureDoc[], account: string) =>
  docs.find((d) => departureKey(d.account) === departureKey(account))

describe('audit fold', () => {
  test('a self-kick is a leave; an officer kick is a kick with its actor', () => {
    const r = run({ auditEvents: [kick(1, 'Quit.1', 'Quit.1', ago(2)), kick(2, 'Bad.2', 'Boss.9', ago(1))] })
    expect(docFor(r.changed, 'Quit.1')!.episodes[0]).toMatchObject({ kind: 'left', actor: null, source: 'gw2-log', auditUid: 'gw2:1' })
    expect(docFor(r.changed, 'Bad.2')!.episodes[0]).toMatchObject({ kind: 'kicked', actor: 'Boss.9', auditUid: 'gw2:2' })
  })

  test('a kick with no kicked_by is unknown but still from the log', () => {
    const r = run({ auditEvents: [kick(1, 'Who.1', undefined, ago(1))] })
    expect(docFor(r.changed, 'Who.1')!.episodes[0]).toMatchObject({ kind: 'unknown', source: 'gw2-log' })
  })

  test('discord events and other gw2 types are ignored', () => {
    const r = run({
      auditEvents: [
        { uid: 'discord:1', source: 'discord', type: 'kick', time: ago(1), actor: 'X.1', target: 'Y.2' },
        { uid: 'gw2:5', source: 'gw2', type: 'rank_change', time: ago(1), actor: 'X.1' }
      ]
    })
    expect(r.changed).toEqual([])
  })

  test('backfill: many stored events fold in one run', () => {
    const events = Array.from({ length: 200 }, (_, i) => kick(i, `P${i}.1000`, 'Boss.9', ago(400 - i)))
    expect(run({ auditEvents: events }).changed).toHaveLength(200)
  })

  test('a joined event after an open episode sets rejoinedAt; one before it does not', () => {
    const r = run({ auditEvents: [joinedEv(1, 'Back.1', ago(30)), kick(2, 'Back.1', 'Back.1', ago(20)), joinedEv(3, 'Back.1', ago(10))] })
    const d = docFor(r.changed, 'Back.1')!
    expect(d.episodes).toHaveLength(1)
    expect(d.episodes[0].rejoinedAt).toBe(ago(10))
  })

  test('rejoin then leave again produces a second, open episode', () => {
    const r = run({
      auditEvents: [kick(1, 'Yoyo.1', 'Boss.9', ago(30)), joinedEv(2, 'Yoyo.1', ago(20)), kick(3, 'Yoyo.1', 'Yoyo.1', ago(5))]
    })
    const d = docFor(r.changed, 'Yoyo.1')!
    expect(d.episodes.map((e) => [e.kind, e.rejoinedAt])).toEqual([
      ['left', null],
      ['kicked', ago(20)]
    ])
  })
})

describe('roster diff', () => {
  test('an account that vanished gets an unknown roster-diff episode at now', () => {
    const r = run({ previous: ['Stay.1000', 'Gone.2000'] })
    expect(r.skipped).toBeNull()
    expect(r.vanished).toEqual(['Gone.2000'])
    expect(docFor(r.changed, 'Gone.2000')!.episodes).toEqual([
      { kind: 'unknown', actor: null, at: NOW, source: 'roster-diff', auditUid: null, reason: '', rejoinedAt: null }
    ])
  })

  test('a diff is a no-op while the latest episode is still open', () => {
    const first = run({ auditEvents: [kick(1, 'Gone.2000', 'Boss.9', ago(1))] })
    const r = run({ previous: ['Stay.1000', 'Gone.2000'], existing: asMap(first.changed), auditEvents: [kick(1, 'Gone.2000', 'Boss.9', ago(1))] })
    expect(r.changed).toEqual([])
  })

  test('casing differences collapse into one record', () => {
    const r = run({ previous: ['Stay.1000', 'Gone.2000'], auditEvents: [kick(1, 'gone.2000', 'Boss.9', ago(1))] })
    expect(r.changed).toHaveLength(1)
    expect(r.changed[0].episodes).toHaveLength(1)
    expect(r.changed[0].episodes[0].kind).toBe('kicked')
  })
})

describe('upgrade window', () => {
  const diffOnly = (): Map<string, DepartureDoc> => {
    const r = run({ previous: ['Stay.1000', 'Gone.2000'] })
    const d = docFor(r.changed, 'Gone.2000')!
    d.episodes[0].reason = 'went quiet'
    return asMap([d])
  }

  test('a log event within ±7d upgrades the diff episode and keeps its reason', () => {
    const r = run({ existing: diffOnly(), auditEvents: [kick(9, 'Gone.2000', 'Boss.9', ago(3))] })
    expect(docFor(r.changed, 'Gone.2000')!.episodes).toEqual([
      { kind: 'kicked', actor: 'Boss.9', at: ago(3), source: 'gw2-log', auditUid: 'gw2:9', reason: 'went quiet', rejoinedAt: null }
    ])
  })

  test('a log event outside the window adds a separate episode', () => {
    const r = run({ existing: diffOnly(), auditEvents: [kick(9, 'Gone.2000', 'Boss.9', ago(10))] })
    expect(docFor(r.changed, 'Gone.2000')!.episodes.map((e) => e.source)).toEqual(['roster-diff', 'gw2-log'])
  })
})

describe('rejoin by roster presence', () => {
  const openDoc = (): Map<string, DepartureDoc> =>
    asMap(run({ auditEvents: [kick(1, 'Back.1', 'Boss.9', ago(30))] }).changed)

  test('uses the roster joined date when it is after the departure', () => {
    const r = run({ existing: openDoc(), current: [{ name: 'Back.1', joined: ago(3) }], auditEvents: [kick(1, 'Back.1', 'Boss.9', ago(30))] })
    expect(docFor(r.changed, 'Back.1')!.episodes[0].rejoinedAt).toBe(ago(3))
  })

  test('falls back to now when the joined date is missing', () => {
    const r = run({ existing: openDoc(), current: [{ name: 'back.1' }] })
    expect(docFor(r.changed, 'Back.1')!.episodes[0].rejoinedAt).toBe(NOW)
  })
})

describe('safety guards', () => {
  const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `M${i}.1000`)

  test('no snapshot: skip the diff, still fold the log', () => {
    const r = run({ previous: null, auditEvents: [kick(1, 'Gone.2000', 'Boss.9', ago(1))] })
    expect(r.skipped).toBe('no-snapshot')
    expect(r.vanished).toEqual([])
    expect(r.changed).toHaveLength(1)
  })

  test('empty pull: skip the diff and report nothing vanished', () => {
    const r = run({ previous: ['A.1', 'B.2'], current: [] })
    expect(r.skipped).toBe('empty-pull')
    expect(r.vanished).toEqual([])
    expect(r.changed).toEqual([])
  })

  test('mass drop (>25% and >5): no diff episodes, but vanished is reported', () => {
    const prev = names(20)
    const r = run({ previous: prev, current: prev.slice(0, 14).map((name) => ({ name })) })
    expect(r.skipped).toBe('mass-drop')
    expect(r.vanished).toHaveLength(6)
    expect(r.changed).toEqual([])
  })

  test('mass drop still folds log kicks', () => {
    const prev = names(20)
    const r = run({
      previous: prev,
      current: prev.slice(0, 14).map((name) => ({ name })),
      auditEvents: [kick(1, 'M19.1000', 'Boss.9', ago(1))]
    })
    expect(r.changed.map((d) => d.account)).toEqual(['M19.1000'])
  })

  test('a large fraction of a tiny roster is not a mass drop (needs >5)', () => {
    const r = run({ previous: ['A.1', 'B.2', 'C.3', 'D.4'], current: [{ name: 'A.1' }] })
    expect(r.skipped).toBeNull()
    expect(r.changed).toHaveLength(3)
  })
})

describe('idempotency and officer fields', () => {
  const input = (): Partial<DetectInput> => ({
    previous: ['Stay.1000', 'Gone.2000'],
    auditEvents: [kick(1, 'Gone.2000', 'Boss.9', ago(1))]
  })

  test('re-running on its own output changes nothing', () => {
    const first = run(input())
    const again = run({ ...input(), previous: ['Stay.1000'], existing: asMap(first.changed) })
    expect(again.changed).toEqual([])
  })

  test('two writers from the same state converge on the same doc', () => {
    const a = run(input())
    const b = run(input())
    expect(a.changed).toEqual(b.changed)
    expect(run({ ...input(), existing: asMap(a.changed) }).changed).toEqual([])
  })

  test('never mutates the existing map', () => {
    const existing = asMap(run(input()).changed)
    const snapshot = JSON.stringify([...existing.values()])
    run({ existing, current: [{ name: 'Gone.2000', joined: ago(0.5) }] })
    expect(JSON.stringify([...existing.values()])).toBe(snapshot)
  })

  test('officer fields are preserved, and a set memberId is never replaced', () => {
    const base = run({ previous: ['Stay.1000', 'Gone.2000'] }).changed[0]
    base.note = 'see thread'
    base.memberId = 'd9'
    base.dismissedSuggestions = ['d1']
    base.episodes[0].reason = 'inactive'
    const r = run({
      existing: asMap([base]),
      auditEvents: [kick(4, 'Gone.2000', 'Boss.9', ago(2))],
      links: [{ accountName: 'gone.2000', memberId: 'd2' }]
    })
    const d = docFor(r.changed, 'Gone.2000')!
    expect(d).toMatchObject({ note: 'see thread', memberId: 'd9', dismissedSuggestions: ['d1'] })
    expect(d.episodes[0].reason).toBe('inactive')
  })

  test('auto-link fills a null memberId from links, even with no new evidence', () => {
    const base = run({ previous: ['Stay.1000', 'Gone.2000'] }).changed[0]
    const r = run({ existing: asMap([base]), links: [{ accountName: 'GONE.2000', memberId: 'd2' }] })
    expect(r.changed).toHaveLength(1)
    expect(r.changed[0].memberId).toBe('d2')
  })
})

describe('fix round 1', () => {
  test('diff -> rejoin -> log kick after the rejoin (within 7d) stays two episodes', () => {
    const T0 = '2026-10-01T12:00:00.000Z'
    const at = (d: number): string => new Date(Date.parse(T0) + d * DAY).toISOString()
    const r1 = run({ previous: ['Stay.1000', 'X.1'], now: T0 })
    const r2 = run({ existing: asMap(r1.changed), current: [{ name: 'Stay.1000' }, { name: 'X.1' }], now: at(2) })
    const r3 = run({
      previous: ['Stay.1000', 'X.1'],
      existing: asMap([...r1.changed.map((d) => docFor(r2.changed, d.account) ?? d)]),
      auditEvents: [kick(7, 'X.1', 'Boss.9', at(5))],
      now: at(5.5)
    })
    const eps = docFor(r3.changed, 'X.1')!.episodes
    expect(eps).toHaveLength(2)
    expect(eps[0]).toMatchObject({ kind: 'kicked', source: 'gw2-log', rejoinedAt: null })
    expect(eps[1]).toMatchObject({ source: 'roster-diff', at: T0, rejoinedAt: at(2) })
  })

  test('presence rejoin skips a kick within the margin of now', () => {
    const r = run({ current: [{ name: 'Stay.1000' }, { name: 'Fresh.1' }], auditEvents: [kick(1, 'Fresh.1', 'Boss.9', ago(1 / 1440))] })
    expect(docFor(r.changed, 'Fresh.1')!.episodes[0].rejoinedAt).toBeNull()
  })

  test('presence rejoin closes a kick older than the margin', () => {
    const r = run({ current: [{ name: 'Stay.1000' }, { name: 'Old.1' }], auditEvents: [kick(1, 'Old.1', 'Boss.9', ago(1 / 24))] })
    expect(docFor(r.changed, 'Old.1')!.episodes[0].rejoinedAt).toBe(NOW)
  })

  test('mass-drop denominator ignores duplicates and blanks', () => {
    const uniq = Array.from({ length: 20 }, (_, i) => `U${i}.1`)
    const previous = [...uniq, ...uniq, ...uniq, '', ' ']
    const r = run({ previous, current: uniq.slice(0, 14).map((name) => ({ name })) })
    expect(r.skipped).toBe('mass-drop')
  })
})
