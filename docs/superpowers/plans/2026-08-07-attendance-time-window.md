# Attendance Time Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Time-window filter (All time · Last 30 days · Last 90 days · Pick a month) that re-scopes attendance in the Roster table/avg stat and Member Detail (windowed stat + timeline strip + raid log with rows linked to hosted AxiBridge reports).

**Architecture:** Pure renderer lib (`lib/attendanceWindow.ts`, mirroring `lib/retention.ts`) filters the per-raid series already shipped in `RosterPayload.attendance`; `RosterView` owns the `TimeWindow` state and passes it + the series down to `MemberDetail`. Shared-layer changes: `assembleRoster` fetches attendance whenever bridge repos exist (retention toggle keeps gating only the Retention view), and `AxibridgeClient.attendanceRaids()` stamps each raid with its hosted-report URL.

**Tech Stack:** React 18 + TypeScript (electron-vite), Tailwind (project component classes `.seg`, `.field`, `.stat-card`), vitest (node env, pure-lib tests only — no component test harness exists).

**Spec:** `docs/superpowers/specs/2026-08-07-attendance-time-window-design.md`

## Global Constraints

- Tests: `npm test` (already capped at `--pool=forks --poolOptions.forks.maxForks=2`; never raise the cap).
- Typecheck: `npm run typecheck` must pass (`tsc` over `tsconfig.node.json` + `tsconfig.web.json`).
- `RetentionView` and `lib/retention.ts` must not be modified.
- When a guild's repos publish no `attendance.json` (`payload.attendance` empty): zero visual/behavioral diff from today — no strips, rollup-derived numbers everywhere.
- Account matching is lowercase+trimmed, any-of-the-member's-accounts, one raid counts once (same contract as `retention.ts`).
- Timestamps: `Date.parse(raid.date)`; unparseable dates are excluded from all windowing and month lists.
- Work on a feature branch `feat/attendance-time-window` (worktree per superpowers:using-git-worktrees).
- Commit messages follow repo convention `feat(scope): …` with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

---

### Task 1: Stamp hosted-report URLs on attendance raids

**Files:**
- Modify: `src/shared/axibridgeClient.ts` (DTO at lines 62–66, `attendanceRaids()` at lines 117–125, new exported helpers next to `parseAttendanceFile`)
- Modify: `src/preload/index.d.ts:170-174` (DTO mirror)
- Test: `src/shared/axibridgeClient.attendance.test.ts`

**Interfaces:**
- Consumes: existing `RepoRef {owner, repo}`, `AttendanceRaidDTO`, `parseAttendanceFile`.
- Produces: `AttendanceRaidDTO.reportUrl?: string`; `reportUrlFor(repo: RepoRef, raidId: string): string`; `mergeAttendanceRaids(batches: {repo: RepoRef; raids: AttendanceRaidDTO[]}[]): AttendanceRaidDTO[]` (Task 5 reads `reportUrl` off raids in the payload).

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/axibridgeClient.attendance.test.ts` (existing file tests `parseAttendanceFile`; keep it untouched above):

```ts
import { mergeAttendanceRaids, reportUrlFor, type AttendanceRaidDTO, type RepoRef } from './axibridgeClient'

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
```

Also update the existing `import` line at the top of the file to pull the new names from `'./axibridgeClient'` (the test file imports `describe/it/expect` from vitest already).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/shared/axibridgeClient.attendance.test.ts`
Expected: FAIL — `mergeAttendanceRaids`/`reportUrlFor` are not exported.

- [ ] **Step 3: Implement**

In `src/shared/axibridgeClient.ts`, extend the DTO (lines 62–66):

```ts
export interface AttendanceRaidDTO {
  id: string
  date: string
  attendees: { account: string; combatTimeMs: number; squadTimeMs: number }[]
  /** Hosted AxiBridge report page for this raid (Pages /reports/<id>). */
  reportUrl?: string
}
```

Add below `parseAttendanceFile` (after line 88):

```ts
/** Canonical hosted-report page for a raid — AxiBridge's reportApp routes /reports/<id>. */
export function reportUrlFor(repo: RepoRef, raidId: string): string {
  return `https://${repo.owner}.github.io/${repo.repo}/reports/${raidId}`
}

/** Merge per-repo attendance batches: first-repo-wins dedup by raid id, each
 *  raid stamped with its supplying repo's report URL, newest-first by date. */
export function mergeAttendanceRaids(
  batches: { repo: RepoRef; raids: AttendanceRaidDTO[] }[]
): AttendanceRaidDTO[] {
  const byId = new Map<string, AttendanceRaidDTO>()
  for (const { repo, raids } of batches)
    for (const r of raids)
      if (!byId.has(r.id)) byId.set(r.id, { ...r, reportUrl: reportUrlFor(repo, r.id) })
  return [...byId.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)))
}
```

Replace `attendanceRaids()` (lines 117–125) so it delegates to the pure merge:

```ts
  async attendanceRaids(): Promise<AttendanceRaidDTO[]> {
    const batches: { repo: RepoRef; raids: AttendanceRaidDTO[] }[] = []
    for (const repo of this.repos) {
      const data = await this.fetchJson(repo, 'reports/attendance.json').catch(() => null)
      batches.push({ repo, raids: parseAttendanceFile(data) })
    }
    return mergeAttendanceRaids(batches)
  }
```

Mirror the DTO in `src/preload/index.d.ts` (lines 170–174):

```ts
export interface AttendanceRaidDTO {
  id: string
  date: string
  attendees: { account: string; combatTimeMs: number; squadTimeMs: number }[]
  /** Hosted AxiBridge report page for this raid (Pages /reports/<id>). */
  reportUrl?: string
}
```

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `npm test -- src/shared/axibridgeClient.attendance.test.ts && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/axibridgeClient.ts src/shared/axibridgeClient.attendance.test.ts src/preload/index.d.ts
git commit -m "feat(bridge): stamp hosted-report URLs on attendance raids"
```

---

### Task 2: Fetch attendance whenever bridge repos exist

**Files:**
- Modify: `src/shared/roster/assembleRoster.ts:234-241`
- Test: `src/shared/roster/assembleRoster.test.ts` (replace the gating test at line 86; add warning-gating tests)

**Interfaces:**
- Consumes: `deps.attendance(repos)` (unchanged signature), `guild.retentionEnabled`, in-scope `repos` and `warnings`.
- Produces: `payload.attendance` populated for any guild with bridge repos (Tasks 4–5 rely on this).

- [ ] **Step 1: Rewrite the failing tests**

In `src/shared/roster/assembleRoster.test.ts`, replace the whole test `'AxiBridge is best-effort and attendance is gated on retentionEnabled'` (lines 86–99) with:

```ts
test('AxiBridge metrics failure is best-effort; attendance is fetched regardless of retentionEnabled', async () => {
  const d = deps(
    {
      bridgeMetrics: vi.fn(async () => {
        throw new Error('bridge down')
      }),
      attendance: vi.fn(async () => [{ id: 'r1', date: '2026-08-01', attendees: [] }])
    },
    { ...GUILD, bridgeRepos: [{ owner: 'o', repo: 'r' }], retentionEnabled: false }
  )
  const p = await assembleRoster(d)
  expect(p.warnings.some((w) => w.startsWith('AxiBridge metrics unavailable'))).toBe(true)
  expect(d.attendance).toHaveBeenCalled()
  expect(p.attendance).toHaveLength(1)
})

test('attendance fetch is skipped when the guild has no bridge repos', async () => {
  const d = deps({ attendance: vi.fn(async () => []) }, { ...GUILD, bridgeRepos: [] })
  await assembleRoster(d)
  expect(d.attendance).not.toHaveBeenCalled()
})

test('attendance failure warns only for retention-enabled guilds', async () => {
  const boom = (): RosterAssemblyDeps['attendance'] =>
    vi.fn(async () => {
      throw new Error('404')
    })
  const quiet = await assembleRoster(
    deps({ attendance: boom() }, { ...GUILD, bridgeRepos: [{ owner: 'o', repo: 'r' }], retentionEnabled: false })
  )
  expect(quiet.attendance).toEqual([])
  expect(quiet.warnings.some((w) => w.startsWith('Attendance data unavailable'))).toBe(false)

  const loud = await assembleRoster(
    deps({ attendance: boom() }, { ...GUILD, bridgeRepos: [{ owner: 'o', repo: 'r' }], retentionEnabled: true })
  )
  expect(loud.attendance).toEqual([])
  expect(loud.warnings.some((w) => w.startsWith('Attendance data unavailable'))).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -- src/shared/roster/assembleRoster.test.ts`
Expected: FAIL — `d.attendance` not called with `retentionEnabled: false`.

- [ ] **Step 3: Implement**

In `src/shared/roster/assembleRoster.ts`, replace lines 234–241:

```ts
  // Attendance data — only fetched when the guild has opted in via retentionEnabled.
  let attendance: AttendanceRaidDTO[] = []
  if (guild?.retentionEnabled && repos.length > 0) {
    try {
      attendance = await deps.attendance(repos)
    } catch (e) {
      warnings.push(`Attendance data unavailable: ${(e as Error).message}`)
    }
  }
```

with:

```ts
  // Attendance data — fetched whenever bridge repos exist; the retention toggle
  // gates only the Retention view (App.tsx nav + render guards). Failures warn
  // only for opted-in guilds so others aren't nagged about a file their repo
  // may not publish.
  let attendance: AttendanceRaidDTO[] = []
  if (repos.length > 0) {
    try {
      attendance = await deps.attendance(repos)
    } catch (e) {
      if (guild?.retentionEnabled) warnings.push(`Attendance data unavailable: ${(e as Error).message}`)
    }
  }
```

- [ ] **Step 4: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS (RetentionView is double-gated on `retentionEnabled` in `App.tsx:232` and `App.tsx:368`, so no other test/behavior depends on the old gate).

- [ ] **Step 5: Commit**

```bash
git add src/shared/roster/assembleRoster.ts src/shared/roster/assembleRoster.test.ts
git commit -m "feat(roster): fetch attendance whenever bridge repos exist"
```

---

### Task 3: Pure time-window lib

**Files:**
- Create: `src/renderer/src/lib/attendanceWindow.ts`
- Test: `src/renderer/src/lib/attendanceWindow.test.ts`

**Interfaces:**
- Consumes: nothing project-specific (structural types only — works on `AttendanceRaidDTO` without importing it).
- Produces (Tasks 4–5 import all of these from `'../lib/attendanceWindow'`):
  - `type TimeWindow = {kind:'all'} | {kind:'days'; days:30|90} | {kind:'month'; year:number; month:number}`
  - `interface WindowRaid { date: string; attendees: {account: string; combatTimeMs: number; squadTimeMs: number}[] }`
  - `interface WindowedAttendance { attended: number; total: number; pct: number | null }`
  - `filterRaids<T extends {date: string}>(raids: T[], w: TimeWindow, now: number): T[]`
  - `memberAttendance(raids: WindowRaid[], accounts: string[]): WindowedAttendance`
  - `memberEntry(raid: WindowRaid, accounts: string[]): {account: string; combatTimeMs: number; squadTimeMs: number} | null`
  - `availableMonths(raids: {date: string}[]): {year: number; month: number}[]`
  - `monthLabel(year: number, month: number): string`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/lib/attendanceWindow.test.ts`:

```ts
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
      r('2026-06-14'),
      r('2026-08-01'),
      r('2026-08-20'),
      r('2025-12-30'),
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/renderer/src/lib/attendanceWindow.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/attendanceWindow.ts`:

```ts
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
  attendees: { account: string; combatTimeMs: number; squadTimeMs: number }[]
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

/** Windowed attendance for one member across all their GW2 accounts. A raid
 *  counts once no matter how many of the member's accounts attended. */
export function memberAttendance(raids: WindowRaid[], accounts: string[]): WindowedAttendance {
  const accts = accounts.map(lc).filter(Boolean)
  const total = raids.length
  if (accts.length === 0 || total === 0) return { attended: 0, total, pct: null }
  let attended = 0
  for (const r of raids) if (r.attendees.some((a) => accts.includes(lc(a.account)))) attended++
  return { attended, total, pct: Math.round((attended / total) * 100) }
}

/** The member's attendee record in a raid (first matching account), or null. */
export function memberEntry(
  raid: WindowRaid,
  accounts: string[]
): { account: string; combatTimeMs: number; squadTimeMs: number } | null {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/renderer/src/lib/attendanceWindow.test.ts && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/attendanceWindow.ts src/renderer/src/lib/attendanceWindow.test.ts
git commit -m "feat(roster): pure attendance time-window helpers"
```

---

### Task 4: Time-window strip + windowed Roster table/stats

**Files:**
- Create: `src/renderer/src/components/TimeWindowStrip.tsx`
- Modify: `src/renderer/src/components/RosterView.tsx` (imports 21–37; state after line 53; derived memos near 179–196; strip + stat cards 330–336; `MemberTable`/`MemberCards` prop threading 419–440, 541–736; `deriveRow` 461–472; `sortValue` 476–502; `compareBy` 504–522; `StatCard` 524–531; attendance cell 636–647)

No component test harness exists (vitest is node-env, pure libs only) — this task's checks are typecheck + full suite + the manual pass in Task 6.

**Interfaces:**
- Consumes: Task 3's `filterRaids`, `memberAttendance`, `availableMonths`, `monthLabel`, `TimeWindow`, `WindowedAttendance`.
- Produces: `TimeWindowStrip` component with props `{window: TimeWindow; onChange: (w: TimeWindow) => void; raids: {date: string}[]; raidCount: number}` (Task 5 reuses it); `RosterView` state `timeWindow`/`setTimeWindow` and memo `attendanceSeries` (Task 5 passes these to `MemberDetail`).

- [ ] **Step 1: Create `TimeWindowStrip.tsx`**

```tsx
// src/renderer/src/components/TimeWindowStrip.tsx
//
// Time-window filter strip for attendance (Roster + Member Detail). Mirrors
// AxiBridge's rollup strip: preset pills · month picker · raid count.
import { availableMonths, monthLabel, type TimeWindow } from '../lib/attendanceWindow'

const PRESETS: { label: string; window: TimeWindow }[] = [
  { label: 'All time', window: { kind: 'all' } },
  { label: 'Last 30 days', window: { kind: 'days', days: 30 } },
  { label: 'Last 90 days', window: { kind: 'days', days: 90 } }
]

export default function TimeWindowStrip({
  window: win,
  onChange,
  raids,
  raidCount
}: {
  window: TimeWindow
  onChange: (w: TimeWindow) => void
  /** Full (unwindowed) series — used to list the months that have raids. */
  raids: { date: string }[]
  /** Raids inside the current window. */
  raidCount: number
}): JSX.Element {
  const months = availableMonths(raids)
  const monthValue = win.kind === 'month' ? `${win.year}-${win.month}` : ''
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        Time window
      </span>
      <div className="seg">
        {PRESETS.map((p) => {
          const on =
            (p.window.kind === 'all' && win.kind === 'all') ||
            (p.window.kind === 'days' && win.kind === 'days' && win.days === p.window.days)
          return (
            <button
              key={p.label}
              onClick={() => onChange(p.window)}
              className={`seg-item ${on ? 'seg-item-on' : ''}`}
            >
              {p.label}
            </button>
          )
        })}
      </div>
      <select
        value={monthValue}
        onChange={(e) => {
          const [y, m] = e.target.value.split('-').map(Number)
          if (y && m) onChange({ kind: 'month', year: y, month: m })
        }}
        title="Show a single month"
        className={`field h-8 w-auto min-w-[130px] py-0 text-xs ${
          win.kind === 'month' ? 'border-accent/60 text-accent-soft' : ''
        }`}
      >
        <option value="">Pick a month…</option>
        {months.map(({ year, month }) => (
          <option key={`${year}-${month}`} value={`${year}-${month}`}>
            {monthLabel(year, month)}
          </option>
        ))}
      </select>
      <span className="ml-auto text-xs text-ink-faint">
        <span className="font-semibold text-ink-dim">
          {raidCount} raid{raidCount === 1 ? '' : 's'}
        </span>{' '}
        in window
      </span>
    </div>
  )
}
```

Note: selecting a preset while a month is chosen replaces the window, which resets `monthValue` to `''` — presets and the month picker are mutually exclusive by construction.

- [ ] **Step 2: Wire state + derived values into `RosterView`**

Add imports:

```tsx
import TimeWindowStrip from './TimeWindowStrip'
import {
  filterRaids,
  memberAttendance,
  type TimeWindow,
  type WindowedAttendance
} from '../lib/attendanceWindow'
```

After the `sort` state (line 53), add:

```tsx
  // Attendance time window — shared by the table, stat card, and MemberDetail.
  const [timeWindow, setTimeWindow] = useState<TimeWindow>({ kind: 'all' })
```

After `const members = payload?.members ?? []` (line 123), add:

```tsx
  const attendanceSeries = payload?.attendance ?? []
  const hasAttendance = attendanceSeries.length > 0
  const windowedRaids = useMemo(
    () => filterRaids(attendanceSeries, timeWindow, Date.now()),
    // payload identity covers attendanceSeries (fresh [] each render when null)
    [payload, timeWindow] // eslint-disable-line react-hooks/exhaustive-deps
  )
  // Per-member windowed attendance; null when the guild publishes no series —
  // deriveRow/sortValue then fall back to the rollup numbers.
  const windowed = useMemo(() => {
    if (!hasAttendance) return null
    const map = new Map<string, WindowedAttendance>()
    for (const m of members)
      map.set(
        m.annotationKey,
        memberAttendance(
          windowedRaids,
          m.accounts.map((a) => a.account_name)
        )
      )
    return map
  }, [hasAttendance, windowedRaids, payload]) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Thread `windowed` through derive/sort/stats**

`deriveRow` (lines 461–472) becomes:

```tsx
// Derive the display fields the table/cards need from a member + payload
// metrics. When a windowed-attendance map is present it is the single source
// of truth for attendance; otherwise fall back to the rollup aggregate.
function deriveRow(
  member: ReconciledMember,
  metrics: Record<string, BridgePlayerMetrics>,
  windowed: Map<string, WindowedAttendance> | null
) {
  const m = aggregateMemberMetrics(member.accounts, metrics)
  const w = windowed?.get(member.annotationKey)
  const attendance = windowed
    ? (w?.pct ?? null)
    : m && m.raidsConsidered > 0
      ? Math.round((m.raidsAttended / m.raidsConsidered) * 100)
      : null
  return {
    mainClass: m?.mainClass ?? null,
    attendance,
    attendanceFraction: w && w.pct !== null ? `${w.attended}/${w.total}` : null,
    lastSeen: m ? fmtRelative(m.lastSeen) : '—',
    account: member.accounts[0]?.account_name ?? member.discordName ?? '—'
  }
}
```

`sortValue` gains the same fourth parameter `windowed: Map<string, WindowedAttendance> | null` (threaded from `compareBy`), and its `'attendance'` case (line 495–496) becomes:

```tsx
    case 'attendance': {
      if (windowed) {
        const w = windowed.get(member.annotationKey)
        return w && w.pct !== null && w.total > 0 ? w.attended / w.total : null
      }
      return m && m.raidsConsidered > 0 ? m.raidsAttended / m.raidsConsidered : null
    }
```

`compareBy` (lines 504–522) gains `windowed: Map<string, WindowedAttendance> | null` after `rankOrder` and passes it to both `sortValue` calls. The `sorted` memo (lines 191–196) passes `windowed` and adds it to its dep array. The `stats` memo (lines 179–187) switches its `atts` mapping to `deriveRow(m, payload?.metrics ?? {}, windowed)` and adds `windowed` to its deps.

`MemberTable` and `MemberCards` each gain a `windowed: Map<string, WindowedAttendance> | null` prop, pass it to every `deriveRow(m, metrics, windowed)` call inside them, and receive `windowed={windowed}` at their call sites (lines 419–429 and 431–440).

- [ ] **Step 4: Strip + stat card + attendance cell**

Insert the strip between the warnings block (ends line 328) and the stat cards (line 331), and give the cards conditional top padding:

```tsx
          {/* attendance time window */}
          {hasAttendance && (
            <div className="px-4 pt-4">
              <TimeWindowStrip
                window={timeWindow}
                onChange={setTimeWindow}
                raids={attendanceSeries}
                raidCount={windowedRaids.length}
              />
            </div>
          )}

          {/* stat cards */}
          <div className={`grid grid-cols-4 gap-3 px-4 ${hasAttendance ? 'pt-3' : 'pt-4'}`}>
```

`StatCard` (lines 524–531) gains an optional sub-line:

```tsx
function StatCard({ k, v, sub }: { k: string; v: string; sub?: string }): JSX.Element {
  return (
    <div className="stat-card">
      <div className="text-xs font-medium text-ink-faint">{k}</div>
      <div className="mt-1 font-mono text-2xl font-bold text-ink">{v}</div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-faint">{sub}</div>}
    </div>
  )
}
```

The Avg attendance card (line 335) becomes:

```tsx
            <StatCard
              k="Avg attendance"
              v={stats.avgAtt !== null ? `${stats.avgAtt}%` : '—'}
              sub={
                hasAttendance
                  ? `across ${windowedRaids.length} raid${windowedRaids.length === 1 ? '' : 's'}`
                  : undefined
              }
            />
```

The table attendance cell (lines 636–647) gains the fraction:

```tsx
              <div>
                {d.attendance !== null ? (
                  <>
                    <div className="h-1.5 overflow-hidden rounded-full bg-panel-line2">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${d.attendance}%` }} />
                    </div>
                    <div className="mt-1 font-mono text-xs text-ink-dim">
                      {d.attendance}%
                      {d.attendanceFraction && (
                        <span className="text-ink-faint"> ({d.attendanceFraction})</span>
                      )}
                    </div>
                  </>
                ) : (
                  <span className="text-xs text-ink-faint">—</span>
                )}
              </div>
```

(`MemberCards` needs no markup change — its `d.attendance` values switch to windowed automatically.)

- [ ] **Step 5: Verify + commit**

Run: `npm test && npm run typecheck`
Expected: PASS / clean.

```bash
git add src/renderer/src/components/TimeWindowStrip.tsx src/renderer/src/components/RosterView.tsx
git commit -m "feat(roster): time-window strip re-scopes table + avg attendance"
```

---

### Task 5: Member Detail — windowed stat, timeline, linked raid log

**Files:**
- Modify: `src/renderer/src/components/RosterView.tsx:303-315` (pass new props)
- Modify: `src/renderer/src/components/MemberDetail.tsx` (imports 1–19; props 21–44; derived state near 74–76; strip after the sticky header; Attendance `Stat` swap at 258–262; new Fields after the `WvW activity (AxiBridge)` Field closes at ~337; new components at file bottom)

**Interfaces:**
- Consumes: Task 3's `filterRaids`/`memberAttendance`/`memberEntry`/`TimeWindow`; Task 4's `TimeWindowStrip` + `timeWindow` state + `attendanceSeries`; Task 1's `raid.reportUrl`; existing `client.openExternal(url: string): Promise<void>` (`preload/index.d.ts:393`, implemented by both Electron and web clients) and `fmtDuration` (already imported).
- Produces: final user-facing feature; no downstream consumers.

- [ ] **Step 1: Pass the props from `RosterView`**

In the `<MemberDetail …>` invocation (lines 303–315), add:

```tsx
          attendanceSeries={attendanceSeries}
          timeWindow={timeWindow}
          onTimeWindowChange={setTimeWindow}
```

(The prop is named `attendanceSeries`, NOT `attendance` — MemberDetail already has a local `const attendance` holding the rollup percentage at line 75; do not collide with it.)

- [ ] **Step 2: Extend `MemberDetail` props + imports + derived state**

Imports: add `ExternalLink` to the lucide import (line 2); add:

```tsx
import type { AttendanceRaidDTO } from '../../../preload/index.d'
import TimeWindowStrip from './TimeWindowStrip'
import {
  filterRaids,
  memberAttendance,
  memberEntry,
  type TimeWindow
} from '../lib/attendanceWindow'
```

(`AttendanceRaidDTO` joins the existing `import type` list from `'../../../preload/index.d'`.)

Props (add to the destructuring + type at lines 21–44):

```tsx
  attendanceSeries: AttendanceRaidDTO[]
  timeWindow: TimeWindow
  onTimeWindowChange: (w: TimeWindow) => void
```

Below the existing `const attendance = …` (line 75–76), add:

```tsx
  const accountNames = member.accounts.map((a) => a.account_name)
  const hasSeries = attendanceSeries.length > 0
  const windowedRaids = useMemo(
    () => filterRaids(attendanceSeries, timeWindow, Date.now()),
    [attendanceSeries, timeWindow]
  )
  const windowedAtt = useMemo(
    () => memberAttendance(windowedRaids, accountNames),
    [windowedRaids, member] // eslint-disable-line react-hooks/exhaustive-deps
  )
```

- [ ] **Step 3: Strip under the sticky header + windowed Attendance stat**

Immediately after the sticky top-bar `<div>` closes (the one holding the `‹ Roster` button and prev/next arrows), insert:

```tsx
      {hasSeries && (
        <div className="border-b border-panel-line bg-panel-sunk/60 px-4 py-2">
          <TimeWindowStrip
            window={timeWindow}
            onChange={onTimeWindowChange}
            raids={attendanceSeries}
            raidCount={windowedRaids.length}
          />
        </div>
      )}
```

Replace the Attendance `Stat` value (lines 258–262):

```tsx
                <Stat
                  icon={<img src={axibridgeLogo} alt="" className="h-3.5 w-3.5" />}
                  label="Attendance"
                  value={
                    hasSeries
                      ? windowedAtt.pct !== null
                        ? `${windowedAtt.pct}% (${windowedAtt.attended}/${windowedAtt.total})`
                        : '—'
                      : attendance !== null
                        ? `${attendance}% (${m.raidsAttended}/${m.raidsConsidered})`
                        : '—'
                  }
                />
```

- [ ] **Step 4: Timeline + raid log Fields**

After the `WvW activity (AxiBridge)` `</Field>` (line ~337, right before the `Discord roles` Field), insert:

```tsx
          {hasSeries && (
            <Field label="Attendance timeline">
              <AttendanceTimeline raids={windowedRaids} accounts={accountNames} />
            </Field>
          )}

          {hasSeries && (
            <Field label="Raid log">
              <RaidLog raids={windowedRaids} accounts={accountNames} />
            </Field>
          )}
```

At the bottom of the file (next to the existing `Mini`/`Field`/`Stat` helpers), add:

```tsx
const fmtDay = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const fmtWeekday = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, { weekday: 'short' })

const TIMELINE_CAP = 40

function AttendanceTimeline({
  raids,
  accounts
}: {
  raids: AttendanceRaidDTO[]
  accounts: string[]
}): JSX.Element {
  if (raids.length === 0) return <div className="text-sm text-ink-faint">No raids in this window.</div>
  // raids arrive newest-first; render oldest→newest left→right
  const chrono = [...raids].reverse()
  const shown = chrono.slice(-TIMELINE_CAP)
  const earlier = chrono.length - shown.length
  return (
    <div>
      <div className="flex items-end gap-[3px]">
        {shown.map((r) => {
          const ts = Date.parse(r.date)
          const went = memberEntry(r, accounts) !== null
          return (
            <span
              key={r.id}
              title={`${Number.isNaN(ts) ? r.date : fmtDay(ts)} — ${went ? 'attended' : 'missed'}`}
              className="w-[6px] rounded-sm"
              style={{ height: went ? 24 : 8, background: went ? '#10b981' : '#3a3a40' }}
            />
          )
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-ink-faint">
        <span>
          {earlier > 0
            ? `+${earlier} earlier`
            : shown[0]
              ? fmtDay(Date.parse(shown[0].date))
              : ''}
        </span>
        <span>newest →</span>
      </div>
    </div>
  )
}

function RaidLog({
  raids,
  accounts
}: {
  raids: AttendanceRaidDTO[]
  accounts: string[]
}): JSX.Element {
  if (raids.length === 0) return <div className="text-sm text-ink-faint">No raids in this window.</div>
  const rowCls = 'flex w-full items-center gap-2.5 border-b border-panel-line/60 px-3 py-2 last:border-0'
  return (
    <div className="max-h-64 overflow-y-auto rounded-md border border-panel-line">
      {raids.map((r) => {
        const ts = Date.parse(r.date)
        const entry = memberEntry(r, accounts)
        const cells = (
          <>
            <span className="w-24 shrink-0 font-mono text-xs text-ink">
              {Number.isNaN(ts) ? r.date : fmtDay(ts)}
            </span>
            <span className="w-9 shrink-0 text-xs text-ink-faint">
              {Number.isNaN(ts) ? '' : fmtWeekday(ts)}
            </span>
            {entry ? (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent-soft">
                ✓ Attended
              </span>
            ) : (
              <span className="rounded-full bg-panel-line/40 px-2 py-0.5 text-[11px] font-semibold text-ink-faint">
                — Missed
              </span>
            )}
            <span className="ml-auto font-mono text-[11px] text-ink-dim">
              {entry ? `${fmtDuration(entry.combatTimeMs)} combat · ${fmtDuration(entry.squadTimeMs)} squad` : ''}
            </span>
            {r.reportUrl && <ExternalLink size={12} className="shrink-0 text-ink-faint" />}
          </>
        )
        return r.reportUrl ? (
          <button
            key={r.id}
            onClick={() => void client.openExternal(r.reportUrl!)}
            title="Open the AxiBridge report for this raid"
            className={`${rowCls} text-left transition hover:bg-panel-hover`}
          >
            {cells}
          </button>
        ) : (
          <div key={r.id} className={rowCls}>
            {cells}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 5: Verify + commit**

Run: `npm test && npm run typecheck`
Expected: PASS / clean.

```bash
git add src/renderer/src/components/RosterView.tsx src/renderer/src/components/MemberDetail.tsx
git commit -m "feat(roster): member detail windowed stat, timeline, linked raid log"
```

---

### Task 6: Full verification + manual pass

**Files:** none created; fixes fold back into the task that owns them.

- [ ] **Step 1: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 2: Manual pass in the running app**

Run: `npm run dev`, then verify against the spec:

1. Guild WITH attendance data: strip appears above the roster stat cards; switching All time / 30d / 90d / a month changes the Attendance column, its `(n/m)` fractions, the sort order, the Avg attendance card + `across N raids` subtext, and the strip's raid count.
2. Sorting by Attendance with a window active orders by the windowed fraction; members with no data sink to the bottom.
3. Open a member: strip visible under the header, same selection; change it there, go back — the roster keeps the changed window (shared state).
4. Member detail shows windowed `X% (n/m)` stat, timeline bars matching the raid log's attended/missed pattern (hover a bar → date), raid log newest-first with combat·squad times.
5. Click a raid row → the hosted AxiBridge report opens in the browser at `…github.io/<repo>/reports/<id>`.
6. Pick a month with no raids for that member's guild → `No raids in this window.` placeholders, `—` stats.
7. Guild WITHOUT attendance data (or temporarily point at a repo with none): no strips anywhere, roster/detail attendance identical to current release behavior.
8. Retention view (retention-enabled guild): unchanged — still 14-day model, unaffected by strip selection.

- [ ] **Step 3: Update memory/docs if behavior diverged from spec**

If any manual check forced an implementation change, note it in the spec's Decisions log and re-commit.

---

## Self-review (done at authoring time)

- **Spec coverage:** data layer §1→Task 2, §2→Task 1; pure lib→Task 3; roster §→Task 4; member detail §→Task 5; edge cases→Tasks 3–5 code + Task 6 checks 6–7; testing §→Tasks 1–3 tests, Task 6 manual list.
- **Placeholder scan:** none — every step carries exact code/commands.
- **Type consistency:** `TimeWindow`/`WindowedAttendance`/`WindowRaid` names match across Tasks 3–5; `attendanceSeries` prop naming avoids the `attendance` local collision in MemberDetail (called out in Task 5 Step 1); `TimeWindowStrip` prop shape identical at both call sites.
