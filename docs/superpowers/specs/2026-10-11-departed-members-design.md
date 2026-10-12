# Departed Members — Design

Date: 2026-10-11
Status: Approved in conversation, pending written-spec review

## Goal

Officers need to know who has left the GW2 guild, and to keep that knowledge.
This feature has three outcomes:

1. **History (primary).** A durable record of everyone who has left the guild or
   been kicked: who, when, left vs kicked, by whom, and why.
2. **Cleanup.** Departed people who still hold the guild's Discord member role
   are highlighted, and officers can remove the role in one click (or in bulk).
3. **Rejoin awareness.** When someone who was kicked comes back, as a roster
   member or as a recruitment prospect, a "Previously kicked" warning is shown.

### Why the current state falls short

- The `left-guild` status (`src/shared/rosterReconcile.ts`) only covers Discord
  members with a linked GW2 account.
- That status disappears as soon as the member role is removed, because the row
  is dropped at `rosterReconcile.ts:212`.
- Nothing is kept historically.
- Kicks are visible only as raw audit events.
- Accounts that were never linked to Discord are not covered at all.
- Web: `refresh-roster` only upserts `roster_members` and never deletes, so
  departed accounts stay "in guild" on the web build indefinitely.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Record sources | GW2 guild-log `kick` events (leave when actor = target) **plus** a roster diff as a safety net, **plus** manual entry and notes. Backfill from stored audit events. |
| Unlinked departures | Suggest a Discord match by name, which an officer confirms or dismisses. A manual "Link…" picker is the fallback. |
| "Guild roles" | Only the configured per-guild member role (`memberRoleId`). No new setting. |
| UI | A new top-level **Departed** view, plus a warning banner on Roster. |
| Actions | One-click and bulk **Remove member role** through AxiTools, with confirmation. No Discord kick action. |
| Rejoins | Keep the record and mark it Rejoined. Show "Previously kicked" on roster and pipeline cards. |
| Storage | Reserved annotation rows (`departure:` prefix). No new table or migration. |

Approaches that were rejected:
- A dedicated `departures` table needed roughly twice the plumbing (migration,
  RLS, a local store, a new sync path) for little gain.
- Deriving departures at read time from the audit log can't record departures
  the log missed, and has nowhere to keep notes or links.

## 1. Data model and storage

Each GW2 account gets one reserved annotation row, keyed by
`departure:<account name, trimmed + lowercased>`. The row's `notes` column holds
a JSON `DepartureDoc`. The other annotation columns are left empty.

```ts
interface DepartureDoc {
  account: string                // display casing, e.g. "Foo.1234"
  memberId: string | null        // Discord link: auto, confirmed suggestion, or manual pick
  dismissedSuggestions: string[] // Discord ids an officer marked "not them"
  note: string                   // officer note about the person
  episodes: DepartureEpisode[]   // newest first
}

interface DepartureEpisode {
  kind: 'left' | 'kicked' | 'unknown' // unknown = roster diff with no matching log event
  actor: string | null                // GW2 account that kicked (kicked only)
  at: string                          // ISO; log time, or detection time for a diff
  source: 'gw2-log' | 'roster-diff' | 'manual'
  auditUid: string | null             // audit event uid when source = gw2-log
  reason: string                      // officer-entered, per episode
  rejoinedAt: string | null
}
```

- `isReservedAnnotationKey` gains `key.startsWith('departure:')`, so these rows
  never surface as members. The reserved bucketing in `rosterStore.ts` and the
  filtering in `supabaseSync.ts` and `webClient/roster.ts` already go through
  this predicate.
- Sync is unchanged: rows travel through the existing annotation sync between
  desktop and Supabase.
- RLS is unchanged: members can read, and write+ roles can modify.

### Merge rules (one pure function, used by desktop and web)

- **Upgrade.** A `gw2-log` episode for the account replaces an `unknown`
  `roster-diff` episode whose `at` is within ±7 days. Kind, actor, `at`,
  `source` and `auditUid` are taken from the log; `reason` and `rejoinedAt` are
  kept.
- **Dedupe.** If an episode with the same `auditUid` already exists, the new one
  is a no-op. A `roster-diff` episode is also a no-op if the latest episode is
  still open (`rejoinedAt === null`).
- **Officer fields.** Automatic detection never overwrites officer-entered
  fields: `note`, `reason`, `memberId` (once set), and `dismissedSuggestions`.
- **Auto link.** Detection may set `memberId` only while it is `null`, from
  AxiTools auto-links or a manual link.
- **Ordering.** Episodes stay sorted newest-first by `at`.

## 2. Detection and data flow

A new pure module, `departures.ts` (home described under "Where it runs"), has no IO:

```ts
detectDepartures(input: {
  previous: string[] | null    // account names seen last time; null = no snapshot
  current: InGameMemberRaw[]   // fresh in-game roster; [] or failed pull → no diff
  auditEvents: AuditEvent[]    // gw2 kick/joined events, any age
  existing: Map<string, DepartureDoc>
  links: { accountName: string; memberId: string }[]
  now: string
}): DepartureDoc[]             // only docs that changed
```

It merges three kinds of evidence:

1. **Audit fold.** Each GW2 `kick` event becomes an episode: `left` when
   actor = target, otherwise `kicked` with `actor`. Kick normalization is in
   `src/main/auditNormalize.ts`, and a leave is where `user === kicked_by`.
   - The first run folds every stored event, and that *is* the backfill.
   - Later runs are idempotent through `auditUid` dedupe.
   - A GW2 `joined` event after an open episode sets `rejoinedAt`.
2. **Roster diff.** An account in `previous` but not in `current` gets an
   `unknown` / `roster-diff` episode at `now`, unless the merge rules absorb it.
3. **Rejoin.** An account in `current` whose latest episode is open gets
   `rejoinedAt` set to its roster `joined` date, or `now` if that is missing.

### Safety guards

The roster diff is skipped and only the audit fold runs when any of these hold:

- `previous === null` (first run, no snapshot).
- `current` is empty, or the pull failed.
- More than 25% of `previous` **and** more than 5 accounts would vanish in one
  run. A warning is logged.

### Where it runs

- **Desktop.** Detection runs after each successful live GW2 roster pull in the
  main process.
  - `previous` comes from a new per-guild snapshot file of account names, kept
    under userData next to the existing stores.
  - Audit events come from `LocalAuditStore` for that guild.
  - Changed docs are written as reserved annotation rows, which then sync.
  - The snapshot is rewritten after every successful pull.
- **Web.** Detection runs in the `refresh-roster` edge function
  (`handler.ts`), after the member upsert.
  - `previous` is the account names in the existing `roster_members` rows, read
    *before* the upsert.
  - Audit events are the workspace's GW2 kick and joined rows from
    `audit_events`.
  - Existing departures are the `departure:` rows from `roster_annotations`.
  - All reads and writes use the service role.
  - The function upserts the changed departure rows, then **deletes the
    `roster_members` rows** for accounts that are no longer in the roster. This
    fixes the stale-member bug, and the deletes go through the existing
    realtime channel.
  - **Module home.** Edge functions don't import from `src/` today, so the
    canonical module lives at `supabase/functions/_shared/departures.ts`.
    - It is dependency-free: no imports, and its own structural types for
      roster members and audit events. That lets it run under both Deno and
      Node.
    - `src/shared/departures.ts` re-exports it for the desktop and web app.
    - Its tests run under the existing vitest include
      (`supabase/functions/**/*.test.ts`).
- **Two writers.** If a desktop and the web both detect the same departure, the
  merge rules make the second write a no-op.

### Discord matching (read time)

Departure rows are joined with current Discord state when they are displayed,
so they never go stale:

- If `memberId` is set, the row shows that member's current roles,
  `hasMemberRole`, name and avatar.
- If `memberId` is null, the row shows a suggestion:
  - Take the account's handle, `Foo.1234` → `foo`.
  - Compare it case-insensitively against the `name` and `display_name` of
    Discord members who hold the member role, excluding `dismissedSuggestions`.
  - An exact match is suggested. A match that is the only one where the handle
    is a prefix or substring is also suggested.
  - If there are several candidates, there is no suggestion and the "Link…"
    picker is used.
- **Flagged** means `hasMemberRole === true`, the latest episode is open (no
  rejoin), and a member role is configured.

## 3. UI and actions

### Departed view

A new top-level tab next to Roster, Pipeline and Audit, on desktop and web. It
is always on, with no feature flag.

- **Table.** Each row is one account, showing its latest episode.
  - Columns: account, Discord (`IdentityChip` or suggestion), kind pill, actor,
    date (`fmtRelative`, exact time in a tooltip), reason.
  - Kind pills: Left = `idle`, Kicked = `danger`, Unknown = `meta`,
    Rejoined = `ok`.
  - Rows with more than one episode expand to show the full history.
- **Flag.** A red "Still has member role" marker. Flagged rows sort first; the
  rest sort by latest `at`, newest first.
- **Filters.** A search box over account, Discord name, actor, reason and note.
  Pills: All / Left / Kicked / Unknown / Rejoined / Flagged, following the
  `RosterView` filter-pill pattern.
- **Suggestion cell.** "Likely: @foo" with **Confirm** (sets `memberId`) and
  **Not them** (appends to `dismissedSuggestions`). There is always a
  **Link…** button that opens the existing `Picker` over Discord members.
- **Detail panel.** Opened by clicking a row. It has the person note editor, a
  per-episode reason editor, and **Add departure manually**, which creates a
  `manual` episode. Officers choose the kind (left, kicked or unknown), the
  actor if kicked, and the date.
- **Styling.** axi-design conventions: `ar-` prefix, `.ar-ink-*` inks, tones
  from `lib/status.ts`, and the portaled `Tooltip`.

### Remove member role

- **Single.** A button on each flagged row opens a confirm dialog ("Remove
  @foo's member role in Discord?"), then calls the existing AxiTools
  `discordAction` role-unassign with the guild's `memberRoleId`.
- **Bulk.** Row checkboxes plus the existing `SelectionBar` give "Remove member
  role from N". It runs sequentially with progress, continues past failures,
  and ends with a summary.
- **Disabled** with an explanatory tooltip when the user is read-only, AxiTools
  is not configured, or no member role is configured.
- **Desktop and web.** Desktop goes through `axitoolsClient`; web goes through
  the existing `axitools` edge function.
- **Audit.** The action reaches the Audit view through the normal Discord audit
  sync. No extra writes are needed.
- **Refresh.** After success, Discord members are refreshed so the flag clears.

### Roster banner

When any flagged departures exist, an `ar-banner--warn` banner appears at the
top of Roster: "*N* departed members still have the member role in Discord —
**Review**". **Review** opens Departed with the Flagged filter active.

### "Previously kicked" warning

A `danger` badge, with a tooltip of "Kicked by X on <date>: <reason>". It appears
where any episode is `kicked` and matches by any of these:

- **Roster rows and `MemberDetail`:** any of the member's accounts, or their
  Discord `memberId`.
- **Pipeline prospect cards and `RecruitCardModal`:** the prospect's account
  name, aliases, or linked Discord id.

A shared pure helper, `previousKick(departures, { accounts, memberId })`,
returns the most recent kicked episode or null.

## 4. Error handling

- **Parsing.** `parseDepartureDoc(key, notes)` never throws. Corrupt or empty
  JSON yields an empty doc whose `account` is derived from the key.
  Unrecognised enum values become `unknown` / `manual`.
- **Desktop detection.** Each failing source (audit store, snapshot) is logged
  and skipped. Detection never blocks loading the roster.
- **Edge function.** Departure writes and the stale-row deletes run after the
  member upsert, inside their own try/catch.
  - A failure is reported as `departuresError` in the body.
  - The response stays 200, with `count` as today.
- **Role removal.**
  - A per-row inline error shows the AxiTools message, e.g. "Missing
    permission" or "Member not found".
  - A member who already lacks the role counts as success.
  - Bulk failures are collected into the end summary.
- **Concurrent officer edits.** Last write wins, as with all annotations today.
  Detection only touches automatic fields.

## 5. Testing

Run vitest with `--maxWorkers=2`.

- **`supabase/functions/_shared/departures.test.ts`:**
  - Kick vs leave classification.
  - Log upgrades a diff episode inside the ±7d window, and does not outside it.
  - Re-runs are idempotent; two writers converge.
  - Rejoin, then leave again, produces a second episode.
  - Guards: no snapshot, empty pull, mass drop.
  - Backfill over many events.
  - Officer fields are preserved.
  - Auto-link fills only a null `memberId`.
- **Parser:** corrupt, empty and partial JSON; unknown enum values.
- **Suggestion matcher:** handle extraction; exact vs unique prefix or
  substring; ambiguity yields no suggestion; dismissed ids are excluded; only
  role holders are considered.
- **`previousKick` helper:** matching by account, alias and memberId.
- **`isReservedAnnotationKey`:** covers `departure:`, and `reconcileRoster`
  ignores those rows.
- **`refresh-roster/handler.ts`,** in the existing deps-injection style:
  departure rows are written, stale `roster_members` rows are deleted, and a
  departure failure still returns 200.
- **Desktop snapshot store:** round trip, and per-guild isolation.
- **View logic as pure helpers:** flag computation, sort order, filters.
- **Manual check:** a smoke test of the Departed view, banner, role removal, and
  the "Previously kicked" badge in the running desktop app.

## Out of scope

- Kicking people from Discord.
- Tracking roles other than the configured member role.
- A new Supabase table or migration.
- Notifications (Discord or desktop) when someone departs.
