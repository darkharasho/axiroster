# Bulk Tag Actions — Design

**Date:** 2026-06-27
**Status:** Approved (pending spec review)
**Area:** `RosterView` — multi-select + bulk tagging across roster members
**Wave:** 1 of the post-0.4.0 feature roadmap (note templates deferred)

## Goal

Let leadership tag many members at once instead of one-at-a-time in the detail
panel. Select members in the roster list (hand-pick via checkboxes/shift-click, or
"select all" the current filtered set), then **Add tag** / **Remove tag** across the
whole selection — reusing the colored-tag vocabulary shipped in 0.4.0.

## Non-Goals

- No bulk actions beyond tags in this wave (no bulk status, role, nickname). The
  selection bar is built generic so those are easy to add later, but YAGNI now.
- No new Supabase schema, table, or migration. Persistence reuses the existing
  per-member `upsertAnnotation` IPC.
- No batched/transactional bulk IPC — a per-member loop is sufficient for real
  roster sizes (tens to low hundreds). (Revisit only if it proves slow.)
- No change to how tags are colored/stored — the registry (`meta:tags`) and
  `tagRegistry.ts` helpers are reused as-is.

## Current State (baseline)

- `RosterView.tsx` holds: `payload` (roster), `query`/`filter`/`profFilter`/
  `rankFilter` → a `filtered` memo, then a table-only `sorted` memo; `selectedKey`
  (opens `MemberDetail`); `view` (`'table' | 'cards'`); and `canEdit` (false for
  read-only shared-workspace members, from `authStatus().role`).
- Rows render via two subcomponents that each take `rows` + `onSelect(annotationKey)`:
  `RosterTable` (table, rows keyed by `m.annotationKey`) and `MemberCards` (cards).
- Single-member tagging lives in `MemberDetail` via `TagPicker.tsx`, whose popover
  does search / create / recolor against the registry; persistence is
  `window.axiroster.upsertAnnotation(annotationKey, { tags })`.
- `tagRegistry.ts` exports `PALETTE`, `resolveColorId`, `tagStyle`, `dotColor`,
  `setTagColor`, `TagRegistry`, `TagColorId`; registry loaded/saved via
  `getTagRegistry` / `setTagRegistry`.
- Each `ReconciledMember` carries `annotationKey: string` and `tags: string[]`.

## Architecture

No backend changes. `RosterView` gains selection state; a reusable `SelectionBar`
appears when ≥1 member is selected; bulk tagging reuses a shared `TagChooser`
popover (extracted from `TagPicker`) and the existing per-member `upsertAnnotation`
IPC. The add/remove set math is a pure, node-testable helper.

## Components & Boundaries

### `bulkTags.ts` (renderer lib, pure — node-testable)
- `addTagToMembers(members, keys, tag): Array<{ key: string; nextTags: string[] }>`
  — for each selected key, returns the member's tags with `tag` appended **only if
  not already present (case-insensitive)**; members that already have it are
  **omitted** from the result (no-op skip).
- `removeTagFromMembers(members, keys, tag): Array<{ key: string; nextTags: string[] }>`
  — same shape; returns the difference only for members that actually have `tag`.
- `tagsInSelection(members, keys): string[]` — union of tags across the selected
  members (case-insensitively de-duped, display-cased), to populate the Remove menu.
- Input `members` is the reconciled list (or a `Map`/lookup by `annotationKey`); the
  helper does not call IPC — it only computes diffs.

### `TagChooser.tsx` (renderer component — extracted from `TagPicker`)
The search / create / recolor popover, refactored out of `TagPicker` so both the
single-member picker and the bulk bar share one implementation (avoids duplicating a
non-trivial popover).
- Props: `{ registry: TagRegistry; knownTags: string[]; excludeAssigned?: string[];
  onChoose(name: string): void; onRecolor(name: string, id: TagColorId): void;
  onClose(): void }`.
- Behavior preserved from `TagPicker`'s popover: type-to-search, "Create" row for a
  new name (with color preview), swatch row to recolor the typed/selected tag,
  click-outside + Escape dismiss, case-insensitive matching.
- `TagPicker` is refactored to render its pills + "Add tag" button and delegate the
  popover to `TagChooser` (its `onChoose` = assign-to-this-member). Public
  `TagPicker` props are unchanged; behavior identical. (This re-touches a
  freshly-shipped component — covered by typecheck + build + manual re-check.)

### `SelectionBar.tsx` (renderer component)
- Props: `{ count: number; onAddTag(): void; onRemoveTag(): void; onClear(): void }`
  — generic action bar (count + buttons), so future bulk actions are just more
  buttons. Add/Remove buttons open the respective `TagChooser` popovers.
- Renders fixed/sticky at the bottom of the roster list area when `count > 0`.

### `RosterView` (modified)
- New state: `selectedKeys: Set<string>` and `lastClickedIndex: number | null`
  (for shift-click range against the **currently displayed** order — `sorted` in
  table view, `filtered` in cards).
- Row checkbox passed into `RosterTable` / `MemberCards`: each row gets a checkbox
  (shown when selecting or on hover) that toggles its key; shift-click selects the
  range from `lastClickedIndex` to the clicked index in the displayed order.
- "Select all (filtered)" lives in `RosterView`'s **shared toolbar** (above both
  table and cards), so it is view-agnostic: checked when all displayed rows are
  selected, indeterminate when some are, toggles the entire currently-displayed set
  (`sorted` in table view, `filtered` in cards). Row checkboxes appear in **both**
  views; only the toolbar holds select-all (no per-view header checkbox), removing
  any table-vs-cards split.
- Bulk apply (Add): open `TagChooser` (knownTags from registry + roster, no
  `excludeAssigned` since selection is heterogeneous); on `onChoose(name)`, call
  `addTagToMembers(...)` and persist each returned diff via
  `upsertAnnotation(key, { tags: nextTags })`; a new tag name picked gets a registry
  color exactly as single-add does.
- Bulk apply (Remove): open a `TagChooser` (or a slim list) seeded from
  `tagsInSelection(...)`; on choose, `removeTagFromMembers(...)` and persist diffs.
- After a bulk op: `onChanged()`-equivalent refresh (rebuild roster) and a toast
  ("Tagged N members" / "Removed from N members"); keep or clear selection — **keep**
  the selection so successive ops are easy; provide explicit Clear.

## Data Flow

1. User toggles row checkboxes / select-all → `selectedKeys` updates.
2. `SelectionBar` shows the count and actions.
3. Add/Remove opens `TagChooser`; the chosen tag + current `members` + `selectedKeys`
   go to the pure helper, which returns only the members that change.
4. `RosterView` loops `upsertAnnotation(key, { tags })` over those diffs (awaited;
   small concurrency is fine), then refreshes the roster and toasts the count.

## Error Handling & Edge Cases

- **Read-only** (`canEdit === false`): no checkboxes, no `SelectionBar` — viewing only.
- **No-op adds/removes** are skipped by the helper (member already has / lacks the
  tag), so a 50-member "add commander" only writes to those who lacked it.
- **Empty selection**: bar hidden.
- **Filter changes while selected**: selection is keyed by `annotationKey`, so it
  survives re-filtering; select-all operates on the *currently displayed* set only.
  Shift-click range uses the displayed order at click time.
- **A persist call fails** (sync/IPC): catch per-member like the existing `save()`
  flow (don't throw to UI); the refresh reflects what actually saved. (Best-effort,
  consistent with current single-edit behavior.)
- **Removing a tag** no member in the selection has → not offered (menu is seeded
  from `tagsInSelection`).

## Testing

- `bulkTags.test.ts` (node): `addTagToMembers` union + case-insensitive no-op skip;
  `removeTagFromMembers` difference + skip-when-absent; `tagsInSelection` de-dupe and
  display-casing; empty-selection and empty-tag guards.
- `TagChooser` extraction: covered by typecheck + build + a manual re-check that
  single-member `TagPicker` still adds/creates/recolors identically (no behavior
  regression) — no DOM unit harness in the repo.
- `SelectionBar` + selection wiring: typecheck + build + manual (select range,
  select-all-filtered indeterminate state, add/remove across a mixed selection,
  read-only hides controls).
- Run vitest at `--maxWorkers=2` (global instruction).

## Rollout / Compatibility

Purely additive to `RosterView`; no data, schema, or sync changes. The `TagChooser`
extraction is behavior-preserving. Ships in the next build; no version-gating needed
beyond the release.
