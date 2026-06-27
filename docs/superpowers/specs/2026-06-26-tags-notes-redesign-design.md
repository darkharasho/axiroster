# Tags & Notes Redesign — Design

**Date:** 2026-06-26
**Status:** Approved (pending spec review)
**Area:** `MemberDetail` — member annotations (tags + notes)

## Goal

Redesign the two free-form annotation fields on a roster member:

- **Notes** → a modern **Notion-style block (WYSIWYG) editor** (full block editor, "scope C").
- **Tags** → an intuitive, **color-coded** experience: tags become a reusable, saved
  vocabulary with a per-tag color picked once and applied roster-wide.

Both changes must preserve the existing local-JSON + Supabase sync model and the
read-only mode for shared-workspace readers.

## Non-Goals

- No image/file embeds inside notes (would complicate the local-JSON + Supabase
  text-column sync with binary data). Core blocks only.
- No external embeds (YouTube / link cards) or tables in v1.
- No change to the Supabase schema (no new migration). Reuse existing columns/tables.
- No change to how tags are *searched* in `RosterView` (stays string-based).

## Current State (baseline)

- `MemberDetail.tsx` renders tags as plain `.chip` pills with an add-input + Plus
  button, and notes as a plain `<textarea>` saved on blur.
- Data model (`rosterStore.ts` / `preload/index.d.ts`):
  `RosterAnnotation { notes: string; tags: string[]; ... }`.
- Persistence: `userData/rosterAnnotations.json` via `RosterStore`, optionally synced
  to Supabase by `supabaseSync.ts`.
- Supabase `roster_annotations` columns: `notes` is **text**, `tags` is **jsonb**
  (array of strings). Sync flows through `RosterStore` ↔ `SyncProvider`.
- `RosterView.tsx` includes `...m.tags` in its search haystack (notes are not searched).
- Styling: Tailwind + custom component classes (`.chip`, `.field`, `.btn`) in
  `index.css`; tokens in `tailwind.config.js` (dark charcoal base, emerald accent,
  Inter font). Icons: lucide-react.

## Library Choice — Notes Editor

**BlockNote** (built on TipTap / ProseMirror).

- Provides Notion-style blocks, the `/` slash menu, drag-to-reorder handles, and a
  format toolbar out of the box, with **JSON block documents** as its native value.
- Themeable to the existing dark / emerald tokens.
- Rationale: fastest path to the full block-editor scope with the least custom
  surface area. Raw TipTap was rejected (hand-building slash menu + drag = far more
  work); hand-rolled was rejected outright.

### Block set (v1)

- Structural: paragraph, headings (H1–H3), bulleted list, numbered list,
  to-do / checkbox, callout, quote, code block, divider.
- Inline marks: bold, italic, strike, inline code, highlight.
- Explicitly excluded: images, file/binary embeds, external embeds, tables.

## Data Model & Storage

### Notes — JSON in the existing text column (zero backend change)

- The block document is serialized with `JSON.stringify` and stored in the existing
  `notes` **text** column / `RosterAnnotation.notes` string. No schema or sync change.
- **Migration (read path, automatic & lossless):** when loading `notes`, attempt to
  parse it as a BlockNote document. If it does not parse as a block doc (i.e. it is
  legacy plain text, including empty string), wrap it into a single paragraph block.
  This is applied transparently in the editor-loading layer — older clients that
  still read `notes` as plain text will see JSON, which is acceptable since the
  redesigned client is the writer; no destructive rewrite happens on read.
- **Derived plaintext:** a helper extracts concatenated text from a block doc. Used by:
  - `isEmpty()` in `rosterStore.ts` — replace `!a.notes.trim()` with "block doc has no
    text" so an empty editor still prunes the annotation. The helper must treat both a
    legacy empty string and an empty block-doc JSON as empty.
  - Future notes search (not wired into `RosterView` in v1, but the helper exists).

### Tags — assignment unchanged, colors in a registry

- **Assignment stays `string[]`** on each `RosterAnnotation.tags`. Sync, RLS, and
  `RosterView` tag search are unchanged.
- **New tag registry**: a map of tag **name → color** so each tag renders identically
  everywhere and its color is chosen once.
  - Color values are drawn from a fixed palette (emerald, blue, amber, rose, violet,
    and a neutral default) keyed by a stable color id, so the renderer maps id → token
    classes. Storing a color **id** (not raw hex) keeps it theme-friendly.
  - A tag with no registry entry renders with a deterministic default color derived
    from its name (hash → palette) until/unless someone assigns one.
- **Registry storage — reserved sync row (Option A, zero migration):**
  - Store the registry as a single reserved record in the existing
    `roster_annotations` table/`RosterStore`, under a reserved `memberId` key
    `meta:tags`. The color map is held in that record's `notes` field as JSON
    (`{ "commander": "emerald", "core": "blue", ... }`).
  - Reuses **all** existing sync/RLS/persistence plumbing — no migration, no edge
    function, no RLS change. Ships immediately.
  - Guard rails:
    - The `meta:tags` key is filtered out of the reconciled member list so it never
      appears as a fake member (check `rosterReconcile.ts` and any place that maps
      annotations → members).
    - `isEmpty()` / empty-pruning must NOT delete the `meta:tags` row when its `tags`
      array is empty — treat reserved keys as never-empty, or skip pruning for the
      `meta:` prefix.
    - Tag-name matching for the registry is case-insensitive, consistent with the
      existing case-insensitive tag dedupe in `cleanList`.

## UI / UX

### Tags

- Pills: tinted background + colored dot + label, in the saved color; X (remove)
  appears on hover only (less visual noise).
- "＋ Add tag" affordance opens a **`TagPicker` popover**:
  - Type-to-search existing registry tags; highlight match.
  - "Create" row to add a brand-new tag inline (with a color swatch row to pick its
    color; defaults to the name-derived color).
  - Selecting an existing tag assigns it; a swatch row lets you recolor a tag (updates
    the registry → recolors that tag everywhere).
- Read-only members: static colored pills, no X, no "Add tag", no popover.

### Notes

- New `NotesEditor.tsx` wrapping BlockNote, themed to dark/emerald tokens:
  drag handles on hover, format toolbar, `/` slash menu.
- Saves through the existing `save({ notes })` path (serialize on change, debounced /
  on-blur consistent with current behavior).
- Read-only members: BlockNote in non-editable mode rendering the doc (no toolbar /
  slash / drag).

### Visual reference

Approved mock established: color-coded pills with dot + hover-X + create/recolor
popover; Notion-style editor with headings, bullets, to-dos, callout, inline code,
highlight, divider, slash menu. Match the existing tokens (charcoal surfaces, emerald
accent, Inter).

## Components & Boundaries

- `NotesEditor.tsx` — wraps BlockNote; props: `value: string` (serialized doc),
  `onChange/onSave(serialized: string)`, `editable: boolean`. Owns
  load-migration (legacy string → block doc) and serialization. Self-contained;
  depends only on BlockNote + tokens.
- `TagPicker.tsx` — the add/search/create/recolor popover; props: current tags,
  registry, `editable`, callbacks to assign/remove a tag and to set a tag's color.
- `tagRegistry.ts` (renderer or shared util) — palette definition, color-id → classes
  map, name→default-color hashing, and (de)serialization of the `meta:tags` record.
- `notesDoc.ts` (shared util) — parse/serialize a block doc, legacy-string detection &
  wrapping, and `docToPlainText()` for empty-check/search.
- `rosterStore.ts` — `isEmpty()` updated for block-doc notes + reserved-key guard;
  `meta:tags` never pruned.
- `MemberDetail.tsx` — swaps the textarea for `NotesEditor` and the chip-input for the
  pill row + `TagPicker`; loads/saves the registry alongside the member annotation.
- `rosterReconcile.ts` / member-mapping — exclude `meta:` reserved keys from members.

## Error Handling & Edge Cases

- Corrupt / non-JSON `notes` → treated as legacy plain text, never throws (mirrors
  `RosterStore.read()`'s corrupt-file safety).
- Corrupt `meta:tags` registry JSON → fall back to an empty registry; tags still render
  with name-derived default colors. Never throws.
- Concurrent edits via sync: registry is last-write-wins per the existing
  `applyRemote` semantics (same as any annotation today). Acceptable for v1.
- Renaming/deleting a tag from a member doesn't delete the registry color (orphan
  colors are harmless and reused if the tag reappears).
- Empty editor prunes the member annotation exactly like an empty textarea did.

## Testing

- `notesDoc.ts`: legacy-string → block-doc wrap (incl. empty string), round-trip
  serialize/parse, `docToPlainText()` correctness, corrupt-input safety.
- `rosterStore.ts`: `isEmpty()` with empty vs non-empty block docs; `meta:tags`
  reserved row never pruned; reserved key excluded from member list.
- `tagRegistry.ts`: name→default-color determinism, case-insensitive lookup,
  serialize/parse of `meta:tags`, corrupt-registry fallback.
- Run vitest at `--maxWorkers=2` (global instruction).

## Rollout / Compatibility

- No DB migration; the redesigned client is the writer of block-JSON notes and the
  `meta:tags` row. Older clients reading `notes` see JSON text (non-destructive) and
  ignore the `meta:tags` member if surfaced (guard rails ensure it isn't).
- Feature is additive to `MemberDetail`; no version-gated release work beyond shipping
  the build.
