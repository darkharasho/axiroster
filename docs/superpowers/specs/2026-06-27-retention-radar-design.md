# Retention Radar — Design (Wave 2)

**Date:** 2026-06-27
**Status:** Approved (pending spec review)
**Spans two repos:** AxiBridge (producer) + AxiRoster (consumer), contract-first.

## Goal

Give leadership a churn-prevention dashboard: a dedicated **Retention** view ranking
members by a transparent, tag-weighted **risk score (0–100)** computed from real
per-raid attendance time-series, with human-readable reasons and one-click bulk-tag
of at-risk members. Enabled per guild in guild settings.

## Non-Goals

- No trained ML model in v1. The model is a transparent weighted composite. (Score
  logging is added now so a future trained model — using Guild Log departures as
  labels — is an upgrade, not a rewrite.)
- No "reached out / contacted" tracking in v1 (surface + bulk-tag only).
- No change to AxiBridge's rollup/index artifacts; we add a NEW `attendance.json`
  artifact alongside them.
- No new Supabase schema. Score history is local-only.

## Decomposition & Contract (contract-first)

Two implementation plans after this shared spec:
1. **AxiBridge producer plan** — emit `reports/attendance.json`.
2. **AxiRoster consumer plan** — fetch + model + UI + per-guild toggle.

The AxiRoster side is built and unit-tested against a **JSON fixture** of the
contract, so it does not block on the producer shipping. They meet at:

**`reports/attendance.json` (versioned):**
```jsonc
{
  "version": 1,
  "generatedAt": "2026-06-27T00:00:00Z",
  "raids": [
    {
      "id": "raid-2026-06-24-…",
      "date": "2026-06-24T01:30:00Z",        // raid start (meta.dateStart)
      "attendees": [
        { "account": "Account.1234", "combatTimeMs": 1234567, "squadTimeMs": 2345678 }
      ]
    }
    // one per raid; most-recent-first; pruned to valid (non-deleted) report ids
  ]
}
```
The artifact is deliberately dumb — per-raid facts only. ALL window/trend/score logic
lives in AxiRoster, so changing the model never requires re-shipping AxiBridge. The
artifact is versioned; new fields can be added later.

## AxiBridge Producer (repo: ../axibridge)

The data already exists at publish time (per raid: `meta.id`, `meta.dateStart`, and
`stats.attendanceData[].account` + `combatTimeMs` + `squadTimeMs`).

- **New `packages/bridge-metrics/src/attendance.ts`** (follows the existing
  `rollup.ts` builder/extractor pattern):
  - `buildAttendanceRecord(report: RollupReportPayload): AttendanceRaid | null` —
    projects one raid to `{ id, date, attendees: [{account, combatTimeMs, squadTimeMs}] }`;
    returns null when there is no attendance data.
  - `updateAttendanceHistoryForPublish({ existingRaids, currentReport, validIds })
    : AttendanceFile` — merges the just-published raid into the existing history,
    de-dupes by raid id, drops raids whose id is not in `validIds` (mirrors rollup's
    deletion handling), sorts most-recent-first.
  - Types `AttendanceRaid`, `AttendanceFile { version: 1; generatedAt; raids }`.
  - Exported from the `bridge-metrics` package (new `./attendance` export entry).
- **Publish integration** in `src/main/handlers/githubHandlers.ts` next to the rollup
  write (~line 1904): read existing `reports/attendance.json` blob, call
  `updateAttendanceHistoryForPublish`, `queueFile('reports/attendance.json', …)` so it
  rides the same git tree/commit/push. Non-blocking: a failure logs a warning and does
  not abort the publish (mirrors the rollup try/catch).
- **Deletion**: when reports are deleted, the next publish's `validIds` prune removes
  their raids; optionally mirror the rollup path in the `delete-github-reports` handler.
- **Tests**: `packages/bridge-metrics/src/__tests__/attendance.test.ts` (vitest):
  build from a report payload, merge/de-dupe by id, prune by validIds, empty-attendance
  → null, sort order.

## AxiRoster Consumer (repo: this repo)

### Fetch / parse
- Extend `src/main/axibridgeClient.ts` to also fetch `reports/attendance.json` from
  each configured `bridgeRepo` (alongside the existing `reports/rollup.json` fetch),
  parse defensively (corrupt/missing → empty), and merge raids across repos de-duped by
  id. Skip the fetch entirely when the guild's retention toggle is off (see below).
- Expose the merged raid list to the renderer through the roster build payload (a new
  `attendance` field) — only populated when retention is enabled for the active guild.

### `src/renderer/src/lib/retention.ts` (pure, node-tested)
Given `{ raids, members, registry/tags, config, now }` → `RetentionResult[]`.

- Per member, aggregate across their GW2 accounts (reuse the account→member mapping
  the roster already has). A raid counts as "attended" if any of the member's accounts
  is in that raid's attendees.
- **Windows:** recent = last 14 days; prior = the 14 days before that (config).
- **Signals** (each normalized to a 0..1 risk contribution):
  - `attendanceRisk = 1 − recentRate` where `recentRate = attendedRecent / raidsRecent`.
  - `decayRisk` = positive drop from `priorRate` to `recentRate`, scaled (no penalty for
    improvement).
  - `streakRisk = min(absenceStreak / STREAK_FULL, 1)` — consecutive most-recent raids
    missed (`STREAK_FULL` default 6).
  - `staleRisk = min(daysSinceLastAttended / STALE_FULL_DAYS, 1)` (default 21).
  - `engagementRisk` (secondary) = `1 − clamp(avg combatTimeMs/squadTimeMs in recent
    attended raids, 0, 1)`; 0 when no recent attendance data.
- **Composite:** `raw = Σ weight_i · risk_i` (default weights: attendance .30, decay
  .25, streak .20, stale .15, engagement .10), then a **tag importance multiplier**
  (e.g. `core`/`commander` ×1.25, `trial` ×0.85, default 1.0; configurable map),
  clamped to 0..100.
- **Tiers:** `at-risk ≥ 60`, `watch 35–59`, else `healthy` (config thresholds).
- **Reasons:** top 2–3 dominant contributing signals rendered as short strings
  ("missed last 6", "80%→0%", "low engagement", plus the importance tag if it moved the
  score).
- **Eligibility:** members with too little history (fewer than `MIN_RAIDS_IN_WINDOW`
  raids in the lookback, or no tracked account) → `tier: 'insufficient-data'`, excluded
  from at-risk/watch counts. Members not on the current roster (left) are not scored.
- All weights/windows/thresholds live in one exported `DEFAULT_RETENTION_CONFIG` object.

### Score logging (seed for a future model)
- A local store `src/main/retentionHistory.ts` writing
  `userData/retentionHistory.json` (atomic tmp+rename, capped, corrupt-safe — mirror
  `rosterStore`/`auditStore` patterns). On each retention compute, append a dated
  snapshot per member `{ date, memberKey, score, tier, signals }`, **de-duped by
  (date, memberKey)** so there is at most one snapshot per member per calendar day
  (a later compute the same day overwrites that day's row).
- **Local-only, not synced.** Purpose: pair these snapshots with Guild Log departure
  events later to train a real model. Not consumed by v1's prediction.

### Per-guild enable toggle
- Add `retentionEnabled: boolean` to `GuildProfile` (`src/main/guildStore.ts`) and its
  `src/preload/index.d.ts` mirror; surface in `GuildSummary`. Default **false**
  (opt-in) — keeps the feature dark until a guild's AxiBridge is emitting
  `attendance.json`, and avoids an empty/confusing view.
- A toggle in `src/renderer/src/components/GuildSettings.tsx`, near the WvW report
  repos config, persisted via the existing `guilds:upsert` IPC.
- When **off** for the active guild: the **Retention** nav entry is hidden, the
  attendance fetch is skipped, and no scores are computed/logged. When **on** but no
  `attendance.json` is available yet: the view shows an explanatory empty state ("No
  attendance data yet — check your AxiBridge report repo").

### UI — Retention view
- New top-level nav entry **Retention** (alongside Roster / Guild Log), gated by
  `retentionEnabled`. New `src/renderer/src/components/RetentionView.tsx`.
- Layout (approved mock): summary tier counts (at-risk / watch / healthy), filter pills,
  a ranked list sorted by score desc — each row: select checkbox, member (avatar +
  name + key + importance tag), risk score, tier badge, a "last N raids" sparkline
  (filled = attended, stub = missed), reasons chips, days-since-last. Read-only members
  see no checkboxes.
- Click a row → existing member detail. Multi-select → reuse the Wave-1 `SelectionBar`
  to bulk-tag (e.g. one-click `Tag "at-risk"`). The recent-attendance sparkline is a
  small presentational component fed by `retention.ts` output.

## Error Handling & Edge Cases

- Missing/corrupt `attendance.json` → treated as no raids; view shows the empty state;
  never throws (mirrors `axibridgeClient` rollup parsing).
- A member with accounts but zero raids in the lookback → `insufficient-data`.
- Guild raids exist but a member joined mid-window → scored on the raids since they
  could have attended only if `raidsRecent ≥ MIN_RAIDS_IN_WINDOW`; else insufficient.
- Account-on-two-raids same day / multi-account members → "attended" is the union across
  accounts per raid id (no double counting).
- Toggle off mid-session → nav entry and data disappear on next roster build.
- Score history file corrupt → reset to empty, never throws; logging is best-effort.

## Testing

- **AxiBridge** `attendance.test.ts`: build/merge/prune/sort/empty (fixtures).
- **AxiRoster** `retention.test.ts` (node, the core): window split, recentRate/decay,
  absence streak, days-since-last, engagement, composite weighting, tag importance
  multiplier ordering (slipping core > slipping trial at equal raw), tier thresholds,
  insufficient-data, multi-account union, reason generation. Run with `--maxWorkers=2`.
- `retentionHistory.ts`: append + cap + corrupt-safe (node).
- `axibridgeClient` attendance parse: corrupt/missing safety (node).
- UI (`RetentionView`, sparkline, GuildSettings toggle): typecheck + build + manual,
  per repo convention (no DOM unit harness).

## Rollout / Compatibility

- AxiBridge change is additive (new file); old AxiRoster clients ignore it.
- AxiRoster: feature is dark by default (per-guild opt-in); enabling with no
  `attendance.json` shows a graceful empty state. No Supabase/schema changes.
- Ship order: AxiBridge producer first (so data starts accruing), then AxiRoster
  consumer; but the consumer can be developed/tested against the fixture in parallel.
