# Guild-switch loading states — design

**Date:** 2026-10-12
**Status:** Approved in conversation; awaiting spec review

## Goal

Switching guilds feels janky. Today the click updates the selection, then awaits
`client.setActiveGuild(id)` and `loadGuilds()`, while each view keeps showing the
previous guild's data (or an empty state such as "No log entries yet") until its
own fetch lands. Some views also have stale-state bugs on switch.

Success means:

- Clicking a guild responds immediately: the sidebar highlights it and the main
  pane shows an empty loading skeleton shaped like the target tab.
- The previous guild's data never appears under the new guild.
- When data arrives it replaces the skeleton in place, with no layout jump.
- The skeleton primitive lives in `@axiapps/axi-design`, so other Axi apps can use it.

## Non-goals

- No change to how the desktop backend syncs (`initSync` stays fully awaited).
- No new IPC or web events.
- No skeleton for the first app launch (the full-screen `Loader2 .ar-work` stays).

## Part 1 — `.axi-skeleton` in axi-design

**Repo:** `../axi-design` (currently v1.49.1).

Add the following to `src/feedback.css`:

```css
.axi-skeleton{position:relative;overflow:hidden;display:inline-block;vertical-align:middle;
  height:.62em;width:var(--axi-skeleton-w,100%);border-radius:var(--axi-radius-xs);
  background:color-mix(in srgb,var(--axi-text) 14%,transparent)}
.axi-skeleton::after{content:"";position:absolute;inset:0;transform:translateX(-100%);
  background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--axi-text) 12%,transparent),transparent);
  animation:axi-skeleton-sweep 1.6s ease-in-out infinite}
@keyframes axi-skeleton-sweep{to{transform:translateX(100%)}}
.axi-skeleton--figure{height:.78em}
.axi-skeleton--chip{height:1.4em;width:var(--axi-skeleton-w,56px)}
.axi-skeleton--tile{height:22px;width:22px;flex:none}
@media (prefers-reduced-motion:reduce){.axi-skeleton::after{display:none}}
```

**How it is used:**

- A bar goes **inside** the real text element, so its height comes from that
  element's font. For example:
  `<span class="axi-stat__n"><span class="axi-skeleton axi-skeleton--figure" style="--axi-skeleton-w:56px"></span></span>`.
- Set the width with `--axi-skeleton-w`.
- Bars in right-aligned table cells sit on the right because the cell already
  aligns them there.

**Other changes in axi-design:**

- **`docs/RULES.md`, rule 11:** add a note that the skeleton sweep animates only
  `transform`, and is hidden when `prefers-reduced-motion` is set.
- **`docs/pages/gallery.html`:** add a "Skeleton" entry showing:
  - each variant on its own;
  - the variants in context: a stat card, a sticky-table row and a list row;
  - the default theme and `themes/flat.css`.
- **Version:** bump the minor version to 1.50.0.

**Publishing:** publishing to npm needs the user's explicit approval. Until it is
published, AxiRoster develops against the local build (`npm link` or a `file:`
dependency). The dependency is set back to `^1.50.0` before merging.

## Part 2 — AxiRoster: the switch flow

### Current behaviour

`App.tsx` `selectGuild` runs these steps in order:

1. `setSelectedId(id)`
2. `setSelectedInviteId(null)`
3. `setView('guild')`
4. `setTab('roster')`
5. `setRosterReset(n => n+1)`
6. `await client.setActiveGuild(id)`
7. `await loadGuilds()`

The views stay mounted throughout, so they keep showing the previous guild's
data until their own fetches land.

### New behaviour

1. **On click (synchronous):**
   - Set `selectedId`, the view and the tab as today.
   - Set `switching = { id, seq }`, where `seq` is taken from an incrementing ref.
2. **While `switching` is set:**
   - The sidebar row for that guild shows a small spinner.
   - The sub-tabs render from the guild's existing summary flags
     (`retentionEnabled`, `pipelineEnabled`).
   - The main pane renders the target tab's **skeleton component**. It renders
     no view and does no fetching.
3. **When `await client.setActiveGuild(id)` resolves:**
   - If `seq` is no longer the latest, do nothing.
   - Otherwise clear `switching` and set `activeGuildId = id`.
   - Then call `loadGuilds()` in the background, without awaiting it.
4. **Mounting views:** every guild view is rendered with `key={activeGuildId}`.
   Changing guild therefore always remounts it with fresh state, and the
   `rosterReset` / `resetToken` mechanism is removed.
5. **Rapid clicks:** only the switch with the latest `seq` mounts views. Earlier
   switches that resolve later are ignored.
6. **Failure:** if `setActiveGuild` rejects (and `seq` is still the latest), the
   main pane shows an `.ar-empty` message, "Couldn't open this guild", with a
   Retry button. Retry calls `selectGuild(id)` again.

### Desktop main process

In `guilds:setActive` (`src/main/index.ts`):

- Remove the redundant `sync:changed` send that follows `initSync()`.
- Send `workspace:changed` exactly once.
- `initSync` stays fully awaited. The skeleton stays up during the network
  phase, which is better than showing stale cached rows. This trade-off is
  accepted.

### Web

No change is needed. `webClient.setActiveGuild` still calls
`webSetActiveGuild` and then `realtime?.resync()`. The remount triggers the
refetch.

## Part 3 — The `useGuildData` hook

**File:** `src/renderer/src/lib/useGuildData.ts`

```ts
type GuildEvent = 'sync' | 'audit' | 'workspace'
function useGuildData<T>(
  load: () => Promise<T>,
  opts?: { on?: GuildEvent[] }
): { data: T | null; loading: boolean; error: unknown; reload: () => void }
```

**Loading:**

- The hook loads once on mount.
- `loading` is true only until the first load settles.

**Event subscriptions:**

| Name in `on` | Client event |
|---|---|
| `sync` | `onSyncChanged` |
| `audit` | `onAuditUpdated` |
| `workspace` | `onWorkspaceChanged` |

- Events are coalesced with a 200ms trailing debounce, and the coalesced event
  triggers a background reload.

**Background reloads:**

- They keep the existing `data`.
- `loading` stays false.

**Errors:**

- If the first load fails, `error` is set and `data` is null. The view shows
  `<LoadError onRetry={reload} />`.
- If a refresh fails, the existing `data` is kept and a toast shows the error.

**Ordering and cleanup:**

- Each request carries an incrementing id, and only the latest request's result
  is applied.
- After unmount no state is set, listeners are removed and the debounce timer is
  cleared.

**`load` stability:** the hook keeps `load` in a ref, so callers don't need to
memoise it.

## Part 4 — Skeletons for each view

**Location:** `src/renderer/src/components/skeletons/`, with one file per view.

**What they render:**

- Each skeleton renders the view's **real wrapper markup and headers**:
  `axi-stat ar-md ar-raised`, `axi-table axi-table--sticky` with its real
  `<thead>`, `ar-list` / `ar-list__rows`, `ar-log` and `ar-col__head`.
- Only the content (text and figures) is replaced by `.axi-skeleton` bars.

**Fixed rules for every skeleton:**

- **Row counts are fixed** (8 for tables and the log, 6 for lists). They are
  never taken from the previous guild.
- **Bar widths come from a constant array in each file**, so the output is
  deterministic: no randomness.
- **Toolbars** (search, filters, sub-tabs) render in place and are `disabled`.
- **Accessibility:** the root has `aria-busy="true"` and
  `aria-label="Loading <view>…"`.

| View | Skeleton |
|---|---|
| Roster | Stat cards: real labels, `--figure` bars for the numbers. Table with the real header and 8 rows: a `--tile` and a name bar (64–134px) in the first cell, right-aligned bars in the numeric columns (date about 70px, "last seen" about 22px). |
| Departed | Toolbar, then 6 `ar-list__rows` rows, each with a name bar and a shorter sub bar. |
| Log | `ar-log__day` with a short bar, then 8 `ar-log__row` lines: a short time bar and a body bar of varying width. |
| Retention | Stat card plus the real table header and 8 rows. |
| Recruitment | Real column headers (names real, count as a bar), with 2–3 card blocks per column inside `.axi-card`. |
| Sharing / Settings | `axi-page axi-page--narrow`, with section title bars and 3–4 field rows (a label bar plus an input-height bar). |

### How each view uses the hook

```tsx
const { data, loading, error, reload } = useGuildData(loadX, { on: [...] })
if (loading) return <XSkeleton />
if (error && !data) return <LoadError onRetry={reload} />
```

App renders the same `XSkeleton` while `switching` is set. The pane is therefore
identical from the click until the first data arrives.

**`LoadError`** is a small shared component built on `.ar-empty`, with a Retry
button.

### Sidebar

The sidebar skeleton in `App.tsx` (lines 224–225) switches to `.axi-skeleton`:

- `axi-skeleton axi-skeleton--tile` for the icon;
- a text bar for the name.

The `.ar-skeleton` rule is removed from `index.css` (line 1615).

### Bugs fixed by this work

| View | Bug | Fix |
|---|---|---|
| GuildLog | Has no loading flag, so "No log entries yet" flashes on every switch | Hook plus skeleton |
| GuildSettings | Doesn't clear `profile` on switch, so the old guild's form shows | Remount per guild |
| GuildSharing | Loads twice on switch | A single hook load |
| RosterView | `tagRegistry` loads only once, on first mount | It moves into the per-guild load |
| RetentionView | Applies or logs results from the previous guild | Remount plus latest-request-wins |
| RecruitmentView | Its prune step can run against the wrong guild | Remount; prune runs only on data from its own guild |

## Testing

**Test runner:** vitest, always run with `--maxWorkers=2`.

### `useGuildData` (unit tests, fake timers)

- `loading` is true until the first load resolves, then false. A reload never
  sets it back to true.
- When a refresh fails, the data is kept and a toast shows. When the first load
  fails, `error` is set and `data` is null.
- An older request that resolves after a newer one is discarded.
- Five events within 200ms trigger exactly one reload.
- After unmount, no state updates happen and listeners are removed.

### App switch flow (component tests with a mocked client)

- The new guild is highlighted and the skeleton shows before `setActiveGuild`
  resolves.
- Clicking A, then B, then C, with A resolving last, mounts only C.
- When `setActiveGuild` rejects, the error and Retry show, and Retry switches
  again.
- Views remount per guild, so the search and filter state resets.

### Regression tests (one per bug in the table above)

- Settings doesn't show the previous guild's profile.
- Sharing loads exactly once per switch.
- The Roster tag registry reloads on switch.
- Retention ignores results from a stale guild.
- Recruitment's prune never runs against another guild.
- The log shows the skeleton, not the empty state, while loading.

### Main process

- `guilds:setActive` sends `workspace:changed` once and does not send
  `sync:changed`.

### axi-design

- Check the gallery page visually in each theme.

### Manual smoke test (desktop and web)

- Switch quickly between guilds of different sizes on every tab.
- Check there's no layout jump when data arrives.
- Check the previous guild's data never shows.
- Repeat with reduced motion turned on.

## Rollout order

1. axi-design: CSS, rules, gallery, version bump. Publishing is held for approval.
2. AxiRoster:
   1. Dependency bump and sidebar migration.
   2. The hook and `LoadError`.
   3. The App switch flow and main-process cleanup.
   4. The per-view skeletons and hook adoption, one view at a time.
