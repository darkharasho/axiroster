# Web Version — Phase 2c-8: Web Roster CRUD (tags / annotations / links)

**Date:** 2026-06-28
**Status:** Approved (sensible-defaults run)

## Goal
Implement the Supabase-direct CRUD the roster needs: `getTagRegistry`,
`setTagRegistry`, `upsertAnnotation`, `removeAnnotation`, `setLink`, `removeLink`.
This fixes the **RosterView mount crash** (`getTagRegistry` is called on mount)
and makes the roster **editable** (notes/tags/links). All are direct
`roster_annotations`/`roster_links` table ops (no Edge Function, so unaffected by
the separate CORS issue).

## Storage (mirrors the desktop)
- **Tag registry** lives in the reserved annotation row `member_id = 'meta:tags'`,
  its `notes` column holding `JSON.stringify(Record<tag,color>)`. `getTagRegistry`
  reads + JSON-parses it (→ `{}` on missing/invalid); `setTagRegistry` upserts that
  row with `notes = JSON.stringify(map)` (it persists even when `{}` — it is app
  metadata, filtered from the member list by `isReservedAnnotationKey`).
- **Annotations:** `roster_annotations(workspace_id, member_id, nickname,
  aliases jsonb, notes, tags jsonb, main_account, created_at, updated_at)`.
- **Links:** `roster_links(workspace_id, account_name, member_id, created_at)`.

## upsertAnnotation merge/prune (verbatim from `rosterStore.upsert`)
`upsertAnnotation(memberId, patch)`:
1. Fetch the existing row (→ a `RosterAnnotation`, or a blank default).
2. Apply the patch: `nickname = patch.nickname.trim()`, `aliases =
   cleanList(patch.aliases)`, `notes = patch.notes`, `tags = cleanList(patch.tags)`,
   `mainAccount = patch.mainAccount.trim()` — each only when the patch field is
   defined. `updatedAt = now`.
3. **Prune:** if the merged record `isEmpty` (`!nickname.trim() && aliases.length===0
   && !notes.trim() && tags.length===0 && !mainAccount.trim()`) → delete the row,
   return `null`.
4. Else upsert (`onConflict: 'workspace_id,member_id'`) and return the
   `RosterAnnotation`.
`cleanList(xs)` = trim + drop empties + dedupe (order-preserving).

## Methods (return desktop shapes directly, NOT Result)
- `getTagRegistry(): Record<string,string>` — `{}` on any failure.
- `setTagRegistry(map): void`.
- `upsertAnnotation(memberId, patch): RosterAnnotation | null` (merge/prune above).
- `removeAnnotation(memberId): void` — delete the row.
- `setLink(accountName, memberId): RosterLink` — upsert
  `(workspace_id, account_name, member_id)` (`onConflict: 'workspace_id,account_name'`),
  return `{ accountName, memberId, createdAt: now }`.
- `removeLink(accountName): void` — delete the row.

All resolve the active workspace via the 2c-1 `activeWorkspaceId`; on no
workspace / no supabase they no-op (`{}` / `null` / nothing).

## Architecture
New `src/renderer/src/lib/webClient/crud.ts`:
- helpers: `isEmpty`, `cleanList`, `annRowToAnnotation`, `annotationToRow`,
  `now()`.
- the six `web*` functions taking `(sb, settings, …args)`, using `activeWorkspaceId`.
- imports `RosterAnnotation`/`RosterAnnotationPatch`/`RosterLink` from
  `../../../../preload/index.d`.

`webClient.ts` wiring: replace the six `ni(...)` stubs; Supabase-backed writes use
the no-supabase guard returning the empty value (`getTagRegistry`→`{}`,
`upsertAnnotation`→`null`, `setLink`→ a best-effort local `{accountName,memberId,
createdAt}`; `setTagRegistry`/`removeAnnotation`/`removeLink`→ no-op).

## Testing
Vitest (node), fakes only. The fake supabase routes `from('roster_annotations')`
/`from('roster_links')` `.eq()/.maybeSingle()/.upsert()/.delete()` and provides
`auth.getUser` + `workspace_members` for `activeWorkspaceId`.
- `getTagRegistry`: a `meta:tags` row with `notes: '{"core":"#10b981"}'` → that
  map; missing/invalid → `{}`.
- `setTagRegistry`: upserts `meta:tags` with `notes = JSON.stringify(map)`.
- `upsertAnnotation`: a patch on a new member → upsert called with the mapped row,
  returns the annotation; a patch that leaves it empty → delete called, returns
  `null`; `aliases`/`tags` are cleaned (trim/dedupe).
- `removeAnnotation`/`removeLink`: delete called with the right filters.
- `setLink`: upsert called with `{workspace_id, account_name, member_id}`, returns
  the `RosterLink`.
- `webClient.test.ts`: no-supabase smoke (`getTagRegistry`→`{}`, etc., no throw).
- Full suite + typecheck green; `createWebClient` stays conformant.

## Out of scope
- `discordMembers`, members panel, pipeline, audit, the other invite methods,
  `upsertGuild`/`removeGuild`. The **Edge Function CORS fix** is a separate slice
  (this CRUD is direct-table and needs no functions).
