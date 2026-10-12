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
