// src/main/axibridgeClient.attendance.test.ts
import { describe, it, expect } from 'vitest'
import { parseAttendanceFile } from './axibridgeClient'

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
})
