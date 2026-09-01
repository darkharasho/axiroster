// src/main/axibridgeClient.attendance.test.ts
import { describe, it, expect } from 'vitest'
import { parseAttendanceFile, mergeAttendanceRaids, reportUrlFor, type AttendanceRaidDTO, type RepoRef } from './axibridgeClient'

describe('parseAttendanceFile', () => {
  it('returns raids for a valid v1 file', () => {
    const raids = parseAttendanceFile({
      version: 1, generatedAt: 'x',
      raids: [{ id: 'a', date: 'd', attendees: [{ account: 'A.1', combatTimeMs: 1, squadTimeMs: 2 }] }]
    })
    expect(raids).toHaveLength(1)
    expect(raids[0].attendees[0].account).toBe('A.1')
  })
  it('returns [] for missing/corrupt/wrong-version/non-object', () => {
    expect(parseAttendanceFile(null)).toEqual([])
    expect(parseAttendanceFile({ version: 2, raids: [] })).toEqual([])
    expect(parseAttendanceFile({ version: 1, raids: 'no' })).toEqual([])
    expect(parseAttendanceFile('garbage')).toEqual([])
  })
  it('keeps attendee professions (non-empty strings only), omitting the field otherwise', () => {
    const raids = parseAttendanceFile({
      version: 1, generatedAt: 'x',
      raids: [{
        id: 'a', date: 'd',
        attendees: [
          { account: 'A.1', combatTimeMs: 1, squadTimeMs: 2, professions: ['Firebrand', 7, '', 'Scrapper'] },
          { account: 'B.2', combatTimeMs: 1, squadTimeMs: 2 },
          { account: 'C.3', combatTimeMs: 1, squadTimeMs: 2, professions: 'Druid' }
        ]
      }]
    })
    expect(raids[0].attendees[0].professions).toEqual(['Firebrand', 'Scrapper'])
    expect(raids[0].attendees[1].professions).toBeUndefined()
    expect(raids[0].attendees[2].professions).toBeUndefined()
  })
})

const raid = (id: string, date: string): AttendanceRaidDTO => ({
  id,
  date,
  attendees: [{ account: 'A.1', combatTimeMs: 1, squadTimeMs: 2 }]
})
const R1: RepoRef = { owner: 'axi', repo: 'reports-a' }
const R2: RepoRef = { owner: 'axi', repo: 'reports-b' }

describe('reportUrlFor', () => {
  it('builds the canonical Pages report path', () => {
    expect(reportUrlFor(R1, 'x9')).toBe('https://axi.github.io/reports-a/reports/x9')
  })
})

describe('mergeAttendanceRaids', () => {
  it('stamps each raid with its supplying repo url', () => {
    const out = mergeAttendanceRaids([{ repo: R1, raids: [raid('a', '2026-08-01')] }])
    expect(out[0].reportUrl).toBe('https://axi.github.io/reports-a/reports/a')
  })
  it('first-repo-wins on duplicate ids, keeping the first url', () => {
    const out = mergeAttendanceRaids([
      { repo: R1, raids: [raid('dup', '2026-08-01')] },
      { repo: R2, raids: [raid('dup', '2026-08-01'), raid('b', '2026-07-01')] }
    ])
    expect(out).toHaveLength(2)
    expect(out.find((r) => r.id === 'dup')?.reportUrl).toContain('reports-a')
    expect(out.find((r) => r.id === 'b')?.reportUrl).toContain('reports-b')
  })
  it('sorts newest-first by date string', () => {
    const out = mergeAttendanceRaids([
      { repo: R1, raids: [raid('old', '2026-06-01'), raid('new', '2026-08-05')] }
    ])
    expect(out.map((r) => r.id)).toEqual(['new', 'old'])
  })
})
