# Departed Members Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a durable history of everyone who left or was kicked from the GW2 guild. Flag departed people who still hold the Discord member role and let officers remove it. Warn when a previously kicked person comes back.

**Architecture:**
- **Detection and merge.** One dependency-free module (`supabase/functions/_shared/departures.ts`) holds the pure detection and merge logic. It is re-exported from `src/shared/departures.ts`.
- **Who runs it.**
  - Desktop runs it after each live GW2 roster pull, inside `buildRoster`.
  - Web runs it inside the `refresh-roster` edge function.
- **Storage.** Each departed account is one reserved annotation row (`departure:<account lc>`, with JSON in `notes`). These rows sync through the existing annotation sync.
- **UI.** The renderer joins the rows with live Discord state at read time and renders:
  - a new Departed tab
  - a warning banner on Roster
  - "Previously kicked" badges

**Tech Stack:** TypeScript, React 18, Electron (main/preload/renderer), Supabase (Postgres + Deno edge functions), vitest (node env), the axi-design CSS package.

**Spec:** `docs/superpowers/specs/2026-10-11-departed-members-design.md`. Read it alongside this plan.

## Global Constraints

- **Tests.** Run vitest with at most 2 workers. Use `npm test -- <paths>`, which is already `--pool=forks --poolOptions.forks.maxForks=2`. Never run bare `vitest` with default parallelism.
- **Storage.**
  - Rows use reserved annotation keys `departure:<account name, trimmed + lowercased>`.
  - The JSON `DepartureDoc` goes in `notes`.
  - No new table, migration, or RLS change.
- **Merge window and guard.**
  - Upgrade window: a gw2-log episode replaces an `unknown` roster-diff episode whose `at` is within **±7 days**.
  - Mass-drop guard: the roster diff is skipped when **more than 25% of `previous` AND more than 5 accounts** vanish in one run.
- **Officer fields.** Automatic detection never overwrites `note`, `reason`, `memberId` (once set) or `dismissedSuggestions`.
- **Module boundary.** `supabase/functions/_shared/departures.ts` has **no imports** and uses structural types only, so it runs under Deno and Node.
- **Only the configured `memberRoleId` counts as "the guild role".** No new setting is added.
- **Styling.** Follow the axi-design conventions:
  - `ar-` prefix for app classes; package classes (`axi-*`) first.
  - `.ar-ink-*` utilities, never inline colours.
  - Tones `ok/warn/danger/meta/idle` from `src/renderer/src/lib/status.ts`.
  - The portaled `Tooltip` component; `ar-banner--warn` for the banner.
- **Kind pills.** Left = `idle`, Kicked = `danger`, Unknown = `meta`, Rejoined = `ok`.
- **No Discord kick action.** Only `role_unassign` with the guild's `memberRoleId`.
- **Commits.**
  - Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never bypass commit signing. If signing fails, stop and tell the user.
- **Web deploy is manual** (`npm run deploy:web`, `npm run deploy:functions`). Do not deploy as part of this plan.

## Review Focus

1. **Officers purge many people at once (more than 25% and more than 5).** The roster-diff guard trips, but every kick in the GW2 log must still be recorded, so the history is complete. *Test:* Task 3, "mass drop still folds log kicks".
2. **The same account appears with different casing** (`gone.2000` in the log, `Gone.2000` on the roster). It must be one record with one episode, not two. *Test:* Task 3, "casing differences collapse into one record".
3. **First web refresh after deploy.** Months of stale `roster_members` rows vanish at once. That must not create a pile of bogus "Unknown, today" episodes, but the stale rows must still be deleted. *Test:* Task 4, "stale rows on first deploy are deleted without bogus episodes".
4. **Short GW2 handles** (`Al.1234`) substring-match many Discord names. The result must be no suggestion, not a wrong one. *Test:* Task 7, "short handles never partial-match".
5. **Guild with no member role configured, or a read-only user.** Nothing is flagged, the banner stays hidden, and role removal is disabled with a reason. *Tests:* Task 7, "no member role configured → nothing flagged" and "roleActionBlocker explains why removal is disabled".

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/departures.ts` (create) | Canonical pure module: types, key helpers, parser/serializer, merge rules, `detectDepartures`. No imports. |
| `supabase/functions/_shared/departures.test.ts` (create) | Tests for the above. |
| `src/shared/departures.ts` (create) | One-line re-export of the canonical module for desktop and web. |
| `src/shared/rosterReconcile.ts` (modify) | `isReservedAnnotationKey` gains `departure:`. |
| `supabase/functions/refresh-roster/handler.ts` and `index.ts` (modify) | Read the previous roster, record departures, and delete stale `roster_members` rows. |
| `src/main/departureSnapshotStore.ts` (create) | Per-guild JSON file of account names seen at the last live pull. |
| `src/main/departureSync.ts` (create) | Desktop orchestrator: snapshot + audit store + annotation rows → `detectDepartures` → save. |
| `src/main/index.ts` (modify) | Call `syncDepartures` after a live pull in `buildRoster`, and add the `departures:list` IPC. |
| `src/preload/index.ts` and `index.d.ts` (modify) | `departuresGet()` on the client contract. |
| `src/renderer/src/lib/webClient/departures.ts` (create) and `webClient.ts` (modify) | Web `departuresGet`. |
| `src/renderer/src/lib/departures.ts` (create) | Renderer view model: suggestions, rows, flagging, filter/sort/counts, doc edits, `previousKick`, bulk role removal runner. |
| `src/renderer/src/components/DepartedView.tsx` (create) | The Departed tab. |
| `src/renderer/src/components/DepartureDetail.tsx` (create) | Detail modal: note, per-episode reason, manual episode. |
| `src/renderer/src/App.tsx` (modify) | Departed tab and the banner → tab navigation. |
| `RosterView.tsx`, `MemberDetail.tsx`, `RecruitmentView.tsx` and `RecruitCardModal.tsx` (modify) | Banner and "Previously kicked" badges. |

### Where the plan refines the spec

- **`detectDepartures` return type.** It returns `{ changed, vanished, skipped }`, not just the changed docs. The edge function needs `vanished` to delete stale rows. Deletes happen whenever the pull is non-empty, even when the mass-drop guard skips the episodes, because the fresh pull is authoritative for "who is in the guild".
- **Discord link resolution at read time.**
  - Desktop detection gets `links` from the reconciled roster.
  - Web detection gets `links` from `roster_links`.
  - At read time, a doc with `memberId === null` also resolves to a member whose accounts include the departed account.
- **Bulk bar.** It reuses the `.ar-selection` bar styling inline in `DepartedView`. The existing `SelectionBar` component is hard-wired to tag actions.
- **Partial-match suggestions** need a handle of at least 3 characters. Exact matches have no minimum.
- **"Already lacks the role".** A row whose Discord member no longer holds the role is not flagged, so it is never sent to removal. Rows are re-derived from a fresh roster after every run.

---

### Task 1: Reserve the `departure:` annotation key

**Files:**
- Modify: `src/shared/rosterReconcile.ts:76-77`
- Test: `src/shared/rosterReconcile.test.ts`

**Interfaces:**
- Produces: `isReservedAnnotationKey('departure:foo.1234') === true`. Every existing consumer (`rosterStore.ts` bucketing, `supabaseSync.ts`, `webClient/roster.ts`, `reconcileRoster`) then treats departure rows as per-guild workspace state, never as people.

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/rosterReconcile.test.ts`:

```ts
test('departure: keys are reserved', () => {
  expect(isReservedAnnotationKey('departure:foo.1234')).toBe(true)
})

test('reconcileRoster never surfaces a departure: row as a member', () => {
  const out = reconcileRoster({
    discordMembers: [],
    linked: [],
    inGameRoster: [{ name: 'Foo.1234' }],
    manualLinks: [],
    annotations: [
      { memberId: 'departure:foo.1234', nickname: '', aliases: [], notes: '{"account":"Foo.1234"}', tags: [] }
    ],
    memberRoleId: null,
    haveInGame: true
  })
  expect(out.map((m) => m.annotationKey)).toEqual(['acct:Foo.1234'])
  expect(out[0].notes).toBe('')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/shared/rosterReconcile.test.ts`
Expected: FAIL. `departure: keys are reserved` expected `true`, got `false`.

- [ ] **Step 3: Implement**

In `src/shared/rosterReconcile.ts`, replace the predicate:

```ts
export const isReservedAnnotationKey = (key: string): boolean =>
  key.startsWith('meta:') ||
  key.startsWith('prospect:') ||
  key.startsWith('vote:') ||
  key.startsWith('comment:') ||
  key.startsWith('departure:')
```

Also update the `FileShape.scoped` comment in `src/main/rosterStore.ts:41` to read `(meta:*, prospect:*, vote:*, comment:*, departure:*)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/shared/rosterReconcile.test.ts src/main/rosterReservedKeys.test.ts src/main/rosterStoreScope.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/rosterReconcile.ts src/shared/rosterReconcile.test.ts src/main/rosterStore.ts
git commit -m "feat(departures): reserve the departure: annotation key

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Departure doc model and parser

**Files:**
- Create: `supabase/functions/_shared/departures.ts`
- Create: `supabase/functions/_shared/departures.test.ts`
- Create: `src/shared/departures.ts`

**Interfaces:**
- Produces (all exported from `supabase/functions/_shared/departures.ts` and re-exported by `src/shared/departures.ts`):
  - **Types:**
    - `DepartureKind = 'left' | 'kicked' | 'unknown'`
    - `DepartureSource = 'gw2-log' | 'roster-diff' | 'manual'`
    - `DepartureEpisode { kind; actor: string | null; at: string; source; auditUid: string | null; reason: string; rejoinedAt: string | null }`
    - `DepartureDoc { account: string; memberId: string | null; dismissedSuggestions: string[]; note: string; episodes: DepartureEpisode[] }` (episodes newest first)
  - **Constants:** `DEPARTURE_PREFIX = 'departure:'`
  - **Functions:**
    - `departureKey(account: string): string`
    - `accountFromKey(key: string): string`
    - `emptyDepartureDoc(account: string): DepartureDoc`
    - `sortEpisodes(eps: DepartureEpisode[]): DepartureEpisode[]`
    - `parseDepartureDoc(key: string, notes: string): DepartureDoc` (never throws)
    - `serializeDepartureDoc(doc: DepartureDoc): string`
    - `latestEpisode(doc: DepartureDoc): DepartureEpisode | null`
    - `isOpen(doc: DepartureDoc): boolean`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/departures.test.ts`:

```ts
// supabase/functions/_shared/departures.test.ts
import { describe, test, expect } from 'vitest'
import {
  departureKey,
  accountFromKey,
  emptyDepartureDoc,
  parseDepartureDoc,
  serializeDepartureDoc,
  latestEpisode,
  isOpen,
  type DepartureDoc
} from './departures'

describe('keys', () => {
  test('departureKey trims and lowercases the account', () => {
    expect(departureKey('  Foo.1234 ')).toBe('departure:foo.1234')
  })
  test('accountFromKey strips the prefix', () => {
    expect(accountFromKey('departure:foo.1234')).toBe('foo.1234')
  })
})

describe('parseDepartureDoc', () => {
  test('empty notes yield an empty doc named from the key', () => {
    expect(parseDepartureDoc('departure:foo.1234', '')).toEqual(emptyDepartureDoc('foo.1234'))
  })

  test('corrupt or non-object JSON yields an empty doc', () => {
    expect(parseDepartureDoc('departure:foo.1234', '{nope')).toEqual(emptyDepartureDoc('foo.1234'))
    expect(parseDepartureDoc('departure:foo.1234', '[1,2]')).toEqual(emptyDepartureDoc('foo.1234'))
  })

  test('partial docs are filled in and unknown enums fall back', () => {
    const doc = parseDepartureDoc(
      'departure:foo.1234',
      JSON.stringify({
        account: 'Foo.1234',
        dismissedSuggestions: ['d1', 7, ''],
        episodes: [
          { kind: 'weird', at: '2026-01-01T00:00:00.000Z', source: 'bogus' },
          { kind: 'left' } // no `at` → dropped
        ]
      })
    )
    expect(doc.account).toBe('Foo.1234')
    expect(doc.memberId).toBeNull()
    expect(doc.note).toBe('')
    expect(doc.dismissedSuggestions).toEqual(['d1'])
    expect(doc.episodes).toEqual([
      {
        kind: 'unknown',
        actor: null,
        at: '2026-01-01T00:00:00.000Z',
        source: 'manual',
        auditUid: null,
        reason: '',
        rejoinedAt: null
      }
    ])
  })

  test('episodes come back newest first', () => {
    const doc = parseDepartureDoc(
      'departure:foo.1234',
      JSON.stringify({
        account: 'Foo.1234',
        episodes: [
          { kind: 'left', at: '2025-01-01T00:00:00.000Z', source: 'gw2-log' },
          { kind: 'kicked', at: '2026-01-01T00:00:00.000Z', source: 'gw2-log', actor: 'Boss.1' }
        ]
      })
    )
    expect(doc.episodes.map((e) => e.kind)).toEqual(['kicked', 'left'])
  })

  test('serialize → parse round-trips', () => {
    const doc: DepartureDoc = {
      account: 'Foo.1234',
      memberId: 'd1',
      dismissedSuggestions: ['d2'],
      note: 'toxic in chat',
      episodes: [
        {
          kind: 'kicked',
          actor: 'Boss.1',
          at: '2026-01-01T00:00:00.000Z',
          source: 'gw2-log',
          auditUid: 'gw2:9',
          reason: 'afk',
          rejoinedAt: null
        }
      ]
    }
    expect(parseDepartureDoc(departureKey(doc.account), serializeDepartureDoc(doc))).toEqual(doc)
  })
})

describe('latestEpisode / isOpen', () => {
  test('an empty doc has no latest episode and is not open', () => {
    const d = emptyDepartureDoc('Foo.1234')
    expect(latestEpisode(d)).toBeNull()
    expect(isOpen(d)).toBe(false)
  })
  test('open until the latest episode has rejoinedAt', () => {
    const d = parseDepartureDoc(
      'departure:foo.1234',
      JSON.stringify({ episodes: [{ kind: 'left', at: '2026-01-01T00:00:00.000Z', source: 'gw2-log' }] })
    )
    expect(isOpen(d)).toBe(true)
    d.episodes[0].rejoinedAt = '2026-02-01T00:00:00.000Z'
    expect(isOpen(d)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- supabase/functions/_shared/departures.test.ts`
Expected: FAIL. It cannot resolve `./departures`.

- [ ] **Step 3: Implement**

Create `supabase/functions/_shared/departures.ts`:

```ts
// supabase/functions/_shared/departures.ts
//
// Departed-members history: one record per GW2 account that left or was kicked,
// stored as a reserved `departure:<account lc>` annotation row with this JSON in
// `notes`. The canonical home is here so the refresh-roster edge function (Deno)
// can run detection; src/shared/departures.ts re-exports it for desktop + web.
// Keep it dependency-free: no imports, structural types only, pure (no IO).

export type DepartureKind = 'left' | 'kicked' | 'unknown'
export type DepartureSource = 'gw2-log' | 'roster-diff' | 'manual'

export interface DepartureEpisode {
  /** unknown = the roster diff saw them vanish with no matching log event. */
  kind: DepartureKind
  /** GW2 account that kicked them (kicked only). */
  actor: string | null
  /** ISO time: the log time, or the detection time for a roster diff. */
  at: string
  source: DepartureSource
  /** Audit event uid when source = gw2-log; the idempotency key. */
  auditUid: string | null
  /** Officer-entered, per episode. Detection never writes it. */
  reason: string
  rejoinedAt: string | null
}

export interface DepartureDoc {
  /** Display casing, e.g. "Foo.1234". */
  account: string
  /** Discord link: auto, confirmed suggestion, or manual pick. */
  memberId: string | null
  /** Discord ids an officer marked "not them". */
  dismissedSuggestions: string[]
  /** Officer note about the person. */
  note: string
  /** Newest first. */
  episodes: DepartureEpisode[]
}

export const DEPARTURE_PREFIX = 'departure:'

const lc = (s: string): string => s.trim().toLowerCase()

export const departureKey = (account: string): string => DEPARTURE_PREFIX + lc(account)

export const accountFromKey = (key: string): string =>
  key.startsWith(DEPARTURE_PREFIX) ? key.slice(DEPARTURE_PREFIX.length) : key

export function emptyDepartureDoc(account: string): DepartureDoc {
  return { account: account.trim(), memberId: null, dismissedSuggestions: [], note: '', episodes: [] }
}

const KINDS = new Set<string>(['left', 'kicked', 'unknown'])
const SOURCES = new Set<string>(['gw2-log', 'roster-diff', 'manual'])

const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
export const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))

function parseEpisode(raw: unknown): DepartureEpisode | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isIso(r.at)) return null
  return {
    kind: KINDS.has(r.kind as string) ? (r.kind as DepartureKind) : 'unknown',
    actor: strOrNull(r.actor),
    at: r.at,
    source: SOURCES.has(r.source as string) ? (r.source as DepartureSource) : 'manual',
    auditUid: strOrNull(r.auditUid),
    reason: typeof r.reason === 'string' ? r.reason : '',
    rejoinedAt: isIso(r.rejoinedAt) ? r.rejoinedAt : null
  }
}

export function sortEpisodes(eps: DepartureEpisode[]): DepartureEpisode[] {
  return [...eps].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/** Never throws: corrupt/empty JSON yields an empty doc named from the key. */
export function parseDepartureDoc(key: string, notes: string): DepartureDoc {
  const fallback = emptyDepartureDoc(accountFromKey(key))
  if (!notes || !notes.trim()) return fallback
  try {
    const r = JSON.parse(notes) as Record<string, unknown> | null
    if (!r || typeof r !== 'object' || Array.isArray(r)) return fallback
    const episodes = Array.isArray(r.episodes)
      ? r.episodes.map(parseEpisode).filter((e): e is DepartureEpisode => e !== null)
      : []
    return {
      account: typeof r.account === 'string' && r.account.trim() ? r.account.trim() : fallback.account,
      memberId: strOrNull(r.memberId),
      dismissedSuggestions: Array.isArray(r.dismissedSuggestions)
        ? r.dismissedSuggestions.filter((x): x is string => typeof x === 'string' && x.length > 0)
        : [],
      note: typeof r.note === 'string' ? r.note : '',
      episodes: sortEpisodes(episodes)
    }
  } catch {
    return fallback
  }
}

export const serializeDepartureDoc = (doc: DepartureDoc): string => JSON.stringify(doc)

export const latestEpisode = (doc: DepartureDoc): DepartureEpisode | null => doc.episodes[0] ?? null

/** Gone right now: the latest episode has no rejoin. */
export function isOpen(doc: DepartureDoc): boolean {
  const l = latestEpisode(doc)
  return l !== null && l.rejoinedAt === null
}
```

Create `src/shared/departures.ts`:

```ts
// src/shared/departures.ts
// The departures core lives with the edge functions (they can't import src/);
// desktop and web use it through this re-export.
export * from '../../supabase/functions/_shared/departures'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- supabase/functions/_shared/departures.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors. This proves `src/shared` can re-export from outside `src/`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/departures.ts supabase/functions/_shared/departures.test.ts src/shared/departures.ts
git commit -m "feat(departures): departure doc model and never-throwing parser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Merge rules and `detectDepartures`

**Files:**
- Modify: `supabase/functions/_shared/departures.ts` (append)
- Modify: `supabase/functions/_shared/departures.test.ts` (append)

**Interfaces:**
- Consumes: everything from Task 2.
- Produces:
  - **Constants:** `UPGRADE_WINDOW_MS = 7 * 86_400_000`, `MASS_DROP_FRACTION = 0.25`, `MASS_DROP_MIN = 5`
  - **Input types:**
    - `DepartureRosterMember { name: string; joined?: string | null }`
    - `DepartureAuditEvent { uid: string; source: string; type: string; time: string; actor?: string; target?: string }`
    - `DepartureLink { accountName: string; memberId: string }`
  - **Merge functions** (mutate the doc, return `true` if changed):
    - `applyLogEpisode(doc, ep)`
    - `applyDiffEpisode(doc, at)`
    - `applyRejoin(doc, at)`
  - **Detection:**
    - `DetectInput { previous: string[] | null; current: DepartureRosterMember[]; auditEvents: DepartureAuditEvent[]; existing: Map<string, DepartureDoc>; links: DepartureLink[]; now: string }`, where `existing` is keyed by `departureKey`.
    - `DiffSkip = 'no-snapshot' | 'empty-pull' | 'mass-drop'`
    - `DetectResult { changed: DepartureDoc[]; vanished: string[]; skipped: DiffSkip | null }`
    - `detectDepartures(input: DetectInput): DetectResult`. It never mutates `input.existing`. `vanished` uses the casing from `previous` and is non-empty only when `previous !== null && current.length > 0`, including on a mass drop.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/_shared/departures.test.ts`, and add `detectDepartures, type DetectInput` to its import list:

```ts
const NOW = '2026-10-12T12:00:00.000Z'
const DAY = 86_400_000
const ago = (days: number): string => new Date(Date.parse(NOW) - days * DAY).toISOString()
const kick = (id: number, user: string, by: string | undefined, time: string) => ({
  uid: `gw2:${id}`, source: 'gw2', type: 'kick', time, actor: user, target: by
})
const joinedEv = (id: number, user: string, time: string) => ({
  uid: `gw2:${id}`, source: 'gw2', type: 'joined', time, actor: user
})
const run = (over: Partial<DetectInput> = {}) =>
  detectDepartures({
    previous: null,
    current: [{ name: 'Stay.1000' }],
    auditEvents: [],
    existing: new Map(),
    links: [],
    now: NOW,
    ...over
  })
const asMap = (docs: DepartureDoc[]) => new Map(docs.map((d) => [departureKey(d.account), d]))
const docFor = (docs: DepartureDoc[], account: string) =>
  docs.find((d) => departureKey(d.account) === departureKey(account))

describe('audit fold', () => {
  test('a self-kick is a leave; an officer kick is a kick with its actor', () => {
    const r = run({ auditEvents: [kick(1, 'Quit.1', 'Quit.1', ago(2)), kick(2, 'Bad.2', 'Boss.9', ago(1))] })
    expect(docFor(r.changed, 'Quit.1')!.episodes[0]).toMatchObject({ kind: 'left', actor: null, source: 'gw2-log', auditUid: 'gw2:1' })
    expect(docFor(r.changed, 'Bad.2')!.episodes[0]).toMatchObject({ kind: 'kicked', actor: 'Boss.9', auditUid: 'gw2:2' })
  })

  test('a kick with no kicked_by is unknown but still from the log', () => {
    const r = run({ auditEvents: [kick(1, 'Who.1', undefined, ago(1))] })
    expect(docFor(r.changed, 'Who.1')!.episodes[0]).toMatchObject({ kind: 'unknown', source: 'gw2-log' })
  })

  test('discord events and other gw2 types are ignored', () => {
    const r = run({
      auditEvents: [
        { uid: 'discord:1', source: 'discord', type: 'kick', time: ago(1), actor: 'X.1', target: 'Y.2' },
        { uid: 'gw2:5', source: 'gw2', type: 'rank_change', time: ago(1), actor: 'X.1' }
      ]
    })
    expect(r.changed).toEqual([])
  })

  test('backfill: many stored events fold in one run', () => {
    const events = Array.from({ length: 200 }, (_, i) => kick(i, `P${i}.1000`, 'Boss.9', ago(400 - i)))
    expect(run({ auditEvents: events }).changed).toHaveLength(200)
  })

  test('a joined event after an open episode sets rejoinedAt; one before it does not', () => {
    const r = run({ auditEvents: [joinedEv(1, 'Back.1', ago(30)), kick(2, 'Back.1', 'Back.1', ago(20)), joinedEv(3, 'Back.1', ago(10))] })
    const d = docFor(r.changed, 'Back.1')!
    expect(d.episodes).toHaveLength(1)
    expect(d.episodes[0].rejoinedAt).toBe(ago(10))
  })

  test('rejoin then leave again produces a second, open episode', () => {
    const r = run({
      auditEvents: [kick(1, 'Yoyo.1', 'Boss.9', ago(30)), joinedEv(2, 'Yoyo.1', ago(20)), kick(3, 'Yoyo.1', 'Yoyo.1', ago(5))]
    })
    const d = docFor(r.changed, 'Yoyo.1')!
    expect(d.episodes.map((e) => [e.kind, e.rejoinedAt])).toEqual([
      ['left', null],
      ['kicked', ago(20)]
    ])
  })
})

describe('roster diff', () => {
  test('an account that vanished gets an unknown roster-diff episode at now', () => {
    const r = run({ previous: ['Stay.1000', 'Gone.2000'] })
    expect(r.skipped).toBeNull()
    expect(r.vanished).toEqual(['Gone.2000'])
    expect(docFor(r.changed, 'Gone.2000')!.episodes).toEqual([
      { kind: 'unknown', actor: null, at: NOW, source: 'roster-diff', auditUid: null, reason: '', rejoinedAt: null }
    ])
  })

  test('a diff is a no-op while the latest episode is still open', () => {
    const first = run({ auditEvents: [kick(1, 'Gone.2000', 'Boss.9', ago(1))] })
    const r = run({ previous: ['Stay.1000', 'Gone.2000'], existing: asMap(first.changed), auditEvents: [kick(1, 'Gone.2000', 'Boss.9', ago(1))] })
    expect(r.changed).toEqual([])
  })

  test('casing differences collapse into one record', () => {
    const r = run({ previous: ['Stay.1000', 'Gone.2000'], auditEvents: [kick(1, 'gone.2000', 'Boss.9', ago(1))] })
    expect(r.changed).toHaveLength(1)
    expect(r.changed[0].episodes).toHaveLength(1)
    expect(r.changed[0].episodes[0].kind).toBe('kicked')
  })
})

describe('upgrade window', () => {
  const diffOnly = (): Map<string, DepartureDoc> => {
    const r = run({ previous: ['Stay.1000', 'Gone.2000'] })
    const d = docFor(r.changed, 'Gone.2000')!
    d.episodes[0].reason = 'went quiet'
    return asMap([d])
  }

  test('a log event within ±7d upgrades the diff episode and keeps its reason', () => {
    const r = run({ existing: diffOnly(), auditEvents: [kick(9, 'Gone.2000', 'Boss.9', ago(3))] })
    expect(docFor(r.changed, 'Gone.2000')!.episodes).toEqual([
      { kind: 'kicked', actor: 'Boss.9', at: ago(3), source: 'gw2-log', auditUid: 'gw2:9', reason: 'went quiet', rejoinedAt: null }
    ])
  })

  test('a log event outside the window adds a separate episode', () => {
    const r = run({ existing: diffOnly(), auditEvents: [kick(9, 'Gone.2000', 'Boss.9', ago(10))] })
    expect(docFor(r.changed, 'Gone.2000')!.episodes.map((e) => e.source)).toEqual(['roster-diff', 'gw2-log'])
  })
})

describe('rejoin by roster presence', () => {
  const openDoc = (): Map<string, DepartureDoc> =>
    asMap(run({ auditEvents: [kick(1, 'Back.1', 'Boss.9', ago(30))] }).changed)

  test('uses the roster joined date when it is after the departure', () => {
    const r = run({ existing: openDoc(), current: [{ name: 'Back.1', joined: ago(3) }], auditEvents: [kick(1, 'Back.1', 'Boss.9', ago(30))] })
    expect(docFor(r.changed, 'Back.1')!.episodes[0].rejoinedAt).toBe(ago(3))
  })

  test('falls back to now when the joined date is missing', () => {
    const r = run({ existing: openDoc(), current: [{ name: 'back.1' }] })
    expect(docFor(r.changed, 'Back.1')!.episodes[0].rejoinedAt).toBe(NOW)
  })
})

describe('safety guards', () => {
  const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `M${i}.1000`)

  test('no snapshot: skip the diff, still fold the log', () => {
    const r = run({ previous: null, auditEvents: [kick(1, 'Gone.2000', 'Boss.9', ago(1))] })
    expect(r.skipped).toBe('no-snapshot')
    expect(r.vanished).toEqual([])
    expect(r.changed).toHaveLength(1)
  })

  test('empty pull: skip the diff and report nothing vanished', () => {
    const r = run({ previous: ['A.1', 'B.2'], current: [] })
    expect(r.skipped).toBe('empty-pull')
    expect(r.vanished).toEqual([])
    expect(r.changed).toEqual([])
  })

  test('mass drop (>25% and >5): no diff episodes, but vanished is reported', () => {
    const prev = names(20)
    const r = run({ previous: prev, current: prev.slice(0, 14).map((name) => ({ name })) })
    expect(r.skipped).toBe('mass-drop')
    expect(r.vanished).toHaveLength(6)
    expect(r.changed).toEqual([])
  })

  test('mass drop still folds log kicks', () => {
    const prev = names(20)
    const r = run({
      previous: prev,
      current: prev.slice(0, 14).map((name) => ({ name })),
      auditEvents: [kick(1, 'M19.1000', 'Boss.9', ago(1))]
    })
    expect(r.changed.map((d) => d.account)).toEqual(['M19.1000'])
  })

  test('a large fraction of a tiny roster is not a mass drop (needs >5)', () => {
    const r = run({ previous: ['A.1', 'B.2', 'C.3', 'D.4'], current: [{ name: 'A.1' }] })
    expect(r.skipped).toBeNull()
    expect(r.changed).toHaveLength(3)
  })
})

describe('idempotency and officer fields', () => {
  const input = (): Partial<DetectInput> => ({
    previous: ['Stay.1000', 'Gone.2000'],
    auditEvents: [kick(1, 'Gone.2000', 'Boss.9', ago(1))]
  })

  test('re-running on its own output changes nothing', () => {
    const first = run(input())
    const again = run({ ...input(), previous: ['Stay.1000'], existing: asMap(first.changed) })
    expect(again.changed).toEqual([])
  })

  test('two writers from the same state converge on the same doc', () => {
    const a = run(input())
    const b = run(input())
    expect(a.changed).toEqual(b.changed)
    expect(run({ ...input(), existing: asMap(a.changed) }).changed).toEqual([])
  })

  test('never mutates the existing map', () => {
    const existing = asMap(run(input()).changed)
    const snapshot = JSON.stringify([...existing.values()])
    run({ existing, current: [{ name: 'Gone.2000', joined: ago(0.5) }] })
    expect(JSON.stringify([...existing.values()])).toBe(snapshot)
  })

  test('officer fields are preserved, and a set memberId is never replaced', () => {
    const base = run({ previous: ['Stay.1000', 'Gone.2000'] }).changed[0]
    base.note = 'see thread'
    base.memberId = 'd9'
    base.dismissedSuggestions = ['d1']
    base.episodes[0].reason = 'inactive'
    const r = run({
      existing: asMap([base]),
      auditEvents: [kick(4, 'Gone.2000', 'Boss.9', ago(2))],
      links: [{ accountName: 'gone.2000', memberId: 'd2' }]
    })
    const d = docFor(r.changed, 'Gone.2000')!
    expect(d).toMatchObject({ note: 'see thread', memberId: 'd9', dismissedSuggestions: ['d1'] })
    expect(d.episodes[0].reason).toBe('inactive')
  })

  test('auto-link fills a null memberId from links, even with no new evidence', () => {
    const base = run({ previous: ['Stay.1000', 'Gone.2000'] }).changed[0]
    const r = run({ existing: asMap([base]), links: [{ accountName: 'GONE.2000', memberId: 'd2' }] })
    expect(r.changed).toHaveLength(1)
    expect(r.changed[0].memberId).toBe('d2')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- supabase/functions/_shared/departures.test.ts`
Expected: FAIL. `detectDepartures` is not exported.

- [ ] **Step 3: Implement**

Append to `supabase/functions/_shared/departures.ts`:

```ts
// ---- merge rules -------------------------------------------------------------

/** A gw2-log episode replaces an `unknown` roster-diff episode within this window. */
export const UPGRADE_WINDOW_MS = 7 * 86_400_000
/** The roster diff is skipped when MORE than this fraction AND more than
 *  MASS_DROP_MIN accounts vanish at once (API hiccup, wrong guild, purge). */
export const MASS_DROP_FRACTION = 0.25
export const MASS_DROP_MIN = 5

/** Minimal roster member (InGameMemberRaw / the edge GuildMember fit this). */
export interface DepartureRosterMember {
  name: string
  joined?: string | null
}

/** Minimal audit event (src/main/auditNormalize.ts AuditEvent fits this). For a
 *  gw2 `kick`, actor = the account removed and target = kicked_by. */
export interface DepartureAuditEvent {
  uid: string
  source: string
  type: string
  time: string
  actor?: string
  target?: string
}

export interface DepartureLink {
  accountName: string
  memberId: string
}

/** Fold one gw2-log episode in. Dedupes by auditUid; upgrades a nearby unknown
 *  roster-diff episode (keeping the officer's reason and any rejoin). */
export function applyLogEpisode(doc: DepartureDoc, ep: DepartureEpisode): boolean {
  if (ep.auditUid && doc.episodes.some((e) => e.auditUid === ep.auditUid)) return false
  const t = Date.parse(ep.at)
  const idx = doc.episodes.findIndex(
    (e) =>
      e.source === 'roster-diff' &&
      e.kind === 'unknown' &&
      Math.abs(Date.parse(e.at) - t) <= UPGRADE_WINDOW_MS
  )
  if (idx >= 0) {
    const old = doc.episodes[idx]
    doc.episodes[idx] = { ...ep, reason: old.reason, rejoinedAt: old.rejoinedAt }
  } else {
    doc.episodes.push(ep)
  }
  doc.episodes = sortEpisodes(doc.episodes)
  return true
}

/** Record a roster-diff departure, unless they are already recorded as gone. */
export function applyDiffEpisode(doc: DepartureDoc, at: string): boolean {
  if (isOpen(doc)) return false
  doc.episodes = sortEpisodes([
    ...doc.episodes,
    { kind: 'unknown', actor: null, at, source: 'roster-diff', auditUid: null, reason: '', rejoinedAt: null }
  ])
  return true
}

/** Close the latest open episode. A rejoin can't predate the departure it closes. */
export function applyRejoin(doc: DepartureDoc, at: string): boolean {
  const l = latestEpisode(doc)
  if (!l || l.rejoinedAt !== null) return false
  if (!(Date.parse(at) > Date.parse(l.at))) return false
  l.rejoinedAt = at
  return true
}

// ---- detection ---------------------------------------------------------------

export interface DetectInput {
  /** Account names seen at the last successful pull; null = no snapshot yet. */
  previous: string[] | null
  /** The fresh in-game roster; [] means the pull failed or was empty. */
  current: DepartureRosterMember[]
  /** Audit events of any age; only gw2 kick/joined are used. */
  auditEvents: DepartureAuditEvent[]
  /** Current records, keyed by departureKey(). Never mutated. */
  existing: Map<string, DepartureDoc>
  links: DepartureLink[]
  now: string
}

export type DiffSkip = 'no-snapshot' | 'empty-pull' | 'mass-drop'

export interface DetectResult {
  /** Only docs that changed, ready to write. */
  changed: DepartureDoc[]
  /** Accounts in `previous` missing from `current` (previous casing). Empty
   *  unless there was a snapshot and a non-empty pull; set even on mass-drop. */
  vanished: string[]
  skipped: DiffSkip | null
}

const clone = (d: DepartureDoc): DepartureDoc => JSON.parse(JSON.stringify(d)) as DepartureDoc

export function detectDepartures(input: DetectInput): DetectResult {
  const work = new Map<string, DepartureDoc>()
  const changed = new Set<string>()
  const known = (account: string): boolean => {
    const k = departureKey(account)
    return work.has(k) || input.existing.has(k)
  }
  const get = (account: string): DepartureDoc => {
    const k = departureKey(account)
    let d = work.get(k)
    if (!d) {
      const ex = input.existing.get(k)
      d = ex ? clone(ex) : emptyDepartureDoc(account)
      work.set(k, d)
    }
    return d
  }
  const mark = (account: string): void => void changed.add(departureKey(account))

  // 1. Audit fold, oldest first so kick → joined → kick sequences replay in order.
  //    The first run over the stored log IS the backfill.
  const events = input.auditEvents
    .filter((e) => e.source === 'gw2' && (e.type === 'kick' || e.type === 'joined') && e.actor && isIso(e.time))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
  for (const e of events) {
    const account = (e.actor as string).trim()
    if (e.type === 'kick') {
      const by = e.target?.trim() || null
      const kind: DepartureKind = by === null ? 'unknown' : lc(by) === lc(account) ? 'left' : 'kicked'
      const ep: DepartureEpisode = {
        kind,
        actor: kind === 'kicked' ? by : null,
        at: e.time,
        source: 'gw2-log',
        auditUid: e.uid,
        reason: '',
        rejoinedAt: null
      }
      if (applyLogEpisode(get(account), ep)) mark(account)
    } else if (known(account) && applyRejoin(get(account), e.time)) {
      mark(account)
    }
  }

  // 2. Roster diff, behind the safety guards.
  let skipped: DiffSkip | null = null
  let vanished: string[] = []
  if (input.previous === null) skipped = 'no-snapshot'
  else if (input.current.length === 0) skipped = 'empty-pull'
  else {
    const present = new Set(input.current.map((m) => lc(m.name)))
    const seen = new Set<string>()
    vanished = input.previous.filter((n) => {
      const k = lc(n)
      if (!k || present.has(k) || seen.has(k)) return false
      seen.add(k)
      return true
    })
    const massDrop =
      vanished.length > MASS_DROP_MIN && vanished.length > input.previous.length * MASS_DROP_FRACTION
    if (massDrop) skipped = 'mass-drop'
    else for (const name of vanished) if (applyDiffEpisode(get(name), input.now)) mark(name)
  }

  // 3. Rejoin by roster presence.
  for (const m of input.current) {
    if (!known(m.name)) continue
    const d = get(m.name)
    const l = latestEpisode(d)
    if (!l || l.rejoinedAt !== null) continue
    const at = isIso(m.joined) && Date.parse(m.joined) > Date.parse(l.at) ? m.joined : input.now
    if (applyRejoin(d, at)) mark(m.name)
  }

  // 4. Auto-link: fill memberId only while it is null.
  const linkBy = new Map(input.links.map((l) => [lc(l.accountName), l.memberId]))
  for (const k of new Set([...input.existing.keys(), ...work.keys()])) {
    const current = work.get(k) ?? input.existing.get(k)
    if (!current || current.memberId || current.episodes.length === 0) continue
    const id = linkBy.get(lc(current.account))
    if (!id) continue
    get(current.account).memberId = id
    changed.add(k)
  }

  const out = [...changed]
    .map((k) => work.get(k))
    .filter((d): d is DepartureDoc => Boolean(d && d.episodes.length > 0))
  return { changed: out, vanished, skipped }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- supabase/functions/_shared/departures.test.ts`
Expected: PASS, all tests from Tasks 2 and 3.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/departures.ts supabase/functions/_shared/departures.test.ts
git commit -m "feat(departures): merge rules and detectDepartures with safety guards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Record departures in the `refresh-roster` edge function

**Files:**
- Modify: `supabase/functions/refresh-roster/handler.ts`
- Modify: `supabase/functions/refresh-roster/index.ts`
- Test: `supabase/functions/refresh-roster/handler.test.ts`

**Interfaces:**
- Consumes: `detectDepartures`, `departureKey`, `parseDepartureDoc`, `serializeDepartureDoc` and the `DepartureAuditEvent` / `DepartureLink` types from `../_shared/departures.ts`.
- Produces:
  - **New `RefreshDeps.db` methods:**
    - `listMemberIds(ws): Promise<string[]>`
    - `listDepartures(ws): Promise<{ key: string; notes: string }[]>`
    - `listGw2Events(ws): Promise<DepartureAuditEvent[]>`
    - `listLinks(ws): Promise<DepartureLink[]>`
    - `upsertDepartures(ws, rows: { key: string; notes: string }[]): Promise<void>`
    - `deleteMembers(ws, ids: string[]): Promise<void>`
  - **New optional dep:** `RefreshDeps.now?: () => string`.
  - **The 200 body** becomes `{ count, departures, departuresError? }`.

- [ ] **Step 1: Write the failing tests**

In `supabase/functions/refresh-roster/handler.test.ts`, replace the `deps` helper with this version, which keeps existing behaviour and adds the new methods:

```ts
function deps(
  member: boolean,
  allowed: (ws: string) => Promise<boolean> = async () => true,
  over: Record<string, unknown> = {}
) {
  return {
    keySecret: 's', decrypt: vi.fn(async () => 'leaderkey'),
    allowed: vi.fn(allowed),
    now: () => '2026-10-12T12:00:00.000Z',
    fetchMembers: vi.fn(async () => [{ name: 'A.1', rank: 'Member', joined: null }]),
    db: {
      isMember: vi.fn(async () => member),
      getSecret: vi.fn(async () => 'enc'),
      upsertMembers: vi.fn(async () => {}),
      listMemberIds: vi.fn(async () => [] as string[]),
      listDepartures: vi.fn(async () => [] as { key: string; notes: string }[]),
      listGw2Events: vi.fn(async () => []),
      listLinks: vi.fn(async () => []),
      upsertDepartures: vi.fn(async () => {}),
      deleteMembers: vi.fn(async () => {}),
      ...over
    }
  }
}
```

Append these tests:

```ts
test('a departed account is recorded and its stale roster row deleted', async () => {
  const d = deps(true, undefined, { listMemberIds: vi.fn(async () => ['A.1', 'Gone.2']) })
  const r = await handleRefresh(d as any, { userId: 'u', guildId: 'g' })
  expect(r).toEqual({ status: 200, body: { count: 1, departures: 1 } })
  const rows = d.db.upsertDepartures.mock.calls[0][1] as { key: string; notes: string }[]
  expect(rows.map((x) => x.key)).toEqual(['departure:gone.2'])
  expect(JSON.parse(rows[0].notes).episodes[0]).toMatchObject({ kind: 'unknown', source: 'roster-diff' })
  expect(d.db.deleteMembers).toHaveBeenCalledWith('g', ['Gone.2'])
})

test('the previous roster is read before the upsert overwrites it', async () => {
  const d = deps(true)
  await handleRefresh(d as any, { userId: 'u', guildId: 'g' })
  expect(d.db.listMemberIds.mock.invocationCallOrder[0]).toBeLessThan(
    d.db.upsertMembers.mock.invocationCallOrder[0]
  )
})

test('the first refresh (no rows yet) records no diff departures and deletes nothing', async () => {
  const d = deps(true)
  const r = await handleRefresh(d as any, { userId: 'u', guildId: 'g' })
  expect(r.body).toEqual({ count: 1, departures: 0 })
  expect(d.db.upsertDepartures).not.toHaveBeenCalled()
  expect(d.db.deleteMembers).not.toHaveBeenCalled()
})

test('stale rows on first deploy are deleted without bogus episodes', async () => {
  const stale = Array.from({ length: 10 }, (_, i) => `Old${i}.1`)
  const d = deps(true, undefined, { listMemberIds: vi.fn(async () => ['A.1', ...stale]) })
  const r = await handleRefresh(d as any, { userId: 'u', guildId: 'g' })
  expect(r.body).toEqual({ count: 1, departures: 0 })
  expect(d.db.upsertDepartures).not.toHaveBeenCalled()
  expect(d.db.deleteMembers).toHaveBeenCalledWith('g', stale)
})

test('a log kick is recorded from audit_events', async () => {
  const d = deps(true, undefined, {
    listMemberIds: vi.fn(async () => ['A.1']),
    listGw2Events: vi.fn(async () => [
      { uid: 'gw2:7', source: 'gw2', type: 'kick', time: '2026-10-10T00:00:00.000Z', actor: 'Bad.3', target: 'Boss.9' }
    ])
  })
  await handleRefresh(d as any, { userId: 'u', guildId: 'g' })
  const rows = d.db.upsertDepartures.mock.calls[0][1] as { key: string; notes: string }[]
  expect(JSON.parse(rows[0].notes).episodes[0]).toMatchObject({ kind: 'kicked', actor: 'Boss.9', auditUid: 'gw2:7' })
})

test('a departures failure still returns 200 with departuresError', async () => {
  const d = deps(true, undefined, {
    listMemberIds: vi.fn(async () => ['A.1', 'Gone.2']),
    listDepartures: vi.fn(async () => { throw new Error('boom') })
  })
  const r = await handleRefresh(d as any, { userId: 'u', guildId: 'g' })
  expect(r).toEqual({ status: 200, body: { count: 1, departures: 0, departuresError: 'boom' } })
  expect(d.db.upsertMembers).toHaveBeenCalled()
  expect(d.db.deleteMembers).not.toHaveBeenCalled()
})

test('a failed previous-roster read still upserts members', async () => {
  const d = deps(true, undefined, { listMemberIds: vi.fn(async () => { throw new Error('read failed') }) })
  const r = await handleRefresh(d as any, { userId: 'u', guildId: 'g' })
  expect(r).toEqual({ status: 200, body: { count: 1, departures: 0, departuresError: 'read failed' } })
  expect(d.db.upsertMembers).toHaveBeenCalled()
  expect(d.db.listDepartures).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- supabase/functions/refresh-roster/handler.test.ts`
Expected: FAIL. The new tests fail because the body lacks `departures` and `upsertDepartures` is not called. The existing tests still pass.

- [ ] **Step 3: Implement the handler**

Replace `supabase/functions/refresh-roster/handler.ts` with:

```ts
// supabase/functions/refresh-roster/handler.ts
import { decryptKey } from '../_shared/crypto.ts'
import type { GuildMember } from '../_shared/gw2.ts'
import { UNAVAILABLE } from '../_shared/policy.ts'
import {
  detectDepartures,
  departureKey,
  parseDepartureDoc,
  serializeDepartureDoc,
  type DepartureAuditEvent,
  type DepartureLink
} from '../_shared/departures.ts'

export interface RefreshDeps {
  keySecret: string
  decrypt: typeof decryptKey
  fetchMembers: (apiKey: string, guildId: string) => Promise<GuildMember[]>
  /** The RLS predicate is_member(ws) asked as the caller (rlsMember): false for a revoked member. */
  allowed(ws: string): Promise<boolean>
  now?: () => string
  db: {
    isMember(ws: string, uid: string): Promise<boolean>
    getSecret(ws: string): Promise<string | null>
    upsertMembers(ws: string, rows: Record<string, unknown>[]): Promise<void>
    /** member_id of every roster_members row — the previous roster. */
    listMemberIds(ws: string): Promise<string[]>
    /** departure:* rows from roster_annotations. */
    listDepartures(ws: string): Promise<{ key: string; notes: string }[]>
    /** The workspace's gw2 kick + joined audit events. */
    listGw2Events(ws: string): Promise<DepartureAuditEvent[]>
    listLinks(ws: string): Promise<DepartureLink[]>
    upsertDepartures(ws: string, rows: { key: string; notes: string }[]): Promise<void>
    deleteMembers(ws: string, ids: string[]): Promise<void>
  }
}

export async function handleRefresh(deps: RefreshDeps, input: { userId: string; guildId: string }) {
  if (!(await deps.db.isMember(input.guildId, input.userId)))
    return { status: 403, body: { error: 'not_member' } }
  // Axi access policy: the leader key is read through the service role.
  if (!(await deps.allowed(input.guildId))) return { status: 403, body: UNAVAILABLE }
  const enc = await deps.db.getSecret(input.guildId)
  if (!enc) return { status: 409, body: { error: 'no_key' } }
  const apiKey = await deps.decrypt(enc, deps.keySecret)
  const members = await deps.fetchMembers(apiKey, input.guildId)

  // The previous roster must be read BEFORE the upsert overwrites it. An empty
  // table means this guild was never refreshed: no snapshot, so no diff.
  let previous: string[] | null = null
  let departuresError: string | undefined
  try {
    const ids = await deps.db.listMemberIds(input.guildId)
    previous = ids.length ? ids : null
  } catch (e) {
    departuresError = (e as Error).message
  }

  const rows = members.map((m) => ({
    workspace_id: input.guildId, member_id: m.name, payload: m
  }))
  await deps.db.upsertMembers(input.guildId, rows)

  // Departures never fail the refresh: errors are reported, the response stays 200.
  let departures = 0
  if (departuresError === undefined) {
    try {
      departures = await recordDepartures(deps, input.guildId, previous, members)
    } catch (e) {
      departuresError = (e as Error).message
    }
  }
  const body: Record<string, unknown> = { count: rows.length, departures }
  if (departuresError !== undefined) body.departuresError = departuresError
  return { status: 200, body }
}

async function recordDepartures(
  deps: RefreshDeps,
  ws: string,
  previous: string[] | null,
  members: GuildMember[]
): Promise<number> {
  const [rows, auditEvents, links] = await Promise.all([
    deps.db.listDepartures(ws),
    deps.db.listGw2Events(ws),
    deps.db.listLinks(ws)
  ])
  const existing = new Map(rows.map((r) => [r.key, parseDepartureDoc(r.key, r.notes)]))
  const res = detectDepartures({
    previous,
    current: members,
    auditEvents,
    existing,
    links,
    now: (deps.now ?? (() => new Date().toISOString()))()
  })
  if (res.changed.length) {
    await deps.db.upsertDepartures(
      ws,
      res.changed.map((d) => ({ key: departureKey(d.account), notes: serializeDepartureDoc(d) }))
    )
  }
  // A non-empty pull is authoritative for who is in the guild, so stale rows go
  // even when the mass-drop guard skipped recording diff episodes.
  if (members.length && res.vanished.length) await deps.db.deleteMembers(ws, res.vanished)
  return res.changed.length
}
```

- [ ] **Step 4: Implement the real deps**

In `supabase/functions/refresh-roster/index.ts`, extend the `db` object (after `upsertMembers`):

```ts
      listMemberIds: async (ws: string) => {
        const { data, error } = await db.from('roster_members').select('member_id').eq('workspace_id', ws)
        if (error) throw new Error(error.message)
        return (data ?? []).map((r: any) => String(r.member_id))
      },
      listDepartures: async (ws: string) => {
        const { data, error } = await db.from('roster_annotations').select('member_id, notes')
          .eq('workspace_id', ws).like('member_id', 'departure:%')
        if (error) throw new Error(error.message)
        return (data ?? []).map((r: any) => ({ key: String(r.member_id), notes: typeof r.notes === 'string' ? r.notes : '' }))
      },
      listGw2Events: async (ws: string) => {
        // PostgREST caps a select at 1000 rows; page through the whole log.
        const out: any[] = []
        for (let from = 0; ; from += 1000) {
          const { data, error } = await db.from('audit_events').select('uid, source, type, actor, target, ts')
            .eq('workspace_id', ws).eq('source', 'gw2').in('type', ['kick', 'joined'])
            .order('ts', { ascending: true }).range(from, from + 999)
          if (error) throw new Error(error.message)
          for (const r of data ?? []) {
            out.push({ uid: r.uid, source: r.source, type: r.type, time: r.ts, actor: r.actor || undefined, target: r.target || undefined })
          }
          if (!data || data.length < 1000) break
        }
        return out
      },
      listLinks: async (ws: string) => {
        const { data, error } = await db.from('roster_links').select('account_name, member_id').eq('workspace_id', ws)
        if (error) throw new Error(error.message)
        return (data ?? []).map((r: any) => ({ accountName: String(r.account_name), memberId: String(r.member_id) }))
      },
      upsertDepartures: async (ws: string, rows: { key: string; notes: string }[]) => {
        const at = new Date().toISOString()
        const { error } = await db.from('roster_annotations').upsert(
          rows.map((r) => ({ workspace_id: ws, member_id: r.key, notes: r.notes, updated_at: at })),
          { onConflict: 'workspace_id,member_id' }
        )
        if (error) throw new Error(error.message)
      },
      deleteMembers: async (ws: string, ids: string[]) => {
        const { error } = await db.from('roster_members').delete().eq('workspace_id', ws).in('member_id', ids)
        if (error) throw new Error(error.message)
      }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- supabase/functions/refresh-roster/handler.test.ts`
Expected: PASS, both the old and the new tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/refresh-roster/handler.ts supabase/functions/refresh-roster/index.ts supabase/functions/refresh-roster/handler.test.ts
git commit -m "feat(departures): record departures and drop stale rows in refresh-roster

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Desktop snapshot store and the `syncDepartures` orchestrator

**Files:**
- Create: `src/main/departureSnapshotStore.ts`
- Create: `src/main/departureSnapshotStore.test.ts`
- Create: `src/main/departureSync.ts`
- Create: `src/main/departureSync.test.ts`

**Interfaces:**
- Consumes (from `../shared/departures`): `detectDepartures`, `parseDepartureDoc`, `serializeDepartureDoc`, `departureKey`, `DEPARTURE_PREFIX`, `DepartureAuditEvent`, `DepartureLink`, `DepartureRosterMember`, `DepartureDoc`.
- Produces:
  - **Snapshot store:** `class DepartureSnapshotStore { constructor(dir: string); read(guildId: string): string[] | null; write(guildId: string, accounts: string[]): void }`
  - **Orchestrator deps:** `interface DepartureSyncDeps { snapshot: { read(): string[] | null; write(accounts: string[]): void }; auditEvents(): DepartureAuditEvent[]; reservedRows(): { memberId: string; notes: string }[]; links: DepartureLink[]; save(key: string, notes: string): Promise<void>; log(msg: string): void; now(): string }`
  - **Orchestrator:** `syncDepartures(deps: DepartureSyncDeps, current: DepartureRosterMember[]): Promise<number>`, which returns the number of docs written.

- [ ] **Step 1: Write the failing tests**

Create `src/main/departureSnapshotStore.test.ts`:

```ts
import { test, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DepartureSnapshotStore } from './departureSnapshotStore'

const dir = (): string => mkdtempSync(join(tmpdir(), 'dep-snap-'))

test('no file yet → null (no snapshot)', () => {
  expect(new DepartureSnapshotStore(dir()).read('g1')).toBeNull()
})

test('write → read round-trips', () => {
  const s = new DepartureSnapshotStore(dir())
  s.write('g1', ['A.1', 'B.2'])
  expect(s.read('g1')).toEqual(['A.1', 'B.2'])
})

test('guilds are isolated', () => {
  const s = new DepartureSnapshotStore(dir())
  s.write('g1', ['A.1'])
  s.write('g2', ['Z.9'])
  expect(s.read('g1')).toEqual(['A.1'])
  expect(s.read('g2')).toEqual(['Z.9'])
})

test('a corrupt file reads as null', () => {
  const d = dir()
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'g1.json'), '{nope')
  expect(new DepartureSnapshotStore(d).read('g1')).toBeNull()
})
```

Create `src/main/departureSync.test.ts`:

```ts
import { test, expect, vi } from 'vitest'
import { syncDepartures, type DepartureSyncDeps } from './departureSync'

const NOW = '2026-10-12T12:00:00.000Z'

function deps(over: Partial<DepartureSyncDeps> = {}) {
  const written: Record<string, string> = {}
  let snap: string[] | null = ['A.1', 'Gone.2']
  const d: DepartureSyncDeps = {
    snapshot: { read: () => snap, write: (a) => { snap = a } },
    auditEvents: () => [],
    reservedRows: () => [],
    links: [],
    save: vi.fn(async (key: string, notes: string) => { written[key] = notes }),
    log: vi.fn(),
    now: () => NOW,
    ...over
  }
  return { d, written, snap: () => snap }
}

test('records a vanished account and rewrites the snapshot', async () => {
  const t = deps()
  expect(await syncDepartures(t.d, [{ name: 'A.1' }])).toBe(1)
  expect(Object.keys(t.written)).toEqual(['departure:gone.2'])
  expect(t.snap()).toEqual(['A.1'])
})

test('an empty pull touches nothing, including the snapshot', async () => {
  const t = deps()
  expect(await syncDepartures(t.d, [])).toBe(0)
  expect(t.d.save).not.toHaveBeenCalled()
  expect(t.snap()).toEqual(['A.1', 'Gone.2'])
})

test('existing departure rows are respected (idempotent re-run)', async () => {
  const t = deps()
  await syncDepartures(t.d, [{ name: 'A.1' }])
  const rows = Object.entries(t.written).map(([memberId, notes]) => ({ memberId, notes }))
  const again = deps({ reservedRows: () => [...rows, { memberId: 'meta:pipeline', notes: '{}' }] })
  expect(await syncDepartures(again.d, [{ name: 'A.1' }])).toBe(0)
})

test('a failing audit store or snapshot is logged and skipped', async () => {
  const t = deps({
    auditEvents: () => { throw new Error('audit down') },
    snapshot: { read: () => { throw new Error('disk') }, write: () => {} }
  })
  expect(await syncDepartures(t.d, [{ name: 'A.1' }])).toBe(0)
  expect(t.d.log).toHaveBeenCalledTimes(2)
})

test('a mass drop is logged', async () => {
  const prev = Array.from({ length: 20 }, (_, i) => `M${i}.1`)
  const t = deps({ snapshot: { read: () => prev, write: () => {} } })
  await syncDepartures(t.d, prev.slice(0, 10).map((name) => ({ name })))
  expect(t.d.log).toHaveBeenCalledWith(expect.stringContaining('mass'))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/main/departureSnapshotStore.test.ts src/main/departureSync.test.ts`
Expected: FAIL. The modules cannot be resolved.

- [ ] **Step 3: Implement**

Create `src/main/departureSnapshotStore.ts`:

```ts
// src/main/departureSnapshotStore.ts
//
// userData/departureSnapshots/<guildId>.json — the account names seen at the
// last successful live GW2 roster pull, per guild. The roster diff in
// detectDepartures runs against it. Atomic tmp+rename writes; a missing or
// corrupt file reads as null (= no snapshot, so no diff), never throws on read.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

export class DepartureSnapshotStore {
  constructor(private readonly dir: string) {}

  private path(guildId: string): string {
    return join(this.dir, `${guildId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`)
  }

  read(guildId: string): string[] | null {
    const p = this.path(guildId)
    if (!existsSync(p)) return null
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as { accounts?: unknown }
      return Array.isArray(parsed.accounts)
        ? parsed.accounts.filter((a): a is string => typeof a === 'string')
        : null
    } catch {
      return null
    }
  }

  write(guildId: string, accounts: string[]): void {
    mkdirSync(this.dir, { recursive: true })
    const p = this.path(guildId)
    const tmp = `${p}.tmp`
    writeFileSync(tmp, JSON.stringify({ accounts, at: new Date().toISOString() }), { mode: 0o600 })
    renameSync(tmp, p)
  }
}
```

Create `src/main/departureSync.ts`:

```ts
// src/main/departureSync.ts
//
// Desktop side of departure detection: after a successful live GW2 pull, fold the
// guild's audit log + the roster diff into departure:* annotation rows. Each
// failing source is logged and skipped; nothing here may block the roster.
import {
  detectDepartures,
  parseDepartureDoc,
  serializeDepartureDoc,
  departureKey,
  DEPARTURE_PREFIX,
  type DepartureAuditEvent,
  type DepartureDoc,
  type DepartureLink,
  type DepartureRosterMember
} from '../shared/departures'

export interface DepartureSyncDeps {
  snapshot: { read(): string[] | null; write(accounts: string[]): void }
  auditEvents(): DepartureAuditEvent[]
  /** The active guild's annotation rows (reserved rows included). */
  reservedRows(): { memberId: string; notes: string }[]
  links: DepartureLink[]
  /** Persist one departure row (local store + sync push). */
  save(key: string, notes: string): Promise<void>
  log(msg: string): void
  now(): string
}

export async function syncDepartures(
  deps: DepartureSyncDeps,
  current: DepartureRosterMember[]
): Promise<number> {
  // A failed or empty pull says nothing about who left: keep the old snapshot.
  if (current.length === 0) return 0

  let auditEvents: DepartureAuditEvent[] = []
  try {
    auditEvents = deps.auditEvents()
  } catch (e) {
    deps.log(`departures: audit log unavailable: ${(e as Error).message}`)
  }
  let previous: string[] | null = null
  try {
    previous = deps.snapshot.read()
  } catch (e) {
    deps.log(`departures: snapshot unreadable: ${(e as Error).message}`)
  }

  const existing = new Map<string, DepartureDoc>()
  for (const r of deps.reservedRows()) {
    if (r.memberId.startsWith(DEPARTURE_PREFIX)) existing.set(r.memberId, parseDepartureDoc(r.memberId, r.notes))
  }

  const res = detectDepartures({ previous, current, auditEvents, existing, links: deps.links, now: deps.now() })
  if (res.skipped === 'mass-drop') {
    deps.log(`departures: ${res.vanished.length} accounts vanished at once (mass drop); roster diff skipped`)
  }

  let written = 0
  for (const doc of res.changed) {
    try {
      await deps.save(departureKey(doc.account), serializeDepartureDoc(doc))
      written++
    } catch (e) {
      deps.log(`departures: failed to save ${doc.account}: ${(e as Error).message}`)
    }
  }
  try {
    deps.snapshot.write(current.map((m) => m.name))
  } catch (e) {
    deps.log(`departures: snapshot write failed: ${(e as Error).message}`)
  }
  return written
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/main/departureSnapshotStore.test.ts src/main/departureSync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/departureSnapshotStore.ts src/main/departureSnapshotStore.test.ts src/main/departureSync.ts src/main/departureSync.test.ts
git commit -m "feat(departures): desktop snapshot store and syncDepartures orchestrator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Desktop wiring and the `departuresGet` client method

**Files:**
- Modify: `src/main/index.ts` (`buildRoster` at about lines 298-340, the IPC registration near `roster:annotation:remove`, and app init near line 1650)
- Modify: `src/preload/index.ts`, `src/preload/index.d.ts`
- Create: `src/renderer/src/lib/webClient/departures.ts`
- Create: `src/renderer/src/lib/webClient/departures.test.ts`
- Modify: `src/renderer/src/lib/webClient/webClient.ts`, `src/renderer/src/lib/webClient/webClient.test.ts`

**Interfaces:**
- Consumes: `syncDepartures` and `DepartureSnapshotStore` (Task 5), `DEPARTURE_PREFIX` (Task 2), and `MAX_AUDIT_EVENTS` from `src/main/audit/auditCore.ts`.
- Produces:
  - **Client contract:** `AxiRosterApi.departuresGet(): Promise<DepartureRow[]>`, where `DepartureRow = { key: string; notes: string }` is exported from `src/preload/index.d.ts`. Desktop uses the `departures:list` IPC; web reads `roster_annotations`.
  - **Writes need no new method.** Callers use the existing `client.upsertAnnotation(key, { notes })`. It already persists and syncs reserved rows on both desktop and web.
  - **Desktop detection** runs inside `buildRoster`, so a renderer that awaits `buildRoster()` and *then* calls `departuresGet()` sees fresh rows.

- [ ] **Step 1: Write the failing web tests**

Create `src/renderer/src/lib/webClient/departures.test.ts`. `activeWorkspaceId` resolves memberships through several queries, so it is mocked here:

```ts
import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('./discordGw2', () => ({ activeWorkspaceId: vi.fn(async () => 'w1') }))

import { webDeparturesGet } from './departures'
import { createWebSettings } from './settings'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() { return m.size }
  } as Storage
}

function builder(rows: unknown, error: unknown = null) {
  const eq = vi.fn(() => b)
  const like = vi.fn(() => b)
  const b: Record<string, unknown> = {
    select: () => b,
    eq,
    like,
    then: (res: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve({ data: rows, error }).then(res)
  }
  return Object.assign(b, { eq, like })
}

const sb = (ann: ReturnType<typeof builder>): SupabaseClient =>
  ({ from: (t: string) => (t === 'roster_annotations' ? ann : undefined) }) as unknown as SupabaseClient

test('reads departure:* rows for the active workspace', async () => {
  const ann = builder([{ member_id: 'departure:foo.1', notes: '{"account":"Foo.1"}' }, { member_id: 'departure:bar.2', notes: null }])
  const rows = await webDeparturesGet(sb(ann), createWebSettings(fakeStorage()))
  expect(ann.eq).toHaveBeenCalledWith('workspace_id', 'w1')
  expect(ann.like).toHaveBeenCalledWith('member_id', 'departure:%')
  expect(rows).toEqual([
    { key: 'departure:foo.1', notes: '{"account":"Foo.1"}' },
    { key: 'departure:bar.2', notes: '' }
  ])
})

test('a query error reads as no departures', async () => {
  expect(await webDeparturesGet(sb(builder(null, { message: 'x' })), createWebSettings(fakeStorage()))).toEqual([])
})
```

Append to `src/renderer/src/lib/webClient/webClient.test.ts`. Reuse the file's existing `fakeStorage` helper.

```ts
test('departuresGet returns [] without supabase', async () => {
  expect(await createWebClient({ storage: fakeStorage() }).departuresGet()).toEqual([])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/renderer/src/lib/webClient/departures.test.ts src/renderer/src/lib/webClient/webClient.test.ts`
Expected: FAIL. `./departures` is missing and `departuresGet` is not a function.

- [ ] **Step 3: Implement the contract and the web side**

In `src/preload/index.d.ts`:
- Add near `RosterLink`:

  ```ts
  /** A raw departure:* annotation row; parse with shared/departures parseDepartureDoc. */
  export interface DepartureRow {
    key: string
    notes: string
  }
  ```

- Add to `AxiRosterApi`, after `removeLink`:

  ```ts
    /** The active guild's departure:* rows. Write them with upsertAnnotation(key, { notes }). */
    departuresGet(): Promise<DepartureRow[]>
  ```

In `src/preload/index.ts`, next to `refreshRoster`:

```ts
  departuresGet: () => ipcRenderer.invoke('departures:list'),
```

Create `src/renderer/src/lib/webClient/departures.ts`:

```ts
// src/renderer/src/lib/webClient/departures.ts
// Web read of the departure:* reserved annotation rows. Writes reuse
// webUpsertAnnotation; detection runs server-side in refresh-roster.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DepartureRow } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { activeWorkspaceId } from './discordGw2'

export async function webDeparturesGet(sb: SupabaseClient, settings: WebSettings): Promise<DepartureRow[]> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return []
  const { data, error } = await sb
    .from('roster_annotations')
    .select('member_id, notes')
    .eq('workspace_id', ws)
    .like('member_id', 'departure:%')
  if (error) return []
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    key: String(r.member_id),
    notes: typeof r.notes === 'string' ? r.notes : ''
  }))
}
```

In `src/renderer/src/lib/webClient/webClient.ts`:
- Add the import:

  ```ts
  import { webDeparturesGet } from './departures'
  ```

- Add the entry after `removeLink`:

  ```ts
    departuresGet: async () => (deps.supabase ? webDeparturesGet(deps.supabase, settings) : []),
  ```

- [ ] **Step 4: Wire the desktop main process**

In `src/main/index.ts`:

1. Add the imports:

   ```ts
   import { DepartureSnapshotStore } from './departureSnapshotStore'
   import { syncDepartures } from './departureSync'
   import { DEPARTURE_PREFIX } from '../shared/departures'
   ```

   Then extend the existing `import { auditWsConnFor } from './audit/auditCore'` (line 18) to `import { auditWsConnFor, MAX_AUDIT_EVENTS } from './audit/auditCore'`.

2. Add a module-level `let departureSnapshots: DepartureSnapshotStore` next to the other store `let`s, such as `roster`.

3. In the init block, after `links = new LinkStore(...)` (about line 1652):

   ```ts
     departureSnapshots = new DepartureSnapshotStore(join(userData, 'departureSnapshots'))
   ```

4. In `buildRoster()`, capture the live pull and run detection after assembly. Replace the `inGameMembers` dep and the final `return assembleRoster(deps)`:

   ```ts
     // The live pull, captured for departure detection (null when not pulled).
     let livePull: InGameMemberRaw[] | null = null
   ```

   Put this declaration above `const deps`, then use:

   ```ts
       inGameMembers: async (gid) => {
         const members = await withTimeout('GW2 members', gw2().guildMembers(gid))
         livePull = members
         return members
       },
   ```

   and

   ```ts
     const payload = await assembleRoster(deps)
     // TS doesn't see the closure assignment above, so re-widen before testing it.
     const pulled = livePull as InGameMemberRaw[] | null
     if (g && pulled) await recordDepartures(g.id, pulled, payload)
     return payload
   ```

5. Add the helper below `buildRoster`:

   ```ts
   /** Fold the live pull + audit log into departure:* rows. Never throws: the
    *  roster must load even if detection breaks. */
   async function recordDepartures(guildId: string, live: InGameMemberRaw[], payload: RosterPayload): Promise<void> {
     try {
       const links = payload.members.flatMap((m) =>
         m.memberId ? m.accounts.map((a) => ({ accountName: a.account_name, memberId: m.memberId as string })) : []
       )
       await syncDepartures(
         {
           snapshot: {
             read: () => departureSnapshots.read(guildId),
             write: (accounts) => departureSnapshots.write(guildId, accounts)
           },
           auditEvents: () => auditStore?.list({ source: 'gw2', limit: MAX_AUDIT_EVENTS }) ?? [],
           reservedRows: () => roster.list(),
           links,
           save: async (key, notes) => {
             const rec = roster.upsert(key, { notes })
             if (rec) await sync.pushAnnotation(rec).catch(() => {})
           },
           log: (msg) => console.warn(msg),
           now: () => new Date().toISOString()
         },
         live
       )
     } catch (e) {
       console.warn(`departures: detection failed: ${(e as Error).message}`)
     }
   }
   ```

6. Register the IPC next to `roster:annotation:remove`:

   ```ts
     ipcMain.handle('departures:list', () =>
       roster
         .list()
         .filter((a) => a.memberId.startsWith(DEPARTURE_PREFIX))
         .map((a) => ({ key: a.memberId, notes: a.notes }))
     )
   ```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test -- src/renderer/src/lib/webClient src/main`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/lib/webClient/departures.ts src/renderer/src/lib/webClient/departures.test.ts src/renderer/src/lib/webClient/webClient.ts src/renderer/src/lib/webClient/webClient.test.ts
git commit -m "feat(departures): run detection after live pulls; add departuresGet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Renderer view-model helpers

**Files:**
- Create: `src/renderer/src/lib/departures.ts`
- Create: `src/renderer/src/lib/departures.test.ts`

**Interfaces:**
- Consumes: `ReconciledMember` from `preload/index.d`; `Tone` from `./status`; `DepartureDoc`, `DepartureEpisode`, `DepartureKind`, `latestEpisode`, `sortEpisodes` and `departureKey` from `../../../shared/departures`.
- Produces:
  - **Filters and labels:**
    - `DepartedFilter = 'all' | 'flagged' | 'left' | 'kicked' | 'unknown' | 'rejoined'`
    - `DEPARTED_FILTERS: DepartedFilter[]`
    - `DEPARTED_META: Record<Exclude<DepartedFilter, 'all'>, { tone: Tone; label: string }>`
  - **Suggestions:**
    - `RoleHolder { id: string; name: string; displayName: string }`
    - `handleOf(account: string): string`
    - `roleHolders(members: ReconciledMember[]): RoleHolder[]`
    - `suggestMatch(account: string, holders: RoleHolder[], dismissed: string[]): RoleHolder | null`
  - **Rows:**
    - `DepartedStatus = 'left' | 'kicked' | 'unknown' | 'rejoined'`
    - `DepartedRow { key; doc; latest: DepartureEpisode; status: DepartedStatus; memberId: string | null; member: ReconciledMember | null; suggestion: RoleHolder | null; flagged: boolean }`
    - `buildDepartedRows(docs, members, memberRoleId): DepartedRow[]`
    - `sortDepartedRows(rows): DepartedRow[]`
    - `filterDepartedRows(rows, filter, query): DepartedRow[]`
    - `countDeparted(rows): Record<DepartedFilter, number>`
  - **Doc edits** (each returns a new doc):
    - `replaceDoc(docs, doc): DepartureDoc[]`
    - `linkDoc(doc, memberId: string | null)`
    - `dismissSuggestion(doc, id)`
    - `setDocNote(doc, note)`
    - `setEpisodeReason(doc, index, reason)`
    - `addManualEpisode(doc, { kind, actor, at })`
  - **Previous kick:**
    - `PreviousKick { account: string; episode: DepartureEpisode }`
    - `previousKick(docs, { accounts: string[]; memberId: string | null }): PreviousKick | null`
    - `kickTooltip(k: PreviousKick): string`
  - **Role removal:**
    - `roleActionBlocker({ canEdit, discordConfigured, memberRoleId }): string | null`
    - `RoleTarget { key: string; memberId: string; label: string }`
    - `removeRoles(targets, act, onProgress?): Promise<{ removed: string[]; failed: { key: string; label: string; error: string }[] }>`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/lib/departures.test.ts`:

```ts
import { describe, test, expect, vi } from 'vitest'
import type { ReconciledMember } from '../../../preload/index.d'
import type { DepartureDoc } from '../../../shared/departures'
import {
  handleOf, roleHolders, suggestMatch, buildDepartedRows, sortDepartedRows, filterDepartedRows,
  countDeparted, replaceDoc, linkDoc, dismissSuggestion, setDocNote, setEpisodeReason,
  addManualEpisode, previousKick, kickTooltip, roleActionBlocker, removeRoles
} from './departures'

const member = (over: Partial<ReconciledMember>): ReconciledMember => ({
  memberId: null, annotationKey: 'x', hasMemberRole: false, roles: [], accounts: [], linkSource: null,
  guildLabels: [], linked: false, inGuild: false, status: 'no-key', nickname: '', aliases: [], notes: '',
  tags: [], label: 'x', ...over
})
const ep = (over: Partial<DepartureDoc['episodes'][number]> = {}) => ({
  kind: 'left' as const, actor: null, at: '2026-10-01T00:00:00.000Z', source: 'gw2-log' as const,
  auditUid: null, reason: '', rejoinedAt: null, ...over
})
const doc = (account: string, over: Partial<DepartureDoc> = {}): DepartureDoc => ({
  account, memberId: null, dismissedSuggestions: [], note: '', episodes: [ep()], ...over
})

describe('suggestions', () => {
  const holders = [
    { id: 'd1', name: 'foo', displayName: 'Foo' },
    { id: 'd2', name: 'foobarian', displayName: 'FB' },
    { id: 'd3', name: 'zed', displayName: 'Zeddicus' }
  ]
  test('handleOf strips the 4-digit suffix and lowercases', () => {
    expect(handleOf(' Foo.1234 ')).toBe('foo')
    expect(handleOf('Odd Name')).toBe('odd name')
  })
  test('an exact name or display-name match wins', () => {
    expect(suggestMatch('Foo.1234', holders, [])?.id).toBe('d1')
    expect(suggestMatch('Zeddicus.9999', holders, [])?.id).toBe('d3')
  })
  test('a unique partial match is suggested', () => {
    expect(suggestMatch('barian.1111', holders, [])?.id).toBe('d2')
  })
  test('ambiguous partial matches give no suggestion', () => {
    expect(suggestMatch('fooba.1111', [...holders, { id: 'd4', name: 'foobaz', displayName: '' }], [])).toBeNull()
  })
  test('short handles never partial-match', () => {
    expect(suggestMatch('ze.1234', holders, [])).toBeNull()
  })
  test('dismissed ids are excluded', () => {
    expect(suggestMatch('Foo.1234', holders, ['d1'])?.id).toBe('d2')
  })
  test('only role holders are candidates', () => {
    const ms = [
      member({ memberId: 'd1', hasMemberRole: true, discordName: 'foo' }),
      member({ memberId: 'd9', hasMemberRole: false, discordName: 'bar' })
    ]
    expect(roleHolders(ms).map((h) => h.id)).toEqual(['d1'])
  })
})

describe('rows', () => {
  const members = [
    member({ memberId: 'd1', hasMemberRole: true, discordName: 'gone', accounts: [{ account_name: 'Gone.2', characters: [], inGuild: false, manual: false, main: true }] }),
    member({ memberId: 'd2', hasMemberRole: true, discordName: 'quit' })
  ]

  test('a member linked by account is resolved and flagged while gone with the role', () => {
    const [r] = buildDepartedRows([doc('Gone.2')], members, 'role1')
    expect(r).toMatchObject({ memberId: 'd1', flagged: true, status: 'left', suggestion: null })
  })

  test('a rejoined person is not flagged and shows as rejoined', () => {
    const [r] = buildDepartedRows([doc('Gone.2', { episodes: [ep({ rejoinedAt: '2026-10-05T00:00:00.000Z' })] })], members, 'role1')
    expect(r).toMatchObject({ status: 'rejoined', flagged: false })
  })

  test('no member role configured → nothing flagged', () => {
    expect(buildDepartedRows([doc('Gone.2')], members, null)[0].flagged).toBe(false)
  })

  test('an unlinked doc gets a suggestion; a doc with no episodes is skipped', () => {
    const rows = buildDepartedRows([doc('Quit.7'), doc('Empty.1', { episodes: [] })], members, 'role1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ memberId: null, flagged: false, suggestion: { id: 'd2' } })
  })

  test('flagged rows sort first, then newest departure first', () => {
    const rows = buildDepartedRows(
      [
        doc('Old.1', { episodes: [ep({ at: '2025-01-01T00:00:00.000Z' })] }),
        doc('New.1', { episodes: [ep({ at: '2026-10-10T00:00:00.000Z' })] }),
        doc('Gone.2', { episodes: [ep({ at: '2024-01-01T00:00:00.000Z' })] })
      ],
      members,
      'role1'
    )
    expect(sortDepartedRows(rows).map((r) => r.doc.account)).toEqual(['Gone.2', 'New.1', 'Old.1'])
  })

  test('filters and counts', () => {
    const rows = buildDepartedRows(
      [
        doc('Gone.2'),
        doc('Kick.3', { note: 'griefing', episodes: [ep({ kind: 'kicked', actor: 'Boss.9', reason: 'afk' })] })
      ],
      members,
      'role1'
    )
    expect(filterDepartedRows(rows, 'kicked', '').map((r) => r.doc.account)).toEqual(['Kick.3'])
    expect(filterDepartedRows(rows, 'flagged', '').map((r) => r.doc.account)).toEqual(['Gone.2'])
    expect(filterDepartedRows(rows, 'all', 'boss').map((r) => r.doc.account)).toEqual(['Kick.3'])
    expect(filterDepartedRows(rows, 'all', 'GRIEF').map((r) => r.doc.account)).toEqual(['Kick.3'])
    expect(filterDepartedRows(rows, 'all', 'gone').map((r) => r.doc.account)).toEqual(['Gone.2'])
    expect(countDeparted(rows)).toEqual({ all: 2, flagged: 1, left: 1, kicked: 1, unknown: 0, rejoined: 0 })
  })
})

describe('doc edits', () => {
  test('replaceDoc swaps by key, or appends a new one', () => {
    const a = doc('A.1')
    const b = doc('B.2')
    expect(replaceDoc([a], { ...a, note: 'x' })[0].note).toBe('x')
    expect(replaceDoc([a], b)).toHaveLength(2)
  })
  test('link, dismiss, note and reason edits return new docs', () => {
    const d = doc('A.1')
    expect(linkDoc(d, 'd1').memberId).toBe('d1')
    expect(dismissSuggestion(dismissSuggestion(d, 'd1'), 'd1').dismissedSuggestions).toEqual(['d1'])
    expect(setDocNote(d, 'hi').note).toBe('hi')
    expect(setEpisodeReason(d, 0, 'afk').episodes[0].reason).toBe('afk')
    expect(d.note).toBe('')
  })
  test('a manual episode is inserted in date order', () => {
    const d = addManualEpisode(doc('A.1'), { kind: 'kicked', actor: 'Boss.9', at: '2026-10-11T00:00:00.000Z' })
    expect(d.episodes[0]).toMatchObject({ kind: 'kicked', actor: 'Boss.9', source: 'manual', auditUid: null })
    expect(d.episodes).toHaveLength(2)
  })
})

describe('previousKick', () => {
  const docs = [
    doc('Bad.1', { memberId: 'd5', episodes: [ep({ kind: 'kicked', actor: 'Boss.9', at: '2026-01-01T00:00:00.000Z', reason: 'toxic' })] }),
    doc('Quit.2')
  ]
  test('matches by account, case-insensitively', () => {
    expect(previousKick(docs, { accounts: ['bad.1'], memberId: null })?.account).toBe('Bad.1')
  })
  test('matches by Discord memberId', () => {
    expect(previousKick(docs, { accounts: [], memberId: 'd5' })?.episode.actor).toBe('Boss.9')
  })
  test('a leave is not a kick', () => {
    expect(previousKick(docs, { accounts: ['Quit.2'], memberId: null })).toBeNull()
  })
  test('the tooltip names the actor and the reason', () => {
    const t = kickTooltip(previousKick(docs, { accounts: ['Bad.1'], memberId: null })!)
    expect(t).toContain('Kicked by Boss.9')
    expect(t).toContain('toxic')
  })
})

describe('role removal', () => {
  test('roleActionBlocker explains why removal is disabled', () => {
    expect(roleActionBlocker({ canEdit: false, discordConfigured: true, memberRoleId: 'r' })).toMatch(/read-only/i)
    expect(roleActionBlocker({ canEdit: true, discordConfigured: false, memberRoleId: 'r' })).toMatch(/AxiTools/)
    expect(roleActionBlocker({ canEdit: true, discordConfigured: true, memberRoleId: null })).toMatch(/member role/i)
    expect(roleActionBlocker({ canEdit: true, discordConfigured: true, memberRoleId: 'r' })).toBeNull()
  })

  test('runs sequentially, continues past failures, reports progress', async () => {
    const order: string[] = []
    const act = vi.fn(async (id: string) => {
      order.push(id)
      return id === 'd2' ? { ok: false as const, error: 'Missing permission' } : { ok: true as const, data: null }
    })
    const progress = vi.fn()
    const res = await removeRoles(
      [{ key: 'k1', memberId: 'd1', label: 'A' }, { key: 'k2', memberId: 'd2', label: 'B' }, { key: 'k3', memberId: 'd3', label: 'C' }],
      act,
      progress
    )
    expect(order).toEqual(['d1', 'd2', 'd3'])
    expect(res).toEqual({ removed: ['k1', 'k3'], failed: [{ key: 'k2', label: 'B', error: 'Missing permission' }] })
    expect(progress).toHaveBeenLastCalledWith(3, 3)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/renderer/src/lib/departures.test.ts`
Expected: FAIL. It cannot resolve `./departures`.

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/departures.ts`:

```ts
// src/renderer/src/lib/departures.ts
//
// Pure view model for the Departed tab, the Roster banner and the "Previously
// kicked" badges. Departure docs (shared/departures) are joined with the live
// reconciled roster at read time, so Discord state is never stored stale.
import type { ReconciledMember } from '../../../preload/index.d'
import type { Tone } from './status'
import {
  departureKey,
  latestEpisode,
  sortEpisodes,
  type DepartureDoc,
  type DepartureEpisode,
  type DepartureKind
} from '../../../shared/departures'

export type DepartedFilter = 'all' | 'flagged' | 'left' | 'kicked' | 'unknown' | 'rejoined'
export type DepartedStatus = 'left' | 'kicked' | 'unknown' | 'rejoined'

export const DEPARTED_FILTERS: DepartedFilter[] = ['all', 'flagged', 'left', 'kicked', 'unknown', 'rejoined']

export const DEPARTED_META: Record<Exclude<DepartedFilter, 'all'>, { tone: Tone; label: string }> = {
  // Still holding the role is the thing to act on — a verdict, so danger.
  flagged: { tone: 'danger', label: 'Still has member role' },
  left: { tone: 'idle', label: 'Left' },
  kicked: { tone: 'danger', label: 'Kicked' },
  // Seen to vanish with no log entry: a fact about our records, so meta.
  unknown: { tone: 'meta', label: 'Unknown' },
  rejoined: { tone: 'ok', label: 'Rejoined' }
}

const lc = (s: string): string => s.trim().toLowerCase()

// ---- suggestions -------------------------------------------------------------

export interface RoleHolder {
  id: string
  name: string
  displayName: string
}

/** "Foo.1234" → "foo": the part of a GW2 account people reuse as a handle. */
export const handleOf = (account: string): string => lc(account).replace(/\.\d{4}$/, '')

export function roleHolders(members: ReconciledMember[]): RoleHolder[] {
  return members
    .filter((m) => m.memberId && m.hasMemberRole)
    .map((m) => ({ id: m.memberId as string, name: m.discordName ?? '', displayName: m.displayName ?? '' }))
}

/** Partial matches need at least this much handle, or "al" matches half the server. */
const MIN_PARTIAL = 3

export function suggestMatch(account: string, holders: RoleHolder[], dismissed: string[]): RoleHolder | null {
  const h = handleOf(account)
  if (!h) return null
  const pool = holders.filter((x) => !dismissed.includes(x.id))
  const names = (x: RoleHolder): string[] => [x.name, x.displayName].map(lc).filter(Boolean)
  const exact = pool.filter((x) => names(x).includes(h))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1 || h.length < MIN_PARTIAL) return null
  const partial = pool.filter((x) => names(x).some((n) => n.includes(h)))
  return partial.length === 1 ? partial[0] : null
}

// ---- rows --------------------------------------------------------------------

export interface DepartedRow {
  key: string
  doc: DepartureDoc
  latest: DepartureEpisode
  status: DepartedStatus
  /** Confirmed/linked Discord id: the doc's own, else an account link on the roster. */
  memberId: string | null
  member: ReconciledMember | null
  suggestion: RoleHolder | null
  flagged: boolean
}

export function buildDepartedRows(
  docs: DepartureDoc[],
  members: ReconciledMember[],
  memberRoleId: string | null
): DepartedRow[] {
  const holders = roleHolders(members)
  const out: DepartedRow[] = []
  for (const doc of docs) {
    const latest = latestEpisode(doc)
    if (!latest) continue
    const acct = lc(doc.account)
    const linkedBy = members.find((m) => m.memberId && m.accounts.some((a) => lc(a.account_name) === acct))
    const memberId = doc.memberId ?? linkedBy?.memberId ?? null
    const member = memberId ? (members.find((m) => m.memberId === memberId) ?? null) : null
    out.push({
      key: departureKey(doc.account),
      doc,
      latest,
      status: latest.rejoinedAt ? 'rejoined' : latest.kind,
      memberId,
      member,
      suggestion: memberId ? null : suggestMatch(doc.account, holders, doc.dismissedSuggestions),
      flagged: Boolean(memberRoleId) && Boolean(member?.hasMemberRole) && latest.rejoinedAt === null
    })
  }
  return out
}

export function sortDepartedRows(rows: DepartedRow[]): DepartedRow[] {
  return [...rows].sort(
    (a, b) => Number(b.flagged) - Number(a.flagged) || Date.parse(b.latest.at) - Date.parse(a.latest.at)
  )
}

export function filterDepartedRows(rows: DepartedRow[], filter: DepartedFilter, query: string): DepartedRow[] {
  const q = lc(query)
  return rows.filter((r) => {
    if (filter === 'flagged' && !r.flagged) return false
    if (filter !== 'all' && filter !== 'flagged' && r.status !== filter) return false
    if (!q) return true
    const hay = [
      r.doc.account,
      r.doc.note,
      r.member?.discordName,
      r.member?.displayName,
      r.member?.label,
      ...r.doc.episodes.flatMap((e) => [e.actor, e.reason])
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}

export function countDeparted(rows: DepartedRow[]): Record<DepartedFilter, number> {
  const c: Record<DepartedFilter, number> = { all: rows.length, flagged: 0, left: 0, kicked: 0, unknown: 0, rejoined: 0 }
  for (const r of rows) {
    c[r.status]++
    if (r.flagged) c.flagged++
  }
  return c
}

// ---- doc edits (officer fields; each returns a new doc) ----------------------

export function replaceDoc(docs: DepartureDoc[], doc: DepartureDoc): DepartureDoc[] {
  const k = departureKey(doc.account)
  const i = docs.findIndex((d) => departureKey(d.account) === k)
  return i >= 0 ? docs.map((d, j) => (j === i ? doc : d)) : [...docs, doc]
}

export const linkDoc = (doc: DepartureDoc, memberId: string | null): DepartureDoc => ({ ...doc, memberId })

export const dismissSuggestion = (doc: DepartureDoc, id: string): DepartureDoc =>
  doc.dismissedSuggestions.includes(id) ? doc : { ...doc, dismissedSuggestions: [...doc.dismissedSuggestions, id] }

export const setDocNote = (doc: DepartureDoc, note: string): DepartureDoc => ({ ...doc, note })

export const setEpisodeReason = (doc: DepartureDoc, index: number, reason: string): DepartureDoc => ({
  ...doc,
  episodes: doc.episodes.map((e, i) => (i === index ? { ...e, reason } : e))
})

export function addManualEpisode(
  doc: DepartureDoc,
  ep: { kind: DepartureKind; actor: string | null; at: string }
): DepartureDoc {
  return {
    ...doc,
    episodes: sortEpisodes([
      ...doc.episodes,
      {
        kind: ep.kind,
        actor: ep.kind === 'kicked' ? ep.actor?.trim() || null : null,
        at: ep.at,
        source: 'manual',
        auditUid: null,
        reason: '',
        rejoinedAt: null
      }
    ])
  }
}

// ---- "Previously kicked" -----------------------------------------------------

export interface PreviousKick {
  account: string
  episode: DepartureEpisode
}

/** The most recent `kicked` episode for anyone matching these accounts or Discord id. */
export function previousKick(
  docs: DepartureDoc[],
  who: { accounts: string[]; memberId: string | null }
): PreviousKick | null {
  const accts = new Set(who.accounts.filter(Boolean).map(lc))
  let best: PreviousKick | null = null
  for (const d of docs) {
    if (!accts.has(lc(d.account)) && !(who.memberId && d.memberId === who.memberId)) continue
    for (const e of d.episodes) {
      if (e.kind !== 'kicked') continue
      if (!best || Date.parse(e.at) > Date.parse(best.episode.at)) best = { account: d.account, episode: e }
    }
  }
  return best
}

export function kickTooltip(k: PreviousKick): string {
  const date = new Date(k.episode.at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  const by = k.episode.actor ?? 'an officer'
  return `Kicked by ${by} on ${date}${k.episode.reason ? `: ${k.episode.reason}` : ''} (${k.account})`
}

// ---- remove member role ------------------------------------------------------

export function roleActionBlocker(ctx: {
  canEdit: boolean
  discordConfigured: boolean
  memberRoleId: string | null
}): string | null {
  if (!ctx.canEdit) return 'Read-only access to this workspace'
  if (!ctx.discordConfigured) return 'Connect AxiTools and a Discord server in Settings'
  if (!ctx.memberRoleId) return 'Set a member role in guild Settings'
  return null
}

export interface RoleTarget {
  key: string
  memberId: string
  label: string
}

type ActResult = { ok: true; data: unknown } | { ok: false; error: string }

/** One at a time (Discord rate limits), never stopping at a failure. */
export async function removeRoles(
  targets: RoleTarget[],
  act: (memberId: string) => Promise<ActResult>,
  onProgress?: (done: number, total: number) => void
): Promise<{ removed: string[]; failed: { key: string; label: string; error: string }[] }> {
  const removed: string[] = []
  const failed: { key: string; label: string; error: string }[] = []
  let done = 0
  for (const t of targets) {
    try {
      const res = await act(t.memberId)
      if (res.ok) removed.push(t.key)
      else failed.push({ key: t.key, label: t.label, error: res.error })
    } catch (e) {
      failed.push({ key: t.key, label: t.label, error: (e as Error).message })
    }
    onProgress?.(++done, targets.length)
  }
  return { removed, failed }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/renderer/src/lib/departures.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/departures.ts src/renderer/src/lib/departures.test.ts
git commit -m "feat(departures): renderer view model (rows, suggestions, previousKick, role removal)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Departed tab (table, filters, linking and role removal)

**Files:**
- Create: `src/renderer/src/components/DepartedView.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes:
  - Task 7: `buildDepartedRows`, `sortDepartedRows`, `filterDepartedRows`, `countDeparted`, `replaceDoc`, `linkDoc`, `dismissSuggestion`, `removeRoles`, `roleActionBlocker`, `DEPARTED_FILTERS`, `DEPARTED_META`, `DepartedFilter`, `DepartedRow`.
  - Task 2: `parseDepartureDoc`, `serializeDepartureDoc`, `departureKey`, `DepartureDoc`.
  - Task 6: `client.departuresGet()`.
  - Existing: `client.upsertAnnotation` and `client.discordAction`.
- Produces:
  - `export default function DepartedView(props: { initialFilter?: DepartedFilter }): JSX.Element`.
  - App tab id `'departed'`. App state `departedFilter`, which Task 10's banner sets to `'flagged'`.
  - `DepartedView` renders `<DepartureDetail>`. Task 9 creates it with props `{ doc: DepartureDoc | null; canEdit: boolean; onSave: (doc: DepartureDoc) => Promise<void>; onClose: () => void }`, where `doc === null` means a new manual departure.

There is no unit test for this task: the vitest environment is node-only and tests `.ts`, not `.tsx`. All logic lives in the Task 7 helpers. Verification is `npm run typecheck`, `npm run build`, `npm run build:web`, plus the Task 11 smoke test.

- [ ] **Step 1: Create a `DepartureDetail` stub so this task compiles on its own**

Create `src/renderer/src/components/DepartureDetail.tsx` (Task 9 replaces it):

```tsx
import type { DepartureDoc } from '../../../shared/departures'

export interface DepartureDetailProps {
  doc: DepartureDoc | null
  canEdit: boolean
  onSave: (doc: DepartureDoc) => Promise<void>
  onClose: () => void
}

export default function DepartureDetail({ onClose }: DepartureDetailProps): JSX.Element {
  return (
    <div className="axi-scrim flex items-center justify-center p-6" onClick={onClose}>
      <div className="ar-modal__sheet max-w-xl" onClick={(e) => e.stopPropagation()} />
    </div>
  )
}
```

- [ ] **Step 2: Write `DepartedView`**

Create `src/renderer/src/components/DepartedView.tsx`:

```tsx
// src/renderer/src/components/DepartedView.tsx
//
// Departed members: the durable history of everyone who left or was kicked from
// the GW2 guild, joined at read time with live Discord state so people who still
// hold the member role are flagged for cleanup. Records live in reserved
// departure:* annotation rows (shared/departures.ts); detection runs on desktop
// after a live pull and on web in refresh-roster.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search, AlertTriangle, Check, Minus, ChevronRight, ChevronDown, UserMinus, Plus, X } from 'lucide-react'
import type { RosterPayload } from '../../../preload/index.d'
import { client } from '../lib/client'
import { toast } from '../lib/toast'
import { fmtRelative, toneVar } from '../lib/status'
import Tooltip from './Tooltip'
import Picker from './Picker'
import DepartureDetail from './DepartureDetail'
import { departureKey, parseDepartureDoc, serializeDepartureDoc, type DepartureDoc } from '../../../shared/departures'
import {
  buildDepartedRows, sortDepartedRows, filterDepartedRows, countDeparted, replaceDoc, linkDoc,
  dismissSuggestion, removeRoles, roleActionBlocker, DEPARTED_FILTERS, DEPARTED_META,
  type DepartedFilter, type DepartedRow
} from '../lib/departures'

const fmtExact = (iso: string): string => new Date(iso).toLocaleString()

export default function DepartedView({ initialFilter = 'all' }: { initialFilter?: DepartedFilter }): JSX.Element {
  const [payload, setPayload] = useState<RosterPayload | null>(null)
  const [docs, setDocs] = useState<DepartureDoc[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canEdit, setCanEdit] = useState(true)
  const [filter, setFilter] = useState<DepartedFilter>(initialFilter)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [linkingKey, setLinkingKey] = useState<string | null>(null)
  // undefined = closed; null = "add departure manually"; a key = that record.
  const [openKey, setOpenKey] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  useEffect(() => setFilter(initialFilter), [initialFilter])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    // Desktop detection runs inside buildRoster, so read departures after it.
    const [roster, auth] = await Promise.all([client.buildRoster(), client.authStatus()])
    const rows = await client.departuresGet()
    if (roster.ok) setPayload(roster.data)
    else setError(roster.error)
    setCanEdit(auth.role !== 'read')
    setDocs(rows.map((r) => parseDepartureDoc(r.key, r.notes)))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = client.onSyncChanged(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void load(), 200)
    })
    return () => {
      if (timer) clearTimeout(timer)
      off()
    }
  }, [load])

  const memberRoleId = payload?.memberRoleId ?? null
  const rows = useMemo(
    () => sortDepartedRows(buildDepartedRows(docs, payload?.members ?? [], memberRoleId)),
    [docs, payload, memberRoleId]
  )
  const shown = useMemo(() => filterDepartedRows(rows, filter, query), [rows, filter, query])
  const counts = useMemo(() => countDeparted(rows), [rows])
  const blocker = roleActionBlocker({
    canEdit,
    discordConfigured: Boolean(payload?.sources.discord.configured && payload?.discordGuildId),
    memberRoleId
  })
  const selectedRows = rows.filter((r) => selected.has(r.key) && r.flagged && r.memberId)

  const save = async (doc: DepartureDoc): Promise<void> => {
    setDocs((prev) => replaceDoc(prev, doc))
    await client.upsertAnnotation(departureKey(doc.account), { notes: serializeDepartureDoc(doc) })
  }

  const removeRole = async (targets: DepartedRow[]): Promise<void> => {
    const list = targets.filter((r) => r.flagged && r.memberId)
    const guildId = payload?.discordGuildId
    if (blocker || !guildId || !memberRoleId || list.length === 0) return
    const name = (r: DepartedRow): string => (r.member?.discordName ? `@${r.member.discordName}` : r.doc.account)
    const ask =
      list.length === 1
        ? `Remove ${name(list[0])}'s member role in Discord?`
        : `Remove the member role from ${list.length} people in Discord?`
    if (!confirm(ask)) return
    setBusy(list.length === 1 ? list[0].key : 'bulk')
    setProgress({ done: 0, total: list.length })
    const res = await removeRoles(
      list.map((r) => ({ key: r.key, memberId: r.memberId as string, label: name(r) })),
      (memberId) => client.discordAction(guildId, 'role_unassign', { member_id: memberId, role_id: memberRoleId }),
      (done, total) => setProgress({ done, total })
    )
    setBusy(null)
    setProgress(null)
    setRowErrors(Object.fromEntries(res.failed.map((f) => [f.key, f.error])))
    if (res.failed.length === 0) toast(`Removed the member role from ${res.removed.length}`)
    else toast(`Removed ${res.removed.length}; ${res.failed.length} failed: ${res.failed.map((f) => f.label).join(', ')}`, 'error')
    setSelected(new Set())
    // Refresh Discord state so the flags clear.
    await load()
  }

  const toggle = (set: Set<string>, key: string): Set<string> => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  const selectable = shown.filter((r) => r.flagged && r.memberId)
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.key))
  const someSelected = selectable.some((r) => selected.has(r.key))
  const openDoc = openKey ? (docs.find((d) => departureKey(d.account) === openKey) ?? null) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="ar-pane__head">
        <span className="ar-ink">Departed</span>
        <div className="ar-note--faint ml-auto shrink-0">{rows.length} recorded</div>
      </div>

      {error && (
        <div className="ar-banner ar-banner--danger">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      <div className="flex items-center gap-2 px-4 py-3">
        {!blocker && selectable.length > 0 && (
          <button
            onClick={() =>
              setSelected((prev) => {
                const next = new Set(prev)
                for (const r of selectable) (allSelected ? next.delete(r.key) : next.add(r.key))
                return next
              })
            }
            className="axi-btn ar-sm"
          >
            <span className={`ar-check${allSelected ? ' ar-check--on' : someSelected ? ' ar-check--some' : ''}`}>
              {allSelected ? <Check size={11} /> : someSelected ? <Minus size={11} /> : null}
            </span>
            Select flagged
          </button>
        )}
        <div className="axi-search ar-sm max-w-sm flex-1">
          <Search size={15} className="axi-search__icon" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search account, Discord, actor, reason, note…"
            className="axi-input ar-sm"
          />
        </div>
        {canEdit && (
          <button onClick={() => setOpenKey(null)} className="axi-btn ar-sm">
            <Plus size={13} /> Add departure
          </button>
        )}
        <Tooltip text="Refresh">
          <button onClick={() => void load()} className="ar-icon-btn">
            <RefreshCw size={15} className={loading ? 'ar-work' : ''} />
          </button>
        </Tooltip>
      </div>

      <div className="flex flex-wrap gap-2 px-4 pb-4">
        {DEPARTED_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className="axi-pill ar-sm"
            style={f === 'all' ? undefined : ({ '--axi-pill-fill': toneVar(DEPARTED_META[f].tone) } as React.CSSProperties)}
          >
            {f === 'all' ? 'All' : f === 'flagged' ? 'Flagged' : DEPARTED_META[f].label}
            <span className="ar-num">{counts[f]}</span>
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-6">
        {loading && rows.length === 0 ? (
          <div className="ar-note--faint flex flex-1 flex-col items-center justify-center gap-3 px-4 py-12">
            <RefreshCw size={18} className="ar-work" />
            Loading departures…
          </div>
        ) : shown.length === 0 ? (
          <div className="ar-note--faint flex flex-1 items-center justify-center px-4 py-12 text-center">
            {rows.length === 0
              ? 'No departures recorded yet. They appear after a roster refresh with the guild leader’s GW2 key.'
              : 'No departures match.'}
          </div>
        ) : (
          <div className="ar-list">
            <div className="ar-list__rows">
              <table className="axi-table axi-table--sticky">
                <colgroup>
                  <col style={{ width: 36 }} />
                  <col style={{ width: 26 }} />
                  <col style={{ width: '18%' }} />
                  <col />
                  <col style={{ width: 110 }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: 96 }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: 44 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th />
                    <th />
                    <th>Account</th>
                    <th>Discord</th>
                    <th>Status</th>
                    <th>By</th>
                    <th>When</th>
                    <th>Reason</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const meta = DEPARTED_META[r.status]
                    const isOpen = expanded.has(r.key)
                    const checked = selected.has(r.key)
                    return (
                      <Fragment key={r.key}>
                        <tr
                          role="button"
                          tabIndex={0}
                          onClick={() => setOpenKey(r.key)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setOpenKey(r.key)
                            }
                          }}
                          className={checked ? 'ar-row--on' : undefined}
                        >
                          <td>
                            {r.flagged && r.memberId && !blocker && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelected((prev) => toggle(prev, r.key))
                                }}
                                title="Select"
                                className={`ar-check${checked ? ' ar-check--on' : ''}`}
                              >
                                {checked && <Check size={11} />}
                              </button>
                            )}
                          </td>
                          <td>
                            {r.doc.episodes.length > 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setExpanded((prev) => toggle(prev, r.key))
                                }}
                                title={isOpen ? 'Hide history' : `Show ${r.doc.episodes.length} departures`}
                                className="ar-icon-btn"
                              >
                                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              </button>
                            )}
                          </td>
                          <td>
                            <div className="ar-row__name">{r.doc.account}</div>
                            {r.flagged && (
                              <span className="axi-chip axi-chip--danger ar-sm mt-1">Still has member role</span>
                            )}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <DiscordCell
                              row={r}
                              canEdit={canEdit}
                              linking={linkingKey === r.key}
                              candidates={payload?.discordCandidates ?? []}
                              onStartLink={() => setLinkingKey(r.key)}
                              onEndLink={() => setLinkingKey(null)}
                              onLink={(id) => void save(linkDoc(r.doc, id))}
                              onDismiss={(id) => void save(dismissSuggestion(r.doc, id))}
                            />
                          </td>
                          <td>
                            <span className={`axi-chip ar-sm${meta.tone === 'idle' ? '' : ` axi-chip--${meta.tone}`}`}>
                              {meta.label}
                            </span>
                          </td>
                          <td className="ar-row__sub">{r.latest.actor ?? '—'}</td>
                          <td>
                            <Tooltip text={fmtExact(r.latest.at)}>
                              <span className="ar-num">{fmtRelative(r.latest.at)}</span>
                            </Tooltip>
                          </td>
                          <td className="ar-row__sub truncate">
                            {r.latest.reason || '—'}
                            {rowErrors[r.key] && <div className="ar-ink-danger">{rowErrors[r.key]}</div>}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            {r.flagged && r.memberId && (
                              <Tooltip text={blocker ?? 'Remove member role'}>
                                <button
                                  onClick={() => void removeRole([r])}
                                  disabled={Boolean(blocker) || busy !== null}
                                  className="ar-icon-btn"
                                >
                                  <UserMinus size={14} className={busy === r.key ? 'ar-work' : ''} />
                                </button>
                              </Tooltip>
                            )}
                          </td>
                        </tr>
                        {isOpen &&
                          r.doc.episodes.slice(1).map((e) => {
                            const m = DEPARTED_META[e.rejoinedAt ? 'rejoined' : e.kind]
                            return (
                              <tr key={`${r.key}:${e.at}`}>
                                <td />
                                <td />
                                <td />
                                <td className="ar-note--faint">{e.source.replace('-', ' ')}</td>
                                <td>
                                  <span className={`axi-chip ar-sm${m.tone === 'idle' ? '' : ` axi-chip--${m.tone}`}`}>{m.label}</span>
                                </td>
                                <td className="ar-row__sub">{e.actor ?? '—'}</td>
                                <td>
                                  <Tooltip text={fmtExact(e.at)}>
                                    <span className="ar-num">{fmtRelative(e.at)}</span>
                                  </Tooltip>
                                </td>
                                <td className="ar-row__sub truncate">{e.reason || '—'}</td>
                                <td />
                              </tr>
                            )
                          })}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {selectedRows.length > 0 && !blocker && (
          <div className="ar-selection">
            <span>
              {progress ? `Removing ${progress.done}/${progress.total}…` : `${selectedRows.length} selected`}
            </span>
            <button onClick={() => void removeRole(selectedRows)} disabled={busy !== null} className="axi-btn ar-sm">
              <UserMinus size={13} /> Remove member role from {selectedRows.length}
            </button>
            <Tooltip text="Clear selection" className="ml-auto inline-flex">
              <button onClick={() => setSelected(new Set())} className="axi-btn ar-sm">
                <X size={13} /> Clear
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      {openKey !== undefined && (
        <DepartureDetail
          doc={openDoc}
          canEdit={canEdit}
          onSave={save}
          onClose={() => setOpenKey(undefined)}
        />
      )}
    </div>
  )
}

function DiscordCell({
  row,
  canEdit,
  linking,
  candidates,
  onStartLink,
  onEndLink,
  onLink,
  onDismiss
}: {
  row: DepartedRow
  canEdit: boolean
  linking: boolean
  candidates: { id: string; name: string; displayName: string }[]
  onStartLink: () => void
  onEndLink: () => void
  onLink: (memberId: string | null) => void
  onDismiss: (memberId: string) => void
}): JSX.Element {
  if (linking) {
    return (
      <Picker
        autoOpen
        sm
        value={row.doc.memberId ?? ''}
        className="w-full"
        onChange={(v) => onLink(v || null)}
        onDismiss={onEndLink}
        options={[
          { value: '', label: 'No Discord link' },
          ...candidates.map((c) => ({ value: c.id, label: c.displayName === c.name ? c.name : `${c.displayName} (@${c.name})` }))
        ]}
      />
    )
  }
  const linkBtn = canEdit && (
    <button onClick={onStartLink} className="axi-btn ar-sm">
      Link…
    </button>
  )
  if (row.memberId) {
    const who = row.member?.discordName ? `@${row.member.discordName}` : row.memberId
    return (
      <div className="flex items-center gap-2">
        <span className="truncate ar-ink">{row.member?.displayName ?? who}</span>
        <span className="ar-row__sub truncate">{row.member ? who : 'left Discord'}</span>
        {linkBtn}
      </div>
    )
  }
  if (row.suggestion) {
    const s = row.suggestion
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="ar-note">Likely: @{s.name || s.displayName}</span>
        {canEdit && (
          <>
            <button onClick={() => onLink(s.id)} className="axi-btn ar-sm">Confirm</button>
            <button onClick={() => onDismiss(s.id)} className="axi-btn ar-sm">Not them</button>
          </>
        )}
        {linkBtn}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <span className="ar-note--faint">No Discord match</span>
      {linkBtn}
    </div>
  )
}
```

- [ ] **Step 3: Add the tab to `App.tsx`**

In `src/renderer/src/App.tsx`:
1. Update the imports:
   - Add `UserX` to the lucide import.
   - Add `import DepartedView from './components/DepartedView'`.
   - Add `import type { DepartedFilter } from './lib/departures'`.
2. Widen the type: `type Tab = 'roster' | 'log' | 'departed' | 'sharing' | 'settings' | 'retention' | 'recruitment'`.
3. In `TABS`, after the `log` entry, add `{ id: 'departed', label: 'Departed', icon: <UserX size={15} /> },`.
4. Add the state: `const [departedFilter, setDepartedFilter] = useState<DepartedFilter>('all')`.
5. In the sub-tab `onClick`, after `setTab(t.id)`, add `if (t.id === 'departed') setDepartedFilter('all')`.
6. In the view switch, after the `tab === 'log'` branch, add:

   ```tsx
             ) : tab === 'departed' ? (
               <DepartedView initialFilter={departedFilter} />
   ```

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build && npm run build:web`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/DepartedView.tsx src/renderer/src/components/DepartureDetail.tsx src/renderer/src/App.tsx
git commit -m "feat(departures): Departed tab with linking and member-role removal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Departure detail modal (note, reasons, manual episode)

**Files:**
- Modify (replace the stub): `src/renderer/src/components/DepartureDetail.tsx`

**Interfaces:**
- Consumes:
  - Task 7: `setDocNote`, `setEpisodeReason`, `addManualEpisode`, `DEPARTED_META`.
  - Task 2: `emptyDepartureDoc`, `DepartureDoc`, `DepartureKind`.
  - Existing: `useMountTransition` and `Picker`.
- Produces: the same props as the Task 8 stub, `DepartureDetailProps { doc: DepartureDoc | null; canEdit: boolean; onSave(doc): Promise<void>; onClose(): void }`.

There is no unit test, for the same reason as Task 8. Every edit goes through the Task 7 pure helpers, which are tested.

- [ ] **Step 1: Write the component**

Replace `src/renderer/src/components/DepartureDetail.tsx` with:

```tsx
// src/renderer/src/components/DepartureDetail.tsx
//
// One departure record: the officer's note about the person, a reason per
// departure episode, and "Add departure manually". doc === null opens it as a
// brand-new record for an account typed in here. Only officer fields are
// edited — detection owns kind/actor/time for log and diff episodes.
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import Picker from './Picker'
import { useMountTransition } from '../lib/useMountTransition'
import { fmtRelative } from '../lib/status'
import { emptyDepartureDoc, type DepartureDoc, type DepartureKind } from '../../../shared/departures'
import { addManualEpisode, setDocNote, setEpisodeReason, DEPARTED_META } from '../lib/departures'

export interface DepartureDetailProps {
  doc: DepartureDoc | null
  canEdit: boolean
  onSave: (doc: DepartureDoc) => Promise<void>
  onClose: () => void
}

const today = (): string => new Date().toISOString().slice(0, 10)
const ACCOUNT_RE = /^.+\.\d{4}$/

export default function DepartureDetail({ doc, canEdit, onSave, onClose }: DepartureDetailProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const closing = useRef(false)
  const t = useMountTransition(open)
  useEffect(() => setOpen(true), [])
  useEffect(() => {
    if (closing.current && !t.mounted) onClose()
  }, [t.mounted, onClose])
  const close = (): void => {
    closing.current = true
    setOpen(false)
  }

  const [current, setCurrent] = useState<DepartureDoc | null>(doc)
  useEffect(() => setCurrent(doc), [doc])
  const [note, setNote] = useState(doc?.note ?? '')
  const [account, setAccount] = useState('')
  const [kind, setKind] = useState<DepartureKind>('left')
  const [actor, setActor] = useState('')
  const [date, setDate] = useState(today())
  const [formError, setFormError] = useState<string | null>(null)

  const persist = async (next: DepartureDoc): Promise<void> => {
    setCurrent(next)
    await onSave(next)
  }

  const addEpisode = async (): Promise<void> => {
    const base = current ?? (ACCOUNT_RE.test(account.trim()) ? emptyDepartureDoc(account) : null)
    if (!base) return setFormError('Enter a GW2 account name like Name.1234')
    if (Number.isNaN(Date.parse(date))) return setFormError('Pick a date')
    setFormError(null)
    await persist(addManualEpisode(base, { kind, actor: actor || null, at: `${date}T12:00:00.000Z` }))
    setActor('')
  }

  return (
    <div
      className={`axi-scrim flex items-center justify-center p-6 transition-opacity duration-150 ease-out ${
        t.shown ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={close}
    >
      <div
        className={`ar-modal__sheet max-w-2xl transition duration-150 ease-out ${
          t.shown ? 'scale-100 opacity-100' : 'scale-[.98] opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ar-modal__head items-start">
          <div className="min-w-0 flex-1">
            <div className="ar-title truncate">{current?.account ?? 'Add a departure'}</div>
            <div className="ar-row__sub">
              {current ? `${current.episodes.length} departure${current.episodes.length === 1 ? '' : 's'} recorded` : 'Record someone the log missed'}
            </div>
          </div>
          <button onClick={close} className="ar-icon-btn"><X size={15} /></button>
        </div>

        <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto p-4">
          {current && (
            <div className="ar-field">
              <div className="axi-eyebrow">Note about this person</div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={() => current && note !== current.note && void persist(setDocNote(current, note))}
                disabled={!canEdit}
                rows={3}
                placeholder="Anything officers should know if they come back"
                className="axi-input"
              />
            </div>
          )}

          {current && current.episodes.length > 0 && (
            <div className="ar-field">
              <div className="axi-eyebrow">History</div>
              <div className="flex flex-col gap-3">
                {current.episodes.map((e, i) => {
                  const m = DEPARTED_META[e.rejoinedAt ? 'rejoined' : e.kind]
                  return (
                    <div key={`${e.at}:${i}`} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`axi-chip ar-sm${m.tone === 'idle' ? '' : ` axi-chip--${m.tone}`}`}>{m.label}</span>
                        <span className="ar-num" title={new Date(e.at).toLocaleString()}>{fmtRelative(e.at)}</span>
                        {e.actor && <span className="ar-row__sub">by {e.actor}</span>}
                        <span className="ar-note--faint">{e.source.replace('-', ' ')}</span>
                        {e.rejoinedAt && <span className="ar-note--faint">· back {fmtRelative(e.rejoinedAt)}</span>}
                      </div>
                      <ReasonInput
                        value={e.reason}
                        disabled={!canEdit}
                        onCommit={(reason) => current && void persist(setEpisodeReason(current, i, reason))}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {canEdit && (
            <div className="ar-field">
              <div className="axi-eyebrow">Add departure manually</div>
              <div className="flex flex-wrap items-center gap-2">
                {!current && (
                  <input
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    placeholder="Account.1234"
                    className="axi-input ar-sm"
                  />
                )}
                <Picker
                  sm
                  value={kind}
                  onChange={(v) => setKind(v as DepartureKind)}
                  options={[
                    { value: 'left', label: 'Left' },
                    { value: 'kicked', label: 'Kicked' },
                    { value: 'unknown', label: 'Unknown' }
                  ]}
                />
                {kind === 'kicked' && (
                  <input
                    value={actor}
                    onChange={(e) => setActor(e.target.value)}
                    placeholder="Kicked by (Account.1234)"
                    className="axi-input ar-sm"
                  />
                )}
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="axi-input ar-sm" />
                <button onClick={() => void addEpisode()} className="axi-btn ar-sm">Add</button>
              </div>
              {formError && <div className="ar-ink-danger mt-1">{formError}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ReasonInput({
  value,
  disabled,
  onCommit
}: {
  value: string
  disabled: boolean
  onCommit: (v: string) => void
}): JSX.Element {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      disabled={disabled}
      placeholder="Reason"
      className="axi-input ar-sm"
    />
  )
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build && npm run build:web`
Expected: all succeed.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/DepartureDetail.tsx
git commit -m "feat(departures): detail modal for notes, reasons and manual departures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Roster banner and "Previously kicked" badges

**Files:**
- Modify: `src/renderer/src/components/RosterView.tsx`
- Modify: `src/renderer/src/components/MemberDetail.tsx`
- Modify: `src/renderer/src/components/RecruitmentView.tsx`
- Modify: `src/renderer/src/components/RecruitCardModal.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes:
  - Task 7: `buildDepartedRows`, `previousKick`, `kickTooltip`, `PreviousKick`.
  - Task 2: `parseDepartureDoc`, `DepartureDoc`.
  - Task 6: `client.departuresGet()`.
  - Task 8: App's `departedFilter`.
- Produces:
  - **New props:**
    - `RosterView({ resetToken?, onOpenDeparted?: () => void })`
    - `MemberDetail({ …, previousKick?: PreviousKick | null })`
    - `RecruitCardModal({ …, previousKick?: PreviousKick | null })`
  - **Shared badge:** `KickBadge({ kick }: { kick: PreviousKick })`, exported from `src/renderer/src/components/KickBadge.tsx`.

There is no unit test: all matching logic is `previousKick` and the flag computation in Task 7, which are tested.

- [ ] **Step 1: Create the shared badge**

Create `src/renderer/src/components/KickBadge.tsx`:

```tsx
// A previously kicked person is back (roster or recruitment): a danger chip,
// with who/when/why in the portaled tooltip.
import Tooltip from './Tooltip'
import { kickTooltip, type PreviousKick } from '../lib/departures'

export default function KickBadge({ kick }: { kick: PreviousKick }): JSX.Element {
  return (
    <Tooltip text={kickTooltip(kick)}>
      <span className="axi-chip axi-chip--danger ar-sm shrink-0">Previously kicked</span>
    </Tooltip>
  )
}
```

- [ ] **Step 2: Add the banner and badges to the roster**

In `src/renderer/src/components/RosterView.tsx`:
1. Update the imports:
   - Add `UserMinus` to the lucide import.
   - Add `import KickBadge from './KickBadge'`.
   - Add `import { buildDepartedRows, previousKick, type PreviousKick } from '../lib/departures'`.
   - Add `import { parseDepartureDoc, type DepartureDoc } from '../../../shared/departures'`.
2. Change the signature to:

   ```tsx
   export default function RosterView({
     resetToken,
     onOpenDeparted
   }: {
     resetToken?: number
     onOpenDeparted?: () => void
   }): JSX.Element {
   ```

3. Add `const [departures, setDepartures] = useState<DepartureDoc[]>([])`, and extend `load` so departures are read after the build, because detection runs inside it:

   ```tsx
     const load = useCallback(async () => {
       setLoading(true)
       setError(null)
       const res = await client.buildRoster()
       if (res.ok) setPayload(res.data)
       else setError(res.error)
       const rows = await client.departuresGet().catch(() => [])
       setDepartures(rows.map((r) => parseDepartureDoc(r.key, r.notes)))
       setLoading(false)
     }, [])
   ```

4. After `const selected = …`, add:

   ```tsx
     const flaggedCount = useMemo(
       () => buildDepartedRows(departures, members, payload?.memberRoleId ?? null).filter((r) => r.flagged).length,
       [departures, members, payload]
     )
     const kicks = useMemo(() => {
       const map = new Map<string, PreviousKick>()
       for (const m of members) {
         const k = previousKick(departures, { accounts: m.accounts.map((a) => a.account_name), memberId: m.memberId })
         if (k) map.set(m.annotationKey, k)
       }
       return map
     }, [departures, members])
   ```

5. Directly after the `payload?.warnings.map(...)` banners, add:

   ```tsx
             {flaggedCount > 0 && onOpenDeparted && (
               <div className="ar-banner ar-banner--warn">
                 <UserMinus size={13} />
                 {flaggedCount} departed member{flaggedCount === 1 ? '' : 's'} still{' '}
                 {flaggedCount === 1 ? 'has' : 'have'} the member role in Discord
                 <button onClick={onOpenDeparted} className="axi-btn ar-sm ml-auto">
                   Review
                 </button>
               </div>
             )}
   ```

6. Pass `previousKick={kicks.get(selected.annotationKey) ?? null}` to `<MemberDetail …>`. Pass `kicks={kicks}` to both `<MemberTable …>` and `<MemberCards …>`.
7. In `MemberTable` and `MemberCards`, add `kicks: Map<string, PreviousKick>` to the props.
   - In the table name cell, replace `<div className="ar-row__name">{m.label}</div>` with:

     ```tsx
                       <div className="flex min-w-0 items-center gap-2">
                         <span className="ar-row__name truncate">{m.label}</span>
                         {kicks.get(m.annotationKey) && <KickBadge kick={kicks.get(m.annotationKey) as PreviousKick} />}
                       </div>
     ```

   - In the card head, after `<span className="axi-card__name">{m.label}</span>`, add the same `{kicks.get(…) && <KickBadge … />}`.

- [ ] **Step 3: Add the badge to `MemberDetail`**

In `src/renderer/src/components/MemberDetail.tsx`:
1. Add the imports: `import KickBadge from './KickBadge'` and `import type { PreviousKick } from '../lib/departures'`.
2. Add `previousKick = null` to the destructured props, and `previousKick?: PreviousKick | null` to the props type.
3. In the header row, after the `linkSource` chip (about line 190), add:

   ```tsx
               {previousKick && <KickBadge kick={previousKick} />}
   ```

- [ ] **Step 4: Add the badge to the recruitment cards**

In `src/renderer/src/components/RecruitmentView.tsx`:
1. Add the imports:
   - `import KickBadge from './KickBadge'`
   - `import { previousKick, type PreviousKick } from '../lib/departures'`
   - `import { parseDepartureDoc, type DepartureDoc } from '../../../shared/departures'`
2. Add `const [departures, setDepartures] = useState<DepartureDoc[]>([])`. At the end of `load`, before `setLoading(false)`:

   ```tsx
       const deps = await client.departuresGet().catch(() => [])
       setDepartures(deps.map((r) => parseDepartureDoc(r.key, r.notes)))
   ```

3. After `subjects`, add:

   ```tsx
     // A prospect matches on its account + aliases; a member on every account it
     // owns plus its Discord id (its annotation key, unless it is an acct: anchor).
     const kicks = useMemo(() => {
       const map = new Map<string, PreviousKick>()
       for (const s of subjects) {
         const m = s.isProspect ? null : members.find((x) => x.annotationKey === s.key)
         const k = previousKick(departures, {
           accounts: m ? m.accounts.map((a) => a.account_name) : [s.accountName ?? '', ...s.aliases],
           memberId: m?.memberId ?? null
         })
         if (k) map.set(s.key, k)
       }
       return map
     }, [subjects, members, departures])
   ```

4. In the card, after the `prospect` chip, add `{kicks.get(subj.key) && <KickBadge kick={kicks.get(subj.key) as PreviousKick} />}`.
5. Pass `previousKick={kicks.get(subj.key) ?? null}` to `<RecruitCardModal …>`.

In `src/renderer/src/components/RecruitCardModal.tsx`:
1. Add the imports: `import KickBadge from './KickBadge'` and `import type { PreviousKick } from '../lib/departures'`.
2. Add `previousKick?: PreviousKick | null` to `RecruitCardModalProps`.
3. In the header, change the title line to:

   ```tsx
               <div className="flex min-w-0 items-center gap-2">
                 <div className="ar-title truncate">{subject.name}</div>
                 {props.previousKick && <KickBadge kick={props.previousKick} />}
               </div>
   ```

- [ ] **Step 5: Wire the banner to the tab in `App.tsx`**

In `src/renderer/src/App.tsx`, add one handler and pass it to all three `<RosterView …>` instances:

```tsx
  const openDeparted = (): void => {
    setDepartedFilter('flagged')
    setTab('departed')
  }
```

```tsx
<RosterView resetToken={rosterReset} onOpenDeparted={openDeparted} />
```

- [ ] **Step 6: Typecheck, build and test**

Run: `npm run typecheck && npm run build && npm run build:web`
Expected: all succeed.

Run: `npm test`
Expected: the full suite passes.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/KickBadge.tsx src/renderer/src/components/RosterView.tsx src/renderer/src/components/MemberDetail.tsx src/renderer/src/components/RecruitmentView.tsx src/renderer/src/components/RecruitCardModal.tsx src/renderer/src/App.tsx
git commit -m "feat(departures): roster banner and Previously kicked badges

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Full verification and smoke test

**Files:** none, unless a fix is needed.

- [ ] **Step 1: Full suite and builds**

Run: `npm test && npm run typecheck && npm run build && npm run build:web`
Expected: all pass. If anything fails, fix it in the task that owns the code and re-run.

- [ ] **Step 2: Manual smoke test in the desktop app** (`npm run dev`)

Use a guild that has the leader's GW2 key, AxiTools, and a member role configured.

1. **History and backfill.** Open the **Departed** tab.
   - Historical leaves and kicks from the stored guild log appear.
   - Kicked rows show the actor. A row with more than one episode expands to show its history.
2. **Diff detection.**
   - In `userData/departureSnapshots/<guildId>.json`, add one fake account name to `accounts`. Refresh the roster.
   - That account appears as **Unknown** with source "roster diff".
3. **Flagging.** A departed person who still has the member role sorts first and shows **Still has member role**.
   - The Roster tab shows the warn banner. **Review** opens Departed with **Flagged** pressed.
4. **Linking.**
   - **Confirm** on a suggestion sets the Discord link.
   - **Not them** hides that suggestion.
   - **Link…** opens the picker; choosing **No Discord link** clears it.
5. **Role removal** (only on a test person):
   - Single removal asks for confirmation, removes the role, and the flag clears after reload.
   - Bulk removal shows progress and a summary toast.
   - Check that the Log tab picks up the Discord audit event.
   - With a read-only account, the buttons are disabled and the tooltip explains why.
6. **Detail modal.**
   - Edit the note and an episode reason, then reopen: both are kept.
   - **Add departure** with a new account creates a manual episode.
   - An invalid account (`foo`) shows the inline error.
7. **Previously kicked.** For a kicked account still listed on the roster or the pipeline, the danger chip appears on:
   - the roster row and card
   - `MemberDetail`
   - the pipeline card and `RecruitCardModal`
   The tooltip shows who, when and why.
8. **Web** (`npm run dev:web`, signed in to a claimed guild):
   - **Sharing → Refresh roster** succeeds, and departed accounts no longer show as in guild.
   - The Departed tab shows the same records as desktop.

- [ ] **Step 3: Report**

Tell the user:
- the test and build results
- which smoke steps passed, and anything skipped
- that the web build and the `refresh-roster` function still need a manual deploy (`npm run deploy:functions` for `refresh-roster`, then `npm run deploy:web`) when they are ready.
