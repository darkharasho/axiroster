# Web Version — Phase 2c-13: Web Recruitment Pipeline

**Date:** 2026-06-28 · **Status:** Approved (sensible-defaults run)

## Goal
Implement the 9 `pipeline*` methods so the Recruitment tab works on web, porting
the desktop's reserved-`roster_annotations`-row board to direct Supabase ops.

## Storage (reserved roster_annotations rows; mirrors desktop)
- `meta:pipeline` — `notes` = JSON `{ stages, placement: {subjectKey: stageId},
  placedAt: {subjectKey: iso} }`.
- `prospect:<uuid>` — a prospect annotation (`nickname`, `aliases`).
- `vote:<userId>` — `notes` = JSON `{ subjectKey: 'yes'|'no'|'abstain' }`; the
  caller's voter key is `vote:${(await sb.auth.getUser()).id}`.

## Methods (return desktop shapes; reads never-throw)
- **`pipelineGet()`** → read ALL roster_annotations for the workspace once; parse
  the `meta:pipeline` doc (lazy-backfill `placedAt` for any placed subject missing
  it, writing back if changed); `prospects` = rows whose `member_id` starts
  `prospect:` (as `RosterAnnotation[]`); `votes` = rows starting `vote:` →
  `{ voterId: member_id.slice(5), row: JSON.parse(notes) }`. Return
  `{ stages, placement, placedAt, prospects, votes }`. On error → empty doc.
- **`pipelineSetPlacement(subjectKey, stageId)`** → doc.placement[k]=stageId,
  doc.placedAt[k]=now; write doc.
- **`pipelinePlaceMany(keys, stageId)`** → set each trimmed key; write doc.
- **`pipelineSetStages(stages)`** → write doc with new stages (keep placement/placedAt).
- **`pipelineAddProspect({name, handle?})`** → `prospect:<uuid>` annotation
  (nickname=name||'Prospect', aliases=[handle] if any); place in the first stage
  (or 'applied'); write doc; return the `RosterAnnotation`.
- **`pipelineRemoveProspect(key)`** → delete the row; drop from doc placement/
  placedAt; purge `key` from every `vote:*` row (read-modify-write each).
- **`pipelineVote(subjectKey, value)`** → voter key from the session; read the
  voter's `vote:` row JSON; `clear` deletes the key else sets it; write the row.
- **`pipelineLinkProspect(prospectKey, memberKey)`** → merge prospect tags/aliases/
  notes into the member annotation (union tags+aliases case-insensitively; keep
  member notes unless empty); move the placement/placedAt from prospect→member;
  re-key every `vote:*` row (`prospectKey`→`memberKey`); delete the prospect row.
- **`pipelineArchivePassed()`** → remove every subject placed in a `declined`-type
  stage from placement/placedAt; purge those keys from every `vote:*` row.

## Architecture
New `src/renderer/src/lib/webClient/pipeline.ts` with raw `roster_annotations`
helpers (`allRows`/`getRow`/`upsertAnn(full row, no prune)`/`deleteRow`/
`writeDoc`/`parseDoc`/`rowToAnn`), the 9 `web*` functions, and a voter-key resolver
(`sb.auth.getUser`). All resolve the active workspace via `activeWorkspaceId`.
Reserved rows are written RAW (full row, no prune) since their `notes`-JSON
payload must persist. Merge writes (linkProspect's member row) read-merge-write
the full annotation so unrelated fields (nickname/mainAccount) survive.
`webClient.ts` wires the 9 (no-supabase → empty doc / no-op / a local prospect for addProspect).

## Testing
Vitest (node), fakes only (chainable builder: select/eq/upsert/delete/maybeSingle;
auth.getUser). Cover: `pipelineGet` (parse doc + prospects + votes + placedAt
backfill); `setPlacement`/`setStages` write the doc; `addProspect` creates a
prospect row + places it + returns the annotation; `vote` writes the voter row;
`removeProspect` deletes + purges votes; `linkProspect` merges + re-keys a vote +
deletes the prospect; `archivePassed` removes declined placements. `webClient.test`:
no-supabase `pipelineGet()` → empty doc.
Full suite + typecheck green; `createWebClient` stays conformant.

## Out of scope
- Settings write-flows, logRetention, Cloudflare deploy.
