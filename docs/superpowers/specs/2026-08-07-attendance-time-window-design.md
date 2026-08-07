# Attendance Time Window — Design

**Date:** 2026-08-07
**Status:** Approved (design), pending implementation plan

## Summary

The Roster view and Member Detail gain a **time-window filter strip** — All
time · Last 30 days · Last 90 days · Pick a month — that re-scopes attendance
numbers from the per-raid series in `reports/attendance.json`, which already
ships in the roster payload (`RosterPayload.attendance`). Today those numbers
come exclusively from `rollup.json`'s pre-baked aggregate and cannot be
re-windowed; the per-raid series can be, entirely client-side.

Member Detail additionally gains an **attendance timeline strip**
(attended/missed bars) and a **raid log** — one row per raid in the window,
each linked to its hosted AxiBridge report page.

The presets, strip layout, and month picker mirror AxiBridge's rollup
time-window filter (branch `feature/rollup-time-window`, unmerged) so the two
apps stay muscle-memory compatible. Code is not shared — the data shapes
differ; only the UX contract is mirrored.

Approved mock: rendered 2026-08-07 in-session (roster strip + windowed table;
member detail stat/timeline/raid-log).

## Goals

- Filter attendance by date at guild level (table column, sort, avg stat) and
  member level (stat, timeline, per-raid log).
- Every raid-log row links to its hosted AxiBridge report.
- Guilds whose repos don't publish `attendance.json` see today's behavior
  unchanged — no strip, rollup numbers.
- Windowed and unwindowed displays never disagree: when the series exists it
  is the single source of truth for every attendance number on screen.

## Non-goals

- **RetentionView is untouched.** Its 14-day recent-vs-prior windows are the
  churn model's semantics, not a display preference.
- No AxiBridge/producer changes; no new payload fields except an optional
  `reportUrl` on `AttendanceRaidDTO`.
- No persistence of the selected window (session-only state, defaults to All
  time).
- No arbitrary start/end date-range picker (presets + month only).
- No dedicated web work: `RosterView`/`MemberDetail` are shared components
  behind the Phase-2a client seam, and `AxibridgeClient` is shared, so the web
  app inherits the feature. Web-specific verification happens at release
  smoke-test, not in this pass.

## Data layer

Two changes, both in shared code (desktop and web inherit):

1. **Un-gate the fetch** (`src/shared/roster/assembleRoster.ts`). Attendance
   is currently fetched only when `guild.retentionEnabled`. New rule: fetch
   whenever `repos.length > 0`. The `Attendance data unavailable: …` warning
   is pushed **only when `retentionEnabled`** — a guild that never opted into
   anything doesn't see noise about a file it may not publish; a fetch failure
   otherwise degrades silently to `[]` (→ no strip). The retention toggle
   returns to meaning exactly one thing: show the Retention view.

2. **Stamp report URLs** (`src/shared/axibridgeClient.ts`).
   `attendanceRaids()` merges raids across repos first-repo-wins; while
   merging, stamp each raid with
   `reportUrl = https://<owner>.github.io/<repo>/reports/<id>` built from the
   repo that supplied it. This is the canonical hosted-report path —
   AxiBridge's `reportApp.tsx` routes on `/reports/<id>`. `AttendanceRaidDTO`
   (shared + `preload/index.d.ts` copies) gains `reportUrl?: string`;
   consumers treat it as optional and render unlinked rows when absent.

## Pure lib — `src/renderer/src/lib/attendanceWindow.ts`

Same pattern as `lib/retention.ts`: pure, no React/DOM, node-testable.

```ts
export type TimeWindow =
  | { kind: 'all' }
  | { kind: 'days'; days: 30 | 90 }
  | { kind: 'month'; year: number; month: number } // month 1–12, local time

export interface WindowedAttendance {
  attended: number
  total: number
  pct: number | null // null when total === 0 or no accounts
}

export function filterRaids(raids: AttendanceRaidDTO[], w: TimeWindow, now: number): AttendanceRaidDTO[]
export function memberAttendance(raids: AttendanceRaidDTO[], accounts: string[]): WindowedAttendance
export function availableMonths(raids: AttendanceRaidDTO[]): { year: number; month: number }[]
```

Rules:

- Raid timestamps come from `Date.parse(raid.date)`; unparseable dates are
  excluded from windowing and from `availableMonths` (mirrors `retention.ts`).
- `days` windows are rolling: include raids with `ts >= now - days·86400000`
  and `ts <= now`.
- `month` windows are local calendar months: `[monthStart, nextMonthStart)`.
- Account matching is lowercase-trimmed, any-account-of-member, one raid
  counts once regardless of how many of the member's accounts attended
  (same matching contract as `retention.ts`).
- `availableMonths` returns newest-first, only months containing ≥ 1 raid.

## Roster view

- `RosterView` owns `useState<TimeWindow>` (default `{kind:'all'}`).
- The strip renders only when `payload.attendance.length > 0`. It sits above
  the stat cards: `TIME WINDOW` label · segmented presets (`.seg` component
  style) · month `<select>` (populated from `availableMonths`, selecting one
  switches the window to that month; presets deselect it) · right-aligned
  `N raids in window`.
- A `useMemo` derives `windowedRaids` and a per-member map
  `Map<annotationKey, WindowedAttendance>`.
- When the series exists, the **Attendance column, its sort comparator, and
  the Avg attendance stat card** all read from that map (fraction `n/m`
  rendered under the bar; avg card gains `across N raids` subtext). When it
  doesn't, all three fall back to today's rollup-derived values — the
  fallback is the existing `deriveRow` path, not a reimplementation.
- Rows with `pct === null` show `—` and sink to the bottom on sort (existing
  null contract in `compareBy`).

## Member detail

- New props from `RosterView`: `attendance` (the full series), `window`,
  `onWindowChange`. The strip renders here too — same shared state, so the
  window survives navigation in/out and can be adjusted from either place.
- **Attendance stat**: windowed `pct% (attended/total)`; when the series is
  empty, falls back to the rollup number exactly as today.
- **Timeline strip**: one bar per raid in the window, oldest→newest
  left→right; attended = tall emerald (`accent-soft`), missed = short
  `panel-line2` gray (the dual height+color encoding RetentionView already
  uses; validated CVD ΔE 34.8). Hover shows the raid date. Windows larger
  than 40 raids render the most recent 40 plus a `+N earlier` note — the raid
  log below carries the full set.
- **Raid log**: scrollable list, newest first — date · weekday ·
  Attended/Missed pill · `combat · squad` hours (attended rows only). Rows
  with `reportUrl` are clickable and open via `client.openExternal(url)`
  (Electron: `shell.openExternal`; web: noopener tab), with an external-link
  affordance; rows without render unlinked.
- Rollup-based stats (KDR, commander stats, last seen, etc.) are untouched.

## Edge cases

- **No attendance series** → no strips anywhere, rollup numbers, zero visual
  diff from today.
- **Empty window** (e.g. a month with raids filtered out, or 30 days of
  inactivity) → table column and avg card show `—` with `0 raids in window`;
  member detail timeline/log show a `No raids in this window` placeholder.
- **Member with no linked accounts** → `—`, never `0%`.
- **Clock skew / future-dated raids**: `days` windows use `ts <= now`; a
  future-dated raid is excluded from rolling windows but appears in All time
  and its calendar month.

## Testing

`vitest --maxWorkers=2` per global config.

- **`attendanceWindow.test.ts`** (new, mirrors `retention.test.ts` style):
  window boundary inclusion at exact edges; month windows across a year
  boundary; multi-account members counted once per raid; unparseable dates
  excluded; `availableMonths` ordering and dedup; `pct` null contracts.
- **`axibridgeClient.attendance.test.ts`** (extend): `reportUrl` stamped from
  the supplying repo; first-repo-wins keeps the first repo's URL.
- **`assembleRoster.test.ts`** (extend): attendance fetched without
  `retentionEnabled`; warning pushed only when `retentionEnabled`; fetch
  failure without the toggle produces `[]` and no warning.
- Component behavior (strip hidden without data, fallback numbers, link
  invocation) — covered by pure-lib factoring where possible; the rest
  verified manually in the running app before release.

## Decisions log

| Decision | Choice |
|---|---|
| Scope | AxiRoster only (AxiBridge branch merge is separate work) |
| Surfaces | Roster + Member Detail; Retention untouched |
| Fetch gating | Decoupled from retention toggle |
| Presets | Mirror AxiBridge: All time / 30d / 90d / month picker |
| Member detail depth | Stat + timeline + raid log (all three) |
| Raid rows | Linked to hosted report pages |
| Window state | Shared `RosterView` state, strip visible in both views, session-only |
