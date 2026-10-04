// src/renderer/src/lib/attendanceWindow.ts
//
// Pure time-window helpers for the attendance filter (Roster + Member Detail).
// Mirrors the preset semantics of AxiBridge's rollup time-window strip. No
// React/DOM so it is node-testable — same pattern as lib/retention.ts.

export type TimeWindow =
  | { kind: 'all' }
  | { kind: 'days'; days: 30 | 90 }
  | { kind: 'month'; year: number; month: number } // month 1–12, local time

export interface WindowRaid {
  date: string
  attendees: {
    account: string
    combatTimeMs: number
    squadTimeMs: number
    /** Elite specs / professions played this raid, when the feed carries them. */
    professions?: string[]
  }[]
}

export interface WindowedAttendance {
  attended: number
  total: number
  /** null when the window is empty or the member has no accounts — render '—'. */
  pct: number | null
}

const DAY = 86400000
const lc = (s: string): string => s.trim().toLowerCase()

/** Raids inside the window, order and element identity preserved. Raids with
 *  unparseable dates are excluded from every window, including 'all'. */
export function filterRaids<T extends { date: string }>(raids: T[], w: TimeWindow, now: number): T[] {
  return raids.filter((r) => {
    const ts = Date.parse(r.date)
    if (Number.isNaN(ts)) return false
    if (w.kind === 'all') return true
    if (w.kind === 'days') return ts >= now - w.days * DAY && ts <= now
    // month: [monthStart, nextMonthStart) — Date() rolls month 12 into January.
    return ts >= new Date(w.year, w.month - 1, 1).getTime() && ts < new Date(w.year, w.month, 1).getTime()
  })
}

/** When a member's attendance starts counting: the start of the (local) day
 *  they joined the in-game guild, or their first attended raid if that was
 *  earlier (a guest before joining). null when there is no usable join date,
 *  so every raid counts. */
export function countingSince(
  raids: { date: string; attendees: { account: string }[] }[],
  accounts: string[],
  joined: string | null | undefined
): number | null {
  const j = joined ? Date.parse(joined) : NaN
  if (Number.isNaN(j)) return null
  const d = new Date(j)
  let since = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const accts = accounts.map(lc).filter(Boolean)
  for (const r of raids) {
    const ts = Date.parse(r.date)
    if (ts < since && r.attendees.some((a) => accts.includes(lc(a.account)))) since = ts
  }
  return since
}

/** Windowed attendance for one member across all their GW2 accounts. A raid
 *  counts once no matter how many of the member's accounts attended. Raids
 *  from before the member joined (see countingSince) are left out entirely. */
export function memberAttendance(
  raids: WindowRaid[],
  accounts: string[],
  joined?: string | null
): WindowedAttendance {
  const accts = accounts.map(lc).filter(Boolean)
  const since = countingSince(raids, accounts, joined)
  const counted = since === null ? raids : raids.filter((r) => Date.parse(r.date) >= since)
  const total = counted.length
  if (accts.length === 0 || total === 0) return { attended: 0, total, pct: null }
  let attended = 0
  for (const r of counted) if (r.attendees.some((a) => accts.includes(lc(a.account)))) attended++
  return { attended, total, pct: Math.round((attended / total) * 100) }
}

/** The member's attendee record in a raid (first matching account), or null. */
export function memberEntry(
  raid: WindowRaid,
  accounts: string[]
): WindowRaid['attendees'][number] | null {
  const accts = accounts.map(lc).filter(Boolean)
  return raid.attendees.find((a) => accts.includes(lc(a.account))) ?? null
}

/** Months (local time) containing at least one raid, newest first. */
export function availableMonths(raids: { date: string }[]): { year: number; month: number }[] {
  const seen = new Set<string>()
  const out: { year: number; month: number }[] = []
  for (const r of raids) {
    const ts = Date.parse(r.date)
    if (Number.isNaN(ts)) continue
    const d = new Date(ts)
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push({ year: d.getFullYear(), month: d.getMonth() + 1 })
    }
  }
  return out.sort((a, b) => b.year - a.year || b.month - a.month)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Aug 2026" — dropdown option + strip display label for a month window. */
export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`
}

/** Month-picker option value ("2026-8") → window. The placeholder ("") and
 *  anything unparseable clear the filter back to all-time. */
export function windowFromMonthValue(value: string): TimeWindow {
  const [year, month] = value.split('-').map(Number)
  return year && month ? { kind: 'month', year, month } : { kind: 'all' }
}
