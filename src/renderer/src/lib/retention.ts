// src/renderer/src/lib/retention.ts
//
// Transparent, tag-weighted churn-risk model. Pure (no React/DOM) so it is
// node-testable. Consumes per-raid attendance time-series and produces a 0-100
// score + tier + human reasons per member. All knobs live in DEFAULT_RETENTION_CONFIG.

export interface AttendanceRaid {
  id: string
  date: string
  attendees: { account: string; combatTimeMs: number; squadTimeMs: number }[]
}
export interface RetentionMemberInput {
  annotationKey: string
  accounts: string[]
  tags: string[]
}
export type RetentionTier = 'at-risk' | 'watch' | 'healthy' | 'insufficient-data'
export interface RetentionSignals {
  recentRate: number | null
  priorRate: number | null
  decay: number
  absenceStreak: number
  daysSinceLast: number | null
  engagement: number | null
  raidsRecent: number
  attendedRecent: number
}
export interface RetentionResult {
  memberKey: string
  score: number
  tier: RetentionTier
  reasons: string[]
  signals: RetentionSignals
  timeline: boolean[]
}
export interface RetentionConfig {
  recentWindowDays: number
  priorWindowDays: number
  streakFull: number
  staleFullDays: number
  minRaidsInWindow: number
  timelineRaids: number
  weights: { attendance: number; decay: number; streak: number; stale: number; engagement: number }
  tagImportance: Record<string, number>
  defaultImportance: number
  tiers: { atRisk: number; watch: number }
}

export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  recentWindowDays: 14,
  priorWindowDays: 14,
  streakFull: 6,
  staleFullDays: 21,
  minRaidsInWindow: 2,
  timelineRaids: 8,
  weights: { attendance: 0.3, decay: 0.25, streak: 0.2, stale: 0.15, engagement: 0.1 },
  tagImportance: { core: 1.25, commander: 1.25, trial: 0.85 },
  defaultImportance: 1,
  tiers: { atRisk: 60, watch: 35 }
}

const DAY = 86400000
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

export function computeRetention(input: {
  raids: AttendanceRaid[]
  members: RetentionMemberInput[]
  now: number
  config?: RetentionConfig
}): RetentionResult[] {
  const cfg = input.config ?? DEFAULT_RETENTION_CONFIG
  // newest-first raids with a parsed timestamp
  const raids = input.raids
    .map((r) => ({ raid: r, ts: Date.parse(r.date) }))
    .filter((x) => !Number.isNaN(x.ts))
    .sort((a, b) => b.ts - a.ts)

  const recentCut = input.now - cfg.recentWindowDays * DAY
  const priorCut = recentCut - cfg.priorWindowDays * DAY
  const recentRaids = raids.filter((x) => x.ts >= recentCut)
  const priorRaids = raids.filter((x) => x.ts < recentCut && x.ts >= priorCut)

  const attendeeSet = (r: AttendanceRaid): Map<string, { combatTimeMs: number; squadTimeMs: number }> => {
    const m = new Map<string, { combatTimeMs: number; squadTimeMs: number }>()
    for (const a of r.attendees) m.set(a.account.toLowerCase(), { combatTimeMs: a.combatTimeMs, squadTimeMs: a.squadTimeMs })
    return m
  }
  const recentMaps = recentRaids.map((x) => ({ ts: x.ts, raid: x.raid, by: attendeeSet(x.raid) }))
  const priorMaps = priorRaids.map((x) => ({ by: attendeeSet(x.raid) }))
  const timelineMaps = raids.slice(0, cfg.timelineRaids).map((x) => ({ ts: x.ts, by: attendeeSet(x.raid) }))

  const results: RetentionResult[] = []
  for (const member of input.members) {
    const accts = member.accounts.map((a) => a.toLowerCase()).filter(Boolean)
    const attended = (by: Map<string, { combatTimeMs: number; squadTimeMs: number }>): boolean =>
      accts.some((a) => by.has(a))

    const raidsRecent = recentMaps.length
    const attendedRecent = recentMaps.filter((x) => attended(x.by)).length
    const recentRate = raidsRecent > 0 ? attendedRecent / raidsRecent : null
    const priorRate = priorMaps.length > 0 ? priorMaps.filter((x) => attended(x.by)).length / priorMaps.length : null
    const decay = recentRate !== null && priorRate !== null ? Math.max(0, priorRate - recentRate) : 0

    // absence streak: consecutive most-recent raids (any window) missed
    let absenceStreak = 0
    for (const x of raids) {
      if (attended(attendeeSet(x.raid))) break
      absenceStreak++
    }
    // days since last attended
    let daysSinceLast: number | null = null
    for (const x of raids) {
      if (attended(attendeeSet(x.raid))) {
        daysSinceLast = Math.max(0, Math.floor((input.now - x.ts) / DAY))
        break
      }
    }
    // engagement: avg combat/squad ratio across recent attended raids
    let engSum = 0
    let engCount = 0
    for (const x of recentMaps) {
      for (const a of accts) {
        const e = x.by.get(a)
        if (e && e.squadTimeMs > 0) {
          engSum += clamp01(e.combatTimeMs / e.squadTimeMs)
          engCount++
          break
        }
      }
    }
    const engagement = engCount > 0 ? engSum / engCount : null

    const timeline = timelineMaps.map((x) => attended(x.by))

    const signals: RetentionSignals = {
      recentRate, priorRate, decay, absenceStreak, daysSinceLast, engagement, raidsRecent, attendedRecent
    }

    // eligibility
    if (accts.length === 0 || raidsRecent < cfg.minRaidsInWindow) {
      results.push({ memberKey: member.annotationKey, score: 0, tier: 'insufficient-data', reasons: ['insufficient data'], signals, timeline })
      continue
    }

    const attendanceRisk = recentRate !== null ? 1 - recentRate : 0
    const decayRisk = clamp01(decay)
    const streakRisk = clamp01(absenceStreak / cfg.streakFull)
    const staleRisk = daysSinceLast !== null ? clamp01(daysSinceLast / cfg.staleFullDays) : 0
    const engagementRisk = engagement !== null ? 1 - engagement : 0
    const w = cfg.weights
    let raw =
      w.attendance * attendanceRisk +
      w.decay * decayRisk +
      w.streak * streakRisk +
      w.stale * staleRisk +
      w.engagement * engagementRisk

    const importance = Math.max(
      cfg.defaultImportance,
      ...member.tags.map((t) => cfg.tagImportance[t.toLowerCase()] ?? cfg.defaultImportance)
    )
    const score = Math.round(clamp01(raw * importance) * 100)
    const tier: RetentionTier = score >= cfg.tiers.atRisk ? 'at-risk' : score >= cfg.tiers.watch ? 'watch' : 'healthy'

    // reasons: top contributors
    const reasons: string[] = []
    if (absenceStreak >= 2) reasons.push(`missed last ${absenceStreak}`)
    if (decay > 0.15 && priorRate !== null && recentRate !== null)
      reasons.push(`${Math.round(priorRate * 100)}%→${Math.round(recentRate * 100)}%`)
    else if (recentRate !== null && recentRate < 0.5) reasons.push(`attendance ${Math.round(recentRate * 100)}%`)
    if (engagement !== null && engagement < 0.4) reasons.push('low engagement')
    const impTag = member.tags.find((t) => (cfg.tagImportance[t.toLowerCase()] ?? 1) > 1)
    if (impTag && tier !== 'healthy') reasons.push(impTag.toLowerCase())
    if (reasons.length === 0) reasons.push(recentRate === 1 ? '100% · steady' : 'stable')

    results.push({ memberKey: member.annotationKey, score, tier, reasons, signals, timeline })
  }

  return results.sort((a, b) => b.score - a.score)
}
