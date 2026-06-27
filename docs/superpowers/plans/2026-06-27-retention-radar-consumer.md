# Retention Radar — AxiRoster Consumer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consume `reports/attendance.json`, compute a transparent tag-weighted churn-risk score per member from per-raid time-series, and surface a dedicated, per-guild-toggleable Retention view with bulk-tag of at-risk members.

**Architecture:** A pure node-tested `retention.ts` does all window/decay/streak/engagement math → score + tier + reasons. `AxibridgeClient` gains an attendance fetch; `buildRoster` includes the raids in its payload only when the guild's `retentionEnabled` toggle is on. A new `RetentionView` renders the ranked list, reusing the Wave-1 `SelectionBar`/`bulkTags`. A local `retentionHistory` store logs daily scores to seed a future trained model.

**Tech Stack:** Electron + React 18 + TS, Tailwind (dark/emerald), lucide-react, Vitest (node env, `src/**/*.test.ts`, `--maxWorkers=2`). Shared design: `docs/superpowers/specs/2026-06-27-retention-radar-design.md`. Contract fixture from the producer: `../axibridge/docs/superpowers/attendance-fixture.json`.

## Global Constraints

- Attendance contract (consumed): `{ version, generatedAt, raids: [{ id, date, attendees: [{ account, combatTimeMs, squadTimeMs }] }] }`. Parse defensively — missing/corrupt/wrong-version → empty raid list, never throw.
- Pure libs (`retention.ts`) are `.ts` with no React/DOM imports (vitest node env, `src/**/*.test.ts` only). UI `.tsx` gated by typecheck + build + manual (no DOM harness).
- Model windows: recent = last **14 days**, prior = the 14 days before (config). Tiers: `at-risk ≥ 60`, `watch 35–59`, else `healthy`; `insufficient-data` when `< MIN_RAIDS_IN_WINDOW` raids in lookback or no tracked account. All weights/windows/thresholds in one exported `DEFAULT_RETENTION_CONFIG`.
- A member "attended" a raid if ANY of their accounts is in that raid's attendees (union, no double-count).
- Per-guild `retentionEnabled` (default **false**): when off, hide the Retention nav tab, skip the attendance fetch, compute/log nothing. When on with no data, show a graceful empty state.
- Tag matching case-insensitive; reuse `tagRegistry.ts`, `bulkTags.ts`, `SelectionBar.tsx`, `upsertAnnotation` from Wave 1. Score history is local-only (no Supabase).
- `toast` from `../lib/toast`.

---

### Task 1: `retention.ts` — the model (pure, node-tested)

**Files:**
- Create: `src/renderer/src/lib/retention.ts`
- Test: `src/renderer/src/lib/retention.test.ts`

**Interfaces:**
- Produces:
  - `interface AttendanceRaid { id: string; date: string; attendees: { account: string; combatTimeMs: number; squadTimeMs: number }[] }`
  - `interface RetentionMemberInput { annotationKey: string; accounts: string[]; tags: string[] }`
  - `type RetentionTier = 'at-risk' | 'watch' | 'healthy' | 'insufficient-data'`
  - `interface RetentionSignals { recentRate: number | null; priorRate: number | null; decay: number; absenceStreak: number; daysSinceLast: number | null; engagement: number | null; raidsRecent: number; attendedRecent: number }`
  - `interface RetentionResult { memberKey: string; score: number; tier: RetentionTier; reasons: string[]; signals: RetentionSignals; timeline: boolean[] }` (`timeline` = most-recent-first attendance over the last `TIMELINE_RAIDS` raids)
  - `interface RetentionConfig { recentWindowDays; priorWindowDays; streakFull; staleFullDays; minRaidsInWindow; timelineRaids; weights: { attendance; decay; streak; stale; engagement }; tagImportance: Record<string,number>; defaultImportance; tiers: { atRisk; watch } }`
  - `const DEFAULT_RETENTION_CONFIG: RetentionConfig`
  - `computeRetention(input: { raids: AttendanceRaid[]; members: RetentionMemberInput[]; now: number; config?: RetentionConfig }): RetentionResult[]` (sorted by score desc)

- [ ] **Step 1: Write the failing test**

```ts
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

  it('unions attendance across a member’s accounts (no double count)', () => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/lib/retention.test.ts`
Expected: FAIL — cannot find module `./retention`.

- [ ] **Step 3: Write the implementation**

```ts
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
  defaultImportance: 1
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/lib/retention.test.ts`
Expected: PASS. If the steady-attendee assertions are off, re-check the window cut math against the fixture comments (recent ≤14d, prior 14–28d) — the test data is constructed to make `aldous` 100%/healthy and `eternal` 0%-recent/at-risk.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/retention.ts src/renderer/src/lib/retention.test.ts
git commit -m "feat(retention): tag-weighted churn-risk model"
```

---

### Task 2: Attendance fetch in `AxibridgeClient`

**Files:**
- Modify: `src/main/axibridgeClient.ts`
- Test: `src/main/axibridgeClient.attendance.test.ts`

**Interfaces:**
- Produces (on `AxibridgeClient`): `attendanceRaids(): Promise<AttendanceRaidDTO[]>` and exported `interface AttendanceRaidDTO { id: string; date: string; attendees: { account: string; combatTimeMs: number; squadTimeMs: number }[] }`, plus `parseAttendanceFile(data: unknown): AttendanceRaidDTO[]` (exported, defensive: bad/version-mismatch → `[]`).
- Consumes: existing `private fetchJson(repo, relPath)`, `repos` list.

- [ ] **Step 1: Write the failing test (parser)**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/axibridgeClient.attendance.test.ts`
Expected: FAIL — `parseAttendanceFile` is not exported.

- [ ] **Step 3: Implement parser + fetch method**

In `src/main/axibridgeClient.ts`, add near the other exported interfaces:
```ts
export interface AttendanceRaidDTO {
  id: string
  date: string
  attendees: { account: string; combatTimeMs: number; squadTimeMs: number }[]
}

/** Defensive parse of reports/attendance.json (v1). Bad/missing → []. */
export function parseAttendanceFile(data: unknown): AttendanceRaidDTO[] {
  const c = data as { version?: unknown; raids?: unknown } | null
  if (!c || typeof c !== 'object' || c.version !== 1 || !Array.isArray(c.raids)) return []
  const out: AttendanceRaidDTO[] = []
  for (const r of c.raids as any[]) {
    const id = String(r?.id || '').trim()
    if (!id || !Array.isArray(r?.attendees)) continue
    out.push({
      id,
      date: String(r?.date || ''),
      attendees: (r.attendees as any[]).map((a) => ({
        account: String(a?.account || ''),
        combatTimeMs: Number(a?.combatTimeMs || 0),
        squadTimeMs: Number(a?.squadTimeMs || 0)
      })).filter((a) => a.account)
    })
  }
  return out
}
```
Add a method on the `AxibridgeClient` class (mirror `playerMetrics`'s repo loop; merge de-duped by raid id across repos):
```ts
  async attendanceRaids(): Promise<AttendanceRaidDTO[]> {
    const byId = new Map<string, AttendanceRaidDTO>()
    for (const repo of this.repos) {
      const data = await this.fetchJson(repo, 'reports/attendance.json').catch(() => null)
      for (const raid of parseAttendanceFile(data)) if (!byId.has(raid.id)) byId.set(raid.id, raid)
    }
    return [...byId.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)))
  }
```
(Confirm the private repo list field name — it is the constructor arg used by `playerMetrics`; reuse the same `this.repos`/`this.<field>`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/axibridgeClient.attendance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/axibridgeClient.ts src/main/axibridgeClient.attendance.test.ts
git commit -m "feat(bridge): fetch + parse reports/attendance.json"
```

---

### Task 3: Per-guild `retentionEnabled` toggle + payload gating

**Files:**
- Modify: `src/main/guildStore.ts` (add field to `GuildProfile` + `GuildSummary`)
- Modify: `src/preload/index.d.ts` (mirror the type additions; add `RosterPayload.attendance`)
- Modify: `src/main/index.ts` (`buildRoster`: gated attendance fetch + payload field; `GuildSummary` mapping)
- Modify: `src/renderer/src/components/GuildSettings.tsx` (toggle UI)

**Interfaces:**
- Consumes: `AxibridgeClient.attendanceRaids` (Task 2), `AttendanceRaidDTO` (Task 2).
- Produces: `GuildProfile.retentionEnabled: boolean`, `GuildSummary.retentionEnabled: boolean`, `RosterPayload.attendance: AttendanceRaidDTO[]`.

- [ ] **Step 1: Add the field to the guild profile + summary**

In `src/main/guildStore.ts`, add to `interface GuildProfile` (after `axitoolsShared`):
```ts
  /** Enables the Retention radar for this guild (default false — opt-in). */
  retentionEnabled: boolean
```
Add to `interface GuildSummary` likewise:
```ts
  retentionEnabled: boolean
```
Find where the store normalizes/defaults a profile on read/upsert (mirror how `axitoolsShared`/`shared` booleans are defaulted) and default `retentionEnabled` to `false` when absent. Find where `GuildSummary` is built from a profile and include `retentionEnabled: profile.retentionEnabled`.

- [ ] **Step 2: Mirror types in preload**

In `src/preload/index.d.ts`, add `retentionEnabled: boolean` to the `GuildProfile` and `GuildSummary` interfaces (lines ~67 and the summary block), and add to the `RosterPayload` interface:
```ts
  attendance: AttendanceRaidDTO[]
```
and declare the DTO (near the `BridgePlayerMetrics` block):
```ts
export interface AttendanceRaidDTO {
  id: string
  date: string
  attendees: { account: string; combatTimeMs: number; squadTimeMs: number }[]
}
```

- [ ] **Step 3: Gate the attendance fetch in `buildRoster`**

In `src/main/index.ts` `buildRoster()` (where `metrics` is fetched from `AxibridgeClient`, ~lines 474-493), after the metrics block add a gated attendance fetch:
```ts
  let attendance: AttendanceRaidDTO[] = []
  if (guild?.retentionEnabled && repos.length > 0) {
    try {
      attendance = await new AxibridgeClient(repos).attendanceRaids()
    } catch (e) {
      warnings.push(`Attendance data unavailable: ${(e as Error).message}`)
    }
  }
```
Add `attendance` to the returned `RosterPayload` (the object that already returns `metrics`, ~line 521). Import `AttendanceRaidDTO` from `./axibridgeClient` at the top of `index.ts` (extend the existing `import { AxibridgeClient, type RepoRef, type BridgePlayerMetrics } from './axibridgeClient'`). Add `attendance: AttendanceRaidDTO[]` to the local `RosterPayload` interface at line ~316.

- [ ] **Step 4: Add the toggle to `GuildSettings.tsx`**

In `src/renderer/src/components/GuildSettings.tsx`, near the WvW report repos (`bridgeRepos`) section, add a labeled toggle bound to the editable profile state, persisted through the same `guilds:upsert`/`upsertGuild` path the other fields use. Match the file's existing control styling. Concretely, add a checkbox row:
```tsx
        <label className="flex items-center gap-2 text-sm text-ink-dim">
          <input
            type="checkbox"
            checked={!!form.retentionEnabled}
            onChange={(e) => setForm({ ...form, retentionEnabled: e.target.checked })}
            className="accent-accent"
          />
          Enable Retention radar (uses WvW attendance history)
        </label>
```
(Use the file's actual form-state variable/setter names — match how `bridgeRepos`/`memberRoleId` are edited and saved; `retentionEnabled` rides the same save.)

- [ ] **Step 5: Typecheck + build + tests**

Run: `npm run typecheck` → clean. `npm run build` → succeeds. `npm test` → no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/main/guildStore.ts src/preload/index.d.ts src/main/index.ts src/renderer/src/components/GuildSettings.tsx
git commit -m "feat(retention): per-guild toggle + gated attendance in roster payload"
```

---

### Task 4: `retentionHistory` local store + IPC

**Files:**
- Create: `src/main/retentionHistory.ts`
- Test: `src/main/retentionHistory.test.ts`
- Modify: `src/main/index.ts` (instantiate + IPC handler)
- Modify: `src/preload/index.ts` + `src/preload/index.d.ts` (expose `logRetention`)

**Interfaces:**
- Produces: class `RetentionHistory` with `append(snapshots: RetentionSnapshot[]): void` (de-dupe by `date`+`memberKey`, cap total rows) and `RetentionSnapshot { date: string; memberKey: string; score: number; tier: string }`. IPC `retention:log`; preload `logRetention(snapshots)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/retentionHistory.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync, mkdtempSync } from 'fs'
import { RetentionHistory } from './retentionHistory'

let path: string
beforeEach(() => { path = join(mkdtempSync(join(tmpdir(), 'rh-')), 'retentionHistory.json') })

describe('RetentionHistory', () => {
  it('appends and de-dupes by (date, memberKey) — same day overwrites', () => {
    const h = new RetentionHistory(path)
    h.append([{ date: '2026-02-15', memberKey: 'a', score: 10, tier: 'healthy' }])
    h.append([{ date: '2026-02-15', memberKey: 'a', score: 80, tier: 'at-risk' }]) // same day → overwrite
    h.append([{ date: '2026-02-16', memberKey: 'a', score: 50, tier: 'watch' }])
    const rows = h.list()
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.date === '2026-02-15')!.score).toBe(80)
  })
  it('survives a corrupt file without throwing', () => {
    rmSync(path, { force: true })
    const h = new RetentionHistory(path)
    expect(h.list()).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/retentionHistory.test.ts`
Expected: FAIL — cannot find module `./retentionHistory`.

- [ ] **Step 3: Implement the store (mirror rosterStore atomic-write + corrupt-safe pattern)**

```ts
// src/main/retentionHistory.ts
//
// Local-only log of per-member retention scores over time. Seeds a future trained
// churn model (paired with Guild Log departures). De-duped to one row per member
// per calendar day. Atomic tmp+rename writes, capped, corrupt-file safe.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

export interface RetentionSnapshot {
  date: string // YYYY-MM-DD
  memberKey: string
  score: number
  tier: string
}

const MAX_ROWS = 20000

export class RetentionHistory {
  private rows: RetentionSnapshot[]
  constructor(private readonly path: string) {
    this.rows = this.read()
  }
  private read(): RetentionSnapshot[] {
    if (!existsSync(this.path)) return []
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'))
      return Array.isArray(parsed?.rows) ? (parsed.rows as RetentionSnapshot[]) : []
    } catch {
      return []
    }
  }
  list(): RetentionSnapshot[] {
    return [...this.rows]
  }
  append(snapshots: RetentionSnapshot[]): void {
    const key = (s: RetentionSnapshot): string => `${s.date}|${s.memberKey}`
    const byKey = new Map(this.rows.map((r) => [key(r), r]))
    for (const s of snapshots) byKey.set(key(s), s)
    let rows = [...byKey.values()]
    if (rows.length > MAX_ROWS) rows = rows.slice(rows.length - MAX_ROWS)
    this.rows = rows
    this.flush()
  }
  private flush(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, rows: this.rows }, null, 2), { mode: 0o600 })
    renameSync(tmp, this.path)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/retentionHistory.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire IPC + preload**

In `src/main/index.ts`: instantiate near the other stores
`const retentionHistory = new RetentionHistory(join(app.getPath('userData'), 'retentionHistory.json'))`
(import the class and `join` if not already), and add a handler:
```ts
  ipcMain.handle('retention:log', (_e, snapshots: import('./retentionHistory').RetentionSnapshot[]) => {
    retentionHistory.append(Array.isArray(snapshots) ? snapshots : [])
  })
```
In `src/preload/index.ts` (Roster group): `logRetention: (snapshots: unknown) => ipcRenderer.invoke('retention:log', snapshots),`
In `src/preload/index.d.ts` `AxiRosterApi`: `logRetention(snapshots: { date: string; memberKey: string; score: number; tier: string }[]): Promise<void>`

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck` → clean.
```bash
git add src/main/retentionHistory.ts src/main/retentionHistory.test.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(retention): local score-history store + log IPC"
```

---

### Task 5: `RetentionView` + nav tab + bulk-tag

**Files:**
- Create: `src/renderer/src/components/RetentionView.tsx`
- Modify: `src/renderer/src/App.tsx` (gated `retention` tab)

**Interfaces:**
- Consumes: `computeRetention`, `DEFAULT_RETENTION_CONFIG`, types (Task 1); `bulkTags` helpers + `SelectionBar` + `tagRegistry` (Wave 1); `window.axiroster.{buildRoster,getTagRegistry,setTagRegistry,upsertAnnotation,logRetention}`; `toast`.

- [ ] **Step 1: Add the gated nav tab in `App.tsx`**

In `src/renderer/src/App.tsx`, the tab list (around line 30-35) has entries like `{ id: 'log', label: 'Guild Log', icon: <ScrollText size={15} /> }`. Add a Retention tab, shown only when the selected guild has `retentionEnabled`. Where the tab buttons are rendered per guild (around line 230), filter the list: build `const visibleTabs = TABS.filter((t) => t.id !== 'retention' || selected?.retentionEnabled)` and map over `visibleTabs` instead of `TABS`. Add the import `Activity` from lucide-react and the tab `{ id: 'retention', label: 'Retention', icon: <Activity size={15} /> }`. In the content switch (around line 341-348), add before the settings branch:
```tsx
          ) : tab === 'retention' ? (
            <RetentionView />
```
and `import RetentionView from './components/RetentionView'`. (If `tab` is `'retention'` but the guild toggles off, the filtered tab list won't show it; also guard the content switch by falling back to roster when `!selected?.retentionEnabled`.)

- [ ] **Step 2: Create `RetentionView.tsx`**

```tsx
// src/renderer/src/components/RetentionView.tsx
//
// Retention radar: ranks members by churn-risk score computed from per-raid
// attendance time-series (lib/retention). Reuses the Wave-1 SelectionBar + bulkTags
// to bulk-tag at-risk members. Read-only members see no selection controls.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import type { ReconciledMember, RosterPayload } from '../../../preload/index.d'
import { computeRetention, DEFAULT_RETENTION_CONFIG, type RetentionResult, type RetentionTier } from '../lib/retention'
import { addTagToMembers, removeTagFromMembers, tagsInSelection } from '../lib/bulkTags'
import { parseRegistry, setTagColor, resolveColorId, tagStyle, dotColor, type TagRegistry, type TagColorId } from '../lib/tagRegistry'
import SelectionBar from './SelectionBar'
import { toast } from '../lib/toast'

const TIER_META: Record<RetentionTier, { label: string; color: string }> = {
  'at-risk': { label: 'At-risk', color: '#f43f5e' },
  watch: { label: 'Watch', color: '#f59e0b' },
  healthy: { label: 'Healthy', color: '#10b981' },
  'insufficient-data': { label: 'No data', color: '#646a73' }
}

export default function RetentionView(): JSX.Element {
  const [payload, setPayload] = useState<RosterPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [registry, setRegistry] = useState<TagRegistry>({})
  const [canEdit, setCanEdit] = useState(true)
  const [filter, setFilter] = useState<'attention' | RetentionTier>('attention')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const res = await window.axiroster.buildRoster()
    if (res.ok) setPayload(res.data)
    setLoading(false)
    const s = await window.axiroster.authStatus()
    setCanEdit(s.role !== 'read')
    window.axiroster.getTagRegistry().then((m) => setRegistry(parseRegistry(JSON.stringify(m))))
  }, [])
  useEffect(() => { load() }, [load])

  const members: ReconciledMember[] = payload?.members ?? []
  const results = useMemo(() => {
    if (!payload) return [] as RetentionResult[]
    return computeRetention({
      raids: payload.attendance ?? [],
      members: members.map((m) => ({
        annotationKey: m.annotationKey,
        accounts: m.accounts.map((a) => a.account_name),
        tags: m.tags
      })),
      now: Date.now(),
      config: DEFAULT_RETENTION_CONFIG
    })
  }, [payload, members])

  const byKey = useMemo(() => new Map(members.map((m) => [m.annotationKey, m])), [members])
  const counts = useMemo(() => ({
    'at-risk': results.filter((r) => r.tier === 'at-risk').length,
    watch: results.filter((r) => r.tier === 'watch').length,
    healthy: results.filter((r) => r.tier === 'healthy').length
  }), [results])

  // Log a daily snapshot whenever results change.
  useEffect(() => {
    if (results.length === 0) return
    const date = new Date().toISOString().slice(0, 10)
    window.axiroster.logRetention(
      results.filter((r) => r.tier !== 'insufficient-data').map((r) => ({ date, memberKey: r.memberKey, score: r.score, tier: r.tier }))
    )
  }, [results])

  const shown = results.filter((r) =>
    filter === 'attention' ? r.tier === 'at-risk' || r.tier === 'watch' : r.tier === filter
  )

  const toggle = (key: string): void =>
    setSelectedKeys((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })
  const clearSel = (): void => setSelectedKeys(new Set())

  const applyAdd = async (name: string): Promise<void> => {
    const diffs = addTagToMembers(members, selectedKeys, name)
    await Promise.all(diffs.map((d) => window.axiroster.upsertAnnotation(d.key, { tags: d.nextTags }).catch(() => {})))
    toast(`Tagged ${diffs.length} member${diffs.length === 1 ? '' : 's'}`)
    await load()
  }
  const applyRemove = async (name: string): Promise<void> => {
    const diffs = removeTagFromMembers(members, selectedKeys, name)
    await Promise.all(diffs.map((d) => window.axiroster.upsertAnnotation(d.key, { tags: d.nextTags }).catch(() => {})))
    toast(`Removed from ${diffs.length} member${diffs.length === 1 ? '' : 's'}`)
    await load()
  }
  const recolor = async (name: string, id: TagColorId): Promise<void> => {
    const next = setTagColor(registry, name, id)
    setRegistry(next)
    await window.axiroster.setTagRegistry(next).catch(() => {})
  }
  const addKnownTags = useMemo(() => {
    const names = new Map<string, string>()
    for (const k of Object.keys(registry)) names.set(k, k)
    for (const m of members) for (const t of m.tags) if (!names.has(t.toLowerCase())) names.set(t.toLowerCase(), t)
    return [...names.values()]
  }, [registry, members])
  const removeKnownTags = useMemo(() => tagsInSelection(members, selectedKeys), [members, selectedKeys])

  const retentionOn = (payload?.attendance?.length ?? 0) > 0 || results.some((r) => r.tier !== 'insufficient-data')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-panel-line bg-panel-sunk px-4 py-2.5">
        <Activity size={15} className="text-accent-soft" />
        <span className="text-sm font-semibold text-ink">Retention</span>
        <span className="text-xs text-ink-faint">· {payload?.attendance?.length ?? 0} raids · 14-day window</span>
        <button onClick={load} className="btn ml-auto px-2" title="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {!retentionOn ? (
        <div className="flex flex-1 items-center justify-center px-6 py-16 text-center text-sm text-ink-faint">
          No attendance data yet — check this guild's AxiBridge report repo, or that it's publishing reports/attendance.json.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
          <div className="mb-3 grid grid-cols-3 gap-3">
            <Stat n={counts['at-risk']} label="At-risk" color="#f43f5e" />
            <Stat n={counts.watch} label="Watch" color="#f59e0b" />
            <Stat n={counts.healthy} label="Healthy" color="#10b981" />
          </div>
          <div className="mb-2 flex gap-1.5">
            {(['attention', 'at-risk', 'watch', 'healthy'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`rounded-full px-2.5 py-0.5 text-xs ${filter === f ? 'bg-accent/15 text-accent-soft' : 'text-ink-dim hover:text-ink'}`}>
                {f === 'attention' ? 'Needs attention' : TIER_META[f].label}
              </button>
            ))}
          </div>
          <div className="card min-h-0 flex-1 overflow-y-auto">
            {shown.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-ink-faint">Nobody in this bucket.</div>
            ) : shown.map((r) => {
              const m = byKey.get(r.memberKey)
              if (!m) return null
              const meta = TIER_META[r.tier]
              const checked = selectedKeys.has(r.memberKey)
              return (
                <div key={r.memberKey}
                  className={`flex items-center gap-3 border-b border-panel-line/60 px-4 py-2.5 last:border-0 ${checked ? 'bg-accent/10' : ''}`}>
                  {canEdit && (
                    <button onClick={() => toggle(r.memberKey)}
                      className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${checked ? 'border-accent bg-accent' : 'border-panel-line2'}`}>
                      {checked && <span className="text-[10px] text-white">✓</span>}
                    </button>
                  )}
                  <div className="w-44 min-w-0">
                    <div className="truncate text-sm font-medium text-ink">{m.label}</div>
                    <div className="truncate text-xs text-ink-faint">{m.accounts[0]?.account_name ?? '—'}</div>
                  </div>
                  <div className="w-10 text-center font-mono text-base font-semibold" style={{ color: meta.color }}>{r.tier === 'insufficient-data' ? '–' : r.score}</div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                    style={{ background: `${meta.color}26`, color: meta.color }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />{meta.label}
                  </span>
                  <div className="ml-1 flex items-end gap-[3px]" title="recent raids (filled = attended)">
                    {[...r.timeline].reverse().map((a, i) => (
                      <span key={i} className="w-[6px] rounded-sm" style={{ height: a ? 16 : 5, background: a ? '#10b981' : '#3a3a40' }} />
                    ))}
                  </div>
                  <div className="ml-2 flex flex-1 flex-wrap gap-1">
                    {r.reasons.map((rsn, i) => (
                      <span key={i} className="rounded border border-panel-line bg-panel-raised px-1.5 py-0.5 text-[10.5px] text-ink-dim">{rsn}</span>
                    ))}
                  </div>
                  <div className="w-12 text-right font-mono text-xs text-ink-dim">
                    {r.signals.daysSinceLast !== null ? `${r.signals.daysSinceLast}d` : '—'}
                  </div>
                </div>
              )
            })}
          </div>
          {canEdit && selectedKeys.size > 0 && (
            <SelectionBar count={selectedKeys.size} registry={registry}
              addKnownTags={addKnownTags} removeKnownTags={removeKnownTags}
              onAdd={applyAdd} onRemove={applyRemove} onRecolor={recolor} onClear={clearSel} />
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ n, label, color }: { n: number; label: string; color: string }): JSX.Element {
  return (
    <div className="stat-card">
      <div className="font-mono text-2xl font-bold" style={{ color }}>{n}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</div>
    </div>
  )
}
```
(If `resolveColorId`/`tagStyle`/`dotColor` end up unused in the final component, drop them from the import to keep lint clean.)

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck` → clean (remove any unused imports). `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/RetentionView.tsx src/renderer/src/App.tsx
git commit -m "feat(retention): Retention view with risk ranking + bulk-tag"
```

---

### Task 6: Verification sweep + manual smoke

- [ ] **Step 1: Full suite** — Run: `npm test` → all pass (incl. `retention.test.ts`, `axibridgeClient.attendance.test.ts`, `retentionHistory.test.ts`).
- [ ] **Step 2: Typecheck + build** — Run: `npm run typecheck && npm run build` → clean / succeeds.
- [ ] **Step 3: Manual smoke (needs running app + a guild with `retentionEnabled` and an attendance.json):**
  1. Toggle off → no Retention tab; toggle on → tab appears.
  2. With the producer fixture/real data: list ranks by score; tiers/sparkline/reasons render; filter pills work.
  3. Multi-select → SelectionBar → bulk-tag `at-risk`; tags persist on those members.
  4. On a guild with the toggle on but no attendance.json → graceful empty state.
  5. Read-only member → no checkboxes/bar.
- [ ] **Step 4: Commit fixups** — `git add -A && git commit -m "test: retention radar verification sweep" --allow-empty`

---

## Self-Review Notes

- **Spec coverage:** consume attendance.json, defensive parse (Task 2) ✓; per-member union across accounts, 14d-vs-prior windows, signals, weighted composite + tag importance, tiers, reasons, insufficient-data (Task 1) ✓; score logging one/member/day local store (Task 4) ✓; per-guild toggle default-off + gated fetch + hidden tab + empty state (Tasks 3, 5) ✓; dedicated view + ranked list + sparkline + reasons + bulk-tag via Wave-1 SelectionBar (Task 5) ✓; read-only gating (Task 5) ✓; tests for the pure pieces (Tasks 1,2,4) ✓.
- **Placeholders:** none — full code given; the "confirm the form-state variable names in GuildSettings / the repos field name in AxibridgeClient" notes are explicit mirror-this instructions.
- **Type consistency:** `AttendanceRaid`/`AttendanceRaidDTO` shapes match across retention.ts (Task 1), axibridgeClient (Task 2), preload (Task 3), RetentionView (Task 5); `RetentionResult`/`RetentionTier`/`computeRetention`/`DEFAULT_RETENTION_CONFIG` consistent Task 1↔5; `RetentionSnapshot` consistent Task 4↔5; `SelectionBar` props match Wave-1's component.
- **Build order:** ships after the AxiBridge producer, but Tasks 1/2/4 are testable now against the contract; the manual smoke (Task 6) needs real/fixture attendance data.
- **Two-repo seam:** the consumer's `parseAttendanceFile` tolerates the producer being absent (empty list → empty state), so this plan is independently mergeable before the producer deploys.
```
