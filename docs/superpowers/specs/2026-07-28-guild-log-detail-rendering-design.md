# Guild Log — Detail Rendering (Expandable Rows) — Design

**Date:** 2026-07-28
**Status:** Approved (design), pending implementation plan

## Summary

Discord audit events carry a multi-line `details` blob (message before/after
bodies, kick reasons, role changes) that the Guild Log currently reduces to the
**first line of raw text** appended to the action — for a message edit that is
literally the opening code fence (`· Before: ``` `), and the actual audit
content is unreachable. This design replaces that fragment with **expandable
rows** (Option A of three mocked treatments): collapsed rows keep a one-line,
category-aware preview; clicking expands a detail card that renders the full
parsed details — diff blocks for edits, content blocks for deletes/reasons,
+/− tags for role/emoji changes, arrow pairs for setting changes, key-value
rows for the rest.

No producer (bot) changes and no storage/wire changes: everything renders from
the `details` string already present in `event.raw` (and `raw.motd` for the one
GW2 case). Purely a renderer feature.

## Goals

- The full audit content of every event is readable in the log — nothing
  truncated into garbage, nothing dropped.
- Collapsed rows stay one line; scanning density is unchanged.
- One uniform treatment across all Discord event types + the GW2 `motd`.
- Honest gaps: uncached/unavailable content and unresolvable role mentions
  render dimmed, never invented, never dropped.

## Non-goals

- No bot-side changes (the `details` grammar is consumed as-is).
- No role-mention resolution (no roles map exists yet) — unresolvable
  `<@&id>` tokens render as dimmed id chips, mirroring the channel-chip rule;
  a future roles map upgrades them with zero rework (same deferral shape as
  the `IdentityIndex.channels` map).
- No changes to search (the stored `summary` already contains the details
  text, so content is already searchable), filtering, storage, or sync.
- No web-app work in this pass (shared lib code is written to be reusable).

## Producer contract (what the bot emits)

`_log_discord_event` in `axitools/cogs/audit.py` joins a `details` dict as
`"Key: value"` lines. Message bodies pass through `_format_multiline_value`,
which wraps them in triple-backtick fences (the value opens with ``` on the
key line; body lines follow; a closing ``` line ends it). Observed keys by
event type:

| Event type(s)                         | Keys                                        |
|---------------------------------------|---------------------------------------------|
| `member_join` / `member_leave`        | `Details` (boilerplate sentence)            |
| `member_kick`                         | `Details` boilerplate + `Reason` (fenced)   |
| `member_ban` / `member_unban`         | `Details` boilerplate                       |
| `message_delete`                      | `Content` (fenced or sentinel), `Attachments` |
| `message_edit`                        | `Before`/`After` (fenced) or `Content` sentinel, `Embeds` (`a -> b`), `Attachments` (`a -> b`) |
| `member_role_update`                  | `Added`/`Removed` (comma-joined `<@&id>` mentions) |
| `member_server_(un)mute/(un)deaf`     | `Channel` label or `Details` boilerplate    |
| `guild_update`                        | `Name`/`AFK Channel`/`AFK Timeout` (`a -> b`) |
| `role_create` / `role_delete`         | `Role` (name)                               |
| `role_update` / `channel_update`      | `Name`/`Color` (`a -> b`)                   |
| `channel_create` / `channel_delete`   | none (the channel chip carries it)          |
| `emoji_update`                        | `Added`/`Removed` (fenced, comma-joined names) |

Sentinels: values beginning `Unavailable (` mark content the bot could not
capture (missing message-content intent / uncached message).

`Channel: …` lines are already consumed by the channel chip and stay excluded
from details rendering.

## Design

### 1. Parse layer — `src/renderer/src/lib/auditDetails.ts` (new, pure)

```ts
export interface DetailField {
  key: string          // "Before", "Reason", "Attachments", …
  value: string        // fence markers stripped; may be multi-line
  fenced: boolean      // value was ``` wrapped (message body / list)
  unavailable: boolean // value matched the "Unavailable (…)" sentinel
}

export interface DetailModel {
  fields: DetailField[] // ordered as emitted; empty => row not expandable
}

export function parseDetails(details: string | undefined): DetailModel
export function detailPreview(model: DetailModel): Seg[] // one-line preview
```

The `Seg` type moves from `auditIdentities.ts` into `auditDetails.ts`
(re-exported from `auditIdentities` for existing importers) so the dependency
points one way: `auditIdentities` → `auditDetails`.

Grammar rules:

- Split into lines; each `Key: rest` starts a field. `rest === '```'` (or
  starting with ```` ``` ````) opens a fenced value: subsequent lines belong to
  the field until a closing ``` line. Fence markers are stripped from `value`.
- Lines that belong to no field (continuation without a fence — defensive) are
  appended to the previous field's value; a keyless line with no preceding
  field starts a `Details` field.
- Dropped fields: `Channel: …` (chip already), and **boilerplate suppression**:
  a `Details` field whose value is one of the bot's fixed sentences ("Member
  joined the server.", "Member left the server.", "Member was kicked.",
  "Member was banned.", "Member was unbanned.", "Voice state updated.") adds
  nothing over the rendered verb. Any other `Details` value is kept.
- `Unavailable (…` values set `unavailable: true` (value retained for the
  tooltip-curious; renderer shows a dimmed note).
- Empty/undefined input → `{ fields: [] }`.

`detailPreview` derives the collapsed one-liner by category (first match wins):

- diff pair → `"before" → "after"` (first line of each, quoted)
- content/reason block → `"first line"` (quoted)
- unavailable-only → `content unavailable` (dim seg)
- Added/Removed → `+ A · − B` (first entries; `<@&id>` shown as `@id`)
- `a -> b` value → `Key: a → b`
- otherwise → first `Key: value`

Previews are `Seg[]` so the existing action-segment renderer styles them;
clamping to one line is CSS (`truncate`).

### 2. Category renderer — inside `GuildLog.tsx`

A `DetailCard` component maps parsed fields to blocks. Category precedence is
explicit — first matching rule wins per field (key semantics beat value shape,
so e.g. `emoji_update`'s **fenced** `Added` list still renders as ± tags, not
a content block):

1. **Diff:** `Before` + `After` both present → paired blocks; Before struck
   through on red tint, After on green tint (mono, `white-space: pre-wrap`).
2. **± tags:** `Added`/`Removed` → comma-split into green `+` / red `−` tags.
   A `<@&(\d+)>` token renders as a dashed dimmed `@<id>` tag (unresolvable —
   same rule as unknown channel ids).
3. **Unavailable:** `unavailable` fields → dimmed italic note, no block.
4. **Content block:** remaining fenced or multi-line values (`Content`,
   `Reason`, MOTD) → mono block on `panel-raised`.
5. **Change arrows:** values matching `/^(.+) -> (.+)$/` → `old → new` with
   old dim, new bright.
6. **Key–value rows:** everything else (`Attachments: 1`, `Role: name`, kept
   `Details`), key in a fixed-width faint column.

Long bodies: card content `max-height ~16rem`, inner `overflow-y: auto`.

### 3. Row behavior — `GuildLog.tsx` + `auditIdentities.ts`

- `detailContext()` (the first-raw-line fragment) is **removed** from
  `auditIdentities.ts`; `RowModel` gains `details?: DetailModel` populated for
  Discord events (from `raw.details`) and for GW2 `motd` (synthesized
  `Message of the day` field from `raw.motd`).
- `EventRow` renders `detailPreview` segs (faint, truncated, flex-shrink) after
  the chips, and a trailing chevron **only when `fields.length > 0`**; rows
  without details are inert (no chevron, no pointer affordance beyond today's
  hover).
- Whole-row click toggles expansion (row is a `button`-role element for
  keyboard access); expanded state is a `Set<uid>` held by `GuildLog` — it
  survives list refreshes (`audit:updated` refetches); entries for rows no
  longer in the list (filter/guild changes) are harmless stale keys, since an
  absent row renders nothing.
- The detail card renders directly under its row, inset past the
  time/source gutter (left margin aligned with the chip column), on
  `panel-sunk` with a hairline border — matching the approved mock.

### 4. GW2 parity

`motd` is the only GW2 type whose content is currently invisible
(`raw.motd`). It gets a one-field `DetailModel` (content block). All other GW2
types already state their full content inline and stay non-expandable.

## Error handling

- Parser never throws: malformed input degrades to plain key-value fields (or
  a single keyless field appended to nothing → kept as `Details`-style row).
- Unclosed fences consume to end of string (bot truncation produces this).
- Missing `raw`/`details` → empty model → plain row, exactly today's render.

## Testing

- `auditDetails.test.ts` (new): grammar cases — simple kv; fenced single- and
  multi-line; Before/After pair; unclosed fence; Channel-line drop;
  boilerplate suppression (each sentence); sentinel flag; role-mention split;
  `a -> b` detection; preview derivation per category; empty input.
- `auditIdentities.test.ts`: update for `detailContext` removal — rows carry
  `details` models instead of ` · fragment` segs; motd case added.
- Component behavior (chevron gating, toggle) verified in the running app —
  the project has no component-test harness, and adding one is out of scope.

## Files

| File | Change |
|------|--------|
| `src/renderer/src/lib/auditDetails.ts` | new — parser + preview |
| `src/renderer/src/lib/auditDetails.test.ts` | new |
| `src/renderer/src/lib/auditIdentities.ts` | drop `detailContext`, attach `DetailModel` to `RowModel` |
| `src/renderer/src/lib/auditIdentities.test.ts` | update |
| `src/renderer/src/components/GuildLog.tsx` | preview seg, chevron, toggle state, `DetailCard` |
