import { describe, expect, it } from 'vitest'
import { fmtJoined, joinedLine } from './joinDates'

describe('join dates', () => {
  it('formats a timestamp and rejects missing or bad input', () => {
    expect(fmtJoined('2024-03-04T12:00:00.000Z')).toMatch(/2024/)
    expect(fmtJoined(null)).toBeNull()
    expect(fmtJoined(undefined)).toBeNull()
    expect(fmtJoined('not a date')).toBeNull()
  })

  it('shows a dash for whichever half is missing', () => {
    expect(joinedLine({ joined: null, discordJoined: null })).toBe('In-game — · Discord —')
    expect(joinedLine({ joined: '2024-03-04T12:00:00.000Z' })).toMatch(/^In-game .*2024 · Discord —$/)
  })
})
