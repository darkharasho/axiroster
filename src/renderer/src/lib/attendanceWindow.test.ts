import { describe, it, expect } from 'vitest'
import {
  filterRaids,
  memberAttendance,
  memberEntry,
  availableMonths,
  monthLabel,
  type TimeWindow
} from './attendanceWindow'

const DAY = 86400000
const NOW = Date.parse('2026-08-07T12:00:00')
const r = (date: string, accounts: string[] = ['A.1']) => ({
  date,
  attendees: accounts.map((account) => ({ account, combatTimeMs: 60000, squadTimeMs: 120000 }))
})

describe('filterRaids', () => {
  const raids = [
    r(new Date(NOW - 1 * DAY).toISOString()),
    r(new Date(NOW - 30 * DAY).toISOString()), // exactly on the 30d edge
    r(new Date(NOW - 30 * DAY - 1).toISOString()), // 1ms past the edge
    r(new Date(NOW + 5 * DAY).toISOString()), // future-dated
    r('not-a-date')
  ]
  it('all: keeps everything with a parseable date', () => {
    expect(filterRaids(raids, { kind: 'all' }, NOW)).toHaveLength(4)
  })
  it('days: inclusive at the exact edge, excludes older and future raids', () => {
    const out = filterRaids(raids, { kind: 'days', days: 30 }, NOW)
    expect(out).toHaveLength(2) // -1d and the exact -30d edge
  })
  it('month: [monthStart, nextMonthStart) in local time, across a year boundary', () => {
    const dec: TimeWindow = { kind: 'month', year: 2026, month: 12 }
    const raids2 = [
      r(new Date(2026, 11, 1, 0, 0, 0).toISOString()), // Dec 1 00:00 — in
      r(new Date(2026, 11, 31, 23, 59, 59).toISOString()), // Dec 31 — in
      r(new Date(2027, 0, 1, 0, 0, 0).toISOString()) // Jan 1 next year — out
    ]
    expect(filterRaids(raids2, dec, NOW)).toHaveLength(2)
  })
  it('preserves input order and element identity', () => {
    const out = filterRaids(raids, { kind: 'all' }, NOW)
    expect(out[0]).toBe(raids[0])
  })
})

describe('memberAttendance', () => {
  it('counts a raid once even when several of the member accounts attended', () => {
    const raids = [r('2026-08-01', ['A.1', 'B.2']), r('2026-08-02', ['C.3'])]
    expect(memberAttendance(raids, ['A.1', 'B.2'])).toEqual({ attended: 1, total: 2, pct: 50 })
  })
  it('matches accounts case- and whitespace-insensitively', () => {
    const raids = [r('2026-08-01', ['  Vexa.2841 '])]
    expect(memberAttendance(raids, ['vexa.2841']).attended).toBe(1)
  })
  it('pct is null with no accounts (never 0%)', () => {
    expect(memberAttendance([r('2026-08-01')], []).pct).toBeNull()
  })
  it('pct is null with an empty window', () => {
    expect(memberAttendance([], ['A.1'])).toEqual({ attended: 0, total: 0, pct: null })
  })
})

describe('memberEntry', () => {
  it('returns the attendee record for the first matching account', () => {
    expect(memberEntry(r('2026-08-01', ['X.9', 'A.1']), ['a.1'])?.account).toBe('A.1')
  })
  it('returns null when the member missed the raid', () => {
    expect(memberEntry(r('2026-08-01', ['X.9']), ['A.1'])).toBeNull()
  })
})

describe('availableMonths', () => {
  it('dedupes, skips bad dates, and sorts newest-first', () => {
    const months = availableMonths([
      r('2026-06-14T12:00:00Z'),
      r('2026-08-01T12:00:00Z'),
      r('2026-08-20T12:00:00Z'),
      r('2025-12-30T12:00:00Z'),
      r('garbage')
    ])
    expect(months).toEqual([
      { year: 2026, month: 8 },
      { year: 2026, month: 6 },
      { year: 2025, month: 12 }
    ])
  })
})

describe('monthLabel', () => {
  it('formats as "Mon YYYY"', () => {
    expect(monthLabel(2026, 8)).toBe('Aug 2026')
  })
})
