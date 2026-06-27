// src/renderer/src/lib/retention.test.ts
import { describe, it, expect } from 'vitest'
import { computeRetention, DEFAULT_RETENTION_CONFIG, type AttendanceRaid } from './retention'

const DAY = 86400000
const now = Date.parse('2026-02-15T00:00:00Z')
// helper: a raid `d` days before now with the given attendees (full engagement)
const raid = (id: string, daysAgo: number, accounts: string[]): AttendanceRaid => ({
  id, date: new Date(now - daysAgo * DAY).toISOString(),
  attendees: accounts.map((a) => ({ account: a, combatTimeMs: 3_000_000, squadTimeMs: 3_000_000 }))
})

// 8 raids: every 2 days. recent window (≤14d) = raids at 0,2,4,6 days; prior (14–28d) = 16,18,20,22
const raids: AttendanceRaid[] = [
  raid('r0', 0, ['Aldous.1']), raid('r1', 2, ['Aldous.1']),
  raid('r2', 4, ['Aldous.1']), raid('r3', 6, ['Aldous.1']),
  raid('r4', 16, ['Aldous.1', 'Eternal.2']), raid('r5', 18, ['Aldous.1', 'Eternal.2']),
  raid('r6', 20, ['Aldous.1', 'Eternal.2']), raid('r7', 22, ['Aldous.1', 'Eternal.2'])
]

describe('computeRetention', () => {
  it('scores a steady attendee healthy and a vanished core member at-risk', () => {
    const out = computeRetention({
      raids,
      members: [
        { annotationKey: 'aldous', accounts: ['Aldous.1'], tags: [] },          // attends everything
        { annotationKey: 'eternal', accounts: ['Eternal.2'], tags: ['core'] }   // stopped 14d ago
      ],
      now
    })
    const aldous = out.find((r) => r.memberKey === 'aldous')!
    const eternal = out.find((r) => r.memberKey === 'eternal')!
    expect(aldous.tier).toBe('healthy')
    expect(aldous.signals.recentRate).toBe(1)
    expect(eternal.signals.recentRate).toBe(0)
    expect(eternal.signals.absenceStreak).toBe(4) // missed the 4 recent raids
    expect(eternal.tier).toBe('at-risk')
    expect(eternal.score).toBeGreaterThan(aldous.score)
    expect(out[0].memberKey).toBe('eternal') // sorted by score desc
  })

  it('marks members with too little history insufficient-data', () => {
    const out = computeRetention({
      raids: [raid('only', 1, ['Solo.9'])],
      members: [{ annotationKey: 'solo', accounts: ['Solo.9'], tags: [] }],
      now,
      config: { ...DEFAULT_RETENTION_CONFIG, minRaidsInWindow: 2 }
    })
    expect(out[0].tier).toBe('insufficient-data')
  })

  it('ranks a slipping core above a slipping trial at equal raw signals (tag weighting)', () => {
    const slip = [raid('a', 1, []), raid('b', 3, []), raid('c', 16, ['X.1', 'Y.2']), raid('d', 18, ['X.1', 'Y.2'])]
    const out = computeRetention({
      raids: slip,
      members: [
        { annotationKey: 'core', accounts: ['X.1'], tags: ['core'] },
        { annotationKey: 'trial', accounts: ['Y.2'], tags: ['trial'] }
      ],
      now
    })
    const core = out.find((r) => r.memberKey === 'core')!
    const trial = out.find((r) => r.memberKey === 'trial')!
    expect(core.score).toBeGreaterThan(trial.score)
  })

  it("unions attendance across a member's accounts (no double count)", () => {
    const r = [raid('a', 1, ['Alt.1']), raid('b', 3, ['Main.1']), raid('c', 5, ['Alt.1'])]
    const out = computeRetention({
      raids: r,
      members: [{ annotationKey: 'm', accounts: ['Main.1', 'Alt.1'], tags: [] }],
      now,
      config: { ...DEFAULT_RETENTION_CONFIG, minRaidsInWindow: 1 }
    })
    expect(out[0].signals.recentRate).toBe(1) // present in all 3 via either account
  })
})
