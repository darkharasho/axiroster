# AxiRoster UI Redesign — Design Spec

**Date:** 2026-06-25
**Status:** Approved (pending spec review)

## Goal

Replace the current amber-on-warm-stone dark theme with a clean, flat,
Linear-style **neutral dark** theme, and restructure the roster screen into a
dense table-first layout with click-through to a full member detail view. This
is a **visual/structural redesign only** — no backend, IPC, or data-shape
changes. All real data already exists in `RosterPayload` / `BridgePlayerMetrics`.

## Direction (decided)

- **Base aesthetic:** Modern SaaS / Linear, **dark mode** — flat near-black,
  hairline borders, generous-but-tight spacing, **no glows/gradients/glass**.
- **Accent:** indigo (`#6366f1`, soft `#818cf8`). _(Swappable to amber later —
  it's one token.)_
- **Layout:** table-first roster (dense), **click a member → full-screen detail
  view** with a back button and ↑/↓ to move between members. A **Table / Cards**
  toggle offers a card-grid view of the same data.

## Architecture / approach

The redesign is overwhelmingly a **token + restyle** job. Almost all styling
routes through:

- `tailwind.config.js` → `theme.extend.colors` (`ink`, `panel`, `accent`)
- `src/renderer/src/index.css` → `@layer components` (`.btn`, `.btn-accent`,
  `.chip`, `.field`, `.led`, `.titlebar-btn`)

Swapping those re-themes the entire app. Structural work is confined to five
renderer components. No files in `src/main`, `src/preload`, or `src/renderer/src/lib`
change behavior (lib helpers like `metrics.ts`, `status.ts`, `roleStyle.ts`,
`matching.ts` are reused as-is).

## Design tokens

| Token | Old | New |
|---|---|---|
| `panel.DEFAULT` (app bg) | `#1c1917` | `#0b0c0e` |
| `panel.raised` (surfaces) | `#292524` | `#1a1c20` |
| `panel.line` (borders) | `#3a3531` | `#222428` |
| (new) `panel.hover` | — | `#15171a` |
| (new) `panel.line2` (stronger border) | — | `#2c2f35` |
| `ink.DEFAULT` | `#e7e5e4` | `#e9eaec` |
| `ink.dim` | `#a8a29e` | `#9aa0a8` |
| `ink.faint` | `#78716c` | `#646a73` |
| `accent.DEFAULT` | `#f59e0b` | `#6366f1` |
| `accent.soft` | `#fbbf24` | `#818cf8` |
| `accent.deep` | `#b45309` | `#4f46e5` |

- Fonts: keep Inter (sans). Add a mono family (`JetBrains Mono` /
  `ui-monospace`) used for tabular numerics (counts, %, durations).
- **Semantic colors unchanged:** status/LED green `#22c55e`, amber `#f59e0b`,
  red `#ef4444`, grey `#78716c` (sync state, link state, in-guild). Profession
  class colors unchanged (canonical GW2, via `gw2-class-icons` / `ClassIcon`).
- Component classes restyled to flat dark: smaller radii, hairline borders,
  `accent` for primary buttons, hover = `panel.hover`, no glow.

## Components

### `App.tsx` — shell + rail
- Restyle the left rail (guild switcher + Roster/Settings nav + sync footer) to
  the new tokens. Active states use the indigo wash, not amber.
- Guild switcher: small rounded "crest" tile (guild tag/initials) + name +
  status dot. Same data (`GuildSummary`), new look.
- Nav stays **Roster + Settings only** — no "Squads" tab.

### `Titlebar.tsx`
- New logo mark (indigo rounded square), cleaner window buttons via restyled
  `.titlebar-btn`. No structural change.

### `RosterView.tsx` — largest change
New vertical structure inside the main area:
1. **Source strip** — existing GW2 / Discord / AxiBridge `SourcePill`s,
   restyled. Keep the one-line, tooltip-for-detail behavior.
2. **Stat cards row** — 3–4 cards derived from existing data:
   - `Members` (`members.length`)
   - `Linked` (count where `status` ∈ verified/linked) / total
   - `Avg attendance` (mean of per-member `raidsAttended/raidsConsidered` where
     metrics exist)
   - `Tracked in AxiBridge` (count of members with metrics)
   - _(Final set may adjust to what reads well; all from `payload`.)_
3. **Filter pills** — existing `All / Verified / Linked / No-key / Unlinked /
   Left-guild` with counts, restyled as a clean row.
4. **View toggle** — `Table` / `Cards` segmented control.
5. **Table view (default)** — full-width, columns:
   `status dot · member (label + main account) · profession (ClassIcon) ·
   rank · attendance (bar + %) · last seen`. Sortable is **out of scope** for
   v1 (can add later). Members lacking AxiBridge metrics render `—` in the
   metric columns gracefully.
6. **Card view** — same members as a responsive card grid (Layout 3 style),
   reusing the same derived fields.

Clicking a row/card selects the member and switches the main area to the
**detail view** (see below). Search box stays (filters by the existing `hay`
fields). Refresh button stays.

### Member detail — `MemberDetail.tsx`
- Becomes a **full-screen view** (replaces the table within the main area) with:
  - A back control (← Roster) and ↑/↓ (or prev/next buttons) to move through the
    currently filtered member list without returning to the table.
  - Restyled header: class avatar + member label + status chip + link-source.
- **All existing functionality preserved**, re-skinned to new tokens:
  annotations (nickname / tags / notes), GW2 accounts (main-star, manual
  link/unlink, `LinkToMemberPicker` with suggestions + diagnostic), WvW activity
  (main class, attendance, combat time, last seen, class spread, commander
  panel, per-account breakdown), Discord roles panel (assign/unassign/kick).
- Stat tiles adopt the mockup's card look; commander/activity callouts use the
  indigo accent instead of amber.

State note: `RosterView` already owns `selectedKey`. The table/detail switch is
a render branch on whether a member is selected — minimal state change. Prev/next
operate over the existing `filtered` array.

### `SettingsView.tsx`
- Restyle to new tokens only. No structural/behavioral change.

## Data flow

Unchanged. `RosterView` calls `window.axiroster.buildRoster()` → `RosterPayload`;
`MemberDetail` receives `member`, `metrics`, discord data and calls existing
IPC (`upsertAnnotation`, `setLink`, `removeLink`, `discordAction`). Stat-card and
table-column values are **derived client-side** from data already in the payload
(reusing `aggregateMemberMetrics`, `STATUS_META`, `fmtDuration`, `fmtRelative`).

## Error / empty states

- Preserve existing error + warning banners (restyled).
- Empty roster: keep "No roster yet — connect GW2 + Discord in Settings."
- Members without metrics: metric columns/tiles show `—` (no crash, no empty
  card). Existing "No AxiBridge data…" message retained in detail.

## Testing

No automated UI tests exist in the project; verification is visual via the
in-app renderer (`sai_render_html`) and running `electron-vite dev`. Acceptance:
- `npm run typecheck` passes.
- App builds and renders with the new theme; roster table, card toggle, and
  click-through detail all work against live data.
- All previously available actions still function (link/unlink, tags, role
  assign/kick, set-main).

## Out of scope (v1)

- Column sorting in the table.
- A "Squads" feature/tab.
- Any backend, IPC, or data-model change.
- Light mode (dark only for now).
