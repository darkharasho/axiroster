# Recruitment Pipeline — Design (Wave 3)

**Date:** 2026-06-27
**Status:** Approved (pending spec review)
**Area:** New "Recruitment" kanban view + pipeline state on the annotation/sync layer

## Goal

A recruitment kanban that tracks trialees through fixed-but-overridable stages
(Applied → Trialing → Review/Vote → Accepted → Passed), over **both** existing
reconciled members **and** manually-added prospects, with lightweight officer voting
in the Review stage. Per-guild toggle, default on.

## Decisions (locked in brainstorming)

- **Subjects = members + prospects (model C).** A subject is either a reconciled
  member (its `annotationKey`) or a manual prospect (`prospect:<uuid>`).
- **Stages:** a default set, **overridable per workspace**; each stage has a `type`
  (`active` | `accepted` | `declined`) so the system knows the terminal columns.
- **Voting (B-lite):** signed-in officers cast yes/no/abstain in Review; tally shown;
  leader still moves the card.
- **Storage A (zero-migration):** reuse the existing annotation store + sync. No
  Supabase schema change.

## Non-Goals

- No Supabase migration / new table (storage option A chosen).
- No vote thresholds / auto-advance (leader makes the final move).
- No stage automation beyond what's described (e.g. auto-move on attendance).
- Voting requires a shared workspace + Discord identity; in a solo/local setup the
  vote UI is simply hidden (a leader still drags cards).

## Data Model & Storage (Option A — reuse annotations + sync)

Everything rides the existing `RosterStore` annotations (`userData/rosterAnnotations.json`
+ the `roster_annotations` Supabase sync). Three reserved shapes, none of which appear
as roster members (extend `isReservedAnnotationKey` so `prospect:` and `vote:` and
`meta:` are all excluded from the reconciled member list):

1. **`meta:pipeline`** (one reserved row) — the workspace-shared pipeline doc, JSON in
   its `notes` field:
   ```jsonc
   {
     "version": 1,
     "stages": [ { "id": "applied", "label": "Applied", "color": "slate", "type": "active" }, … ],
     "placement": { "<subjectKey>": "<stageId>" }   // which column each subject is in
   }
   ```
   - `stages` absent → `DEFAULT_STAGES` applies. Editing stages here makes the override
     **workspace-shared** (so all officers agree on columns), unlike the local on/off
     toggle below.
   - `placement` is the stage map. A subject not in `placement` is "not in the pipeline."
   - LWW on this one row (a deliberate, low-churn action — same risk model as notes/tags).

2. **`prospect:<uuid>`** (one row per manual prospect) — reuses the annotation fields:
   `nickname` = display name, `aliases` = claimed Discord handle / GW2 account (for later
   linking), `notes` = block-doc trial notes, `tags` = colored tags. Per-row, so notes/tags
   sync efficiently and don't bloat the pipeline doc.

3. **`vote:<discord_id>`** (one row per officer) — that officer's votes, JSON in `notes`:
   `{ "<subjectKey>": "yes" | "no" | "abstain" }`. Each officer writes **only their own**
   row → concurrent votes never clobber. The tally aggregates across all `vote:*` rows.

**Per-guild on/off:** `GuildProfile.pipelineEnabled: boolean` (default **true**), a local
toggle in `GuildSettings` (mirrors `retentionEnabled`) — gates the nav tab only. Stage
*config* is the shared `meta:pipeline.stages`, not this local flag.

### Default stages
`DEFAULT_STAGES` (in a pure lib): `applied` (active), `trialing` (active),
`review` (active, "Review / Vote"), `accepted` (accepted/terminal), `passed`
(declined/terminal). Colors from the existing palette ids.

## Pure logic — `src/renderer/src/lib/pipeline.ts` (node-tested)

- `DEFAULT_STAGES: PipelineStage[]` and `type PipelineStage = { id; label; color; type: 'active'|'accepted'|'declined' }`.
- `parsePipelineDoc(notes: string): { stages: PipelineStage[]; placement: Record<string,string> }` — defensive; missing/corrupt → defaults + `{}`.
- `parseVoteRow(notes: string): Record<string, VoteValue>` where `VoteValue = 'yes'|'no'|'abstain'`; corrupt → `{}`.
- `tallyVotes(voteRows: Record<string,VoteValue>[], subjectKey: string): { yes: number; no: number; abstain: number }`.
- `groupBoard(subjects: PipelineSubject[], placement, stages): Record<stageId, PipelineSubject[]>` — buckets subjects into columns, dropping unknown stage ids to the first active stage.
- `type PipelineSubject = { key; name; accountName?; isProspect; tags; metrics? }` — view-model the board renders (assembled by the view from reconciled members + prospect rows).

## Backend / IPC (main)

New IPC, all backed by `RosterStore` + the existing sync push (`sync.pushAnnotation`):
- `pipeline:get` → `{ doc: <meta:pipeline notes parsed>, prospects: RosterAnnotation[], votes: { voterId: string; row: Record<string,VoteValue> }[] }` (reads `meta:pipeline`, all `prospect:*`, all `vote:*` rows).
- `pipeline:setPlacement(subjectKey, stageId)` → updates `meta:pipeline.placement`, pushes.
- `pipeline:setStages(stages)` → updates `meta:pipeline.stages`, pushes.
- `pipeline:addProspect({ name, handle? })` → creates a `prospect:<uuid>` row (uuid from main), places it in the first active stage, returns it.
- `pipeline:removeProspect(key)` → deletes the row + its placement + its votes entries.
- `pipeline:vote(subjectKey, value)` → upserts the caller's own `vote:<myDiscordId>` row (myDiscordId from the authenticated session); `value==='clear'` removes the entry.
- `pipeline:linkProspect(prospectKey, memberAnnotationKey)` → merges the prospect's
  nickname/aliases/notes/tags into the member's annotation (non-destructive union for
  tags/aliases; notes only if the member's are empty), moves the placement entry, re-keys
  every `vote:*` row's `prospectKey`→`memberAnnotationKey`, deletes the prospect row.
- `pipeline:archivePassed()` → removes placement entries whose stage `type==='declined'`
  (and their vote entries), keeping the doc bounded.
- Preload exposes these; `isReservedAnnotationKey` extended to cover `prospect:`/`vote:`.
- The caller's Discord id comes from the existing auth session (extend `authStatus`/an
  identity getter if the renderer can't already read it).

## UI — `RecruitmentView.tsx` (kanban)

New **Recruitment** nav tab (after Retention; gated by `pipelineEnabled`). Board mock
approved. Columns from `stages`; cards from `groupBoard`:
- **Card:** avatar/class, name, account-or-"Discord only", a `prospect` badge for manual
  ones, colored tags, and for real members the AxiBridge attendance line (reuse existing
  metrics). In **Review** stage: a yes/no vote bar + tally + the signed-in officer's own
  yes/no/abstain buttons.
- **Drag** a card between columns → `setPlacement`, using **native HTML5 drag-and-drop**
  (`draggable` + `onDragStart`/`onDragOver`/`onDrop`) — no new dependency. Read-only
  members get a static board (no drag, no vote, no add).
- **"＋ Add prospect"** → name + optional handle → `addProspect`.
- Clicking a card opens the existing member detail (real members) or a prospect editor
  (prospect: rows reuse the same notes/tags components).
- **Stage settings** (gear) → edit/rename/reorder stages → `setStages`. Terminal types
  are required (must keep ≥1 accepted + ≥1 declined).
- **"Archive passed"** action → `archivePassed`.
- Promote: moving a real member to an `accepted` stage offers "remove trial tags";
  a prospect in any stage shows **"Link to member"** (reuses the existing match-suggest
  picker) → `linkProspect`.

## Error Handling & Edge Cases

- Corrupt `meta:pipeline` / `vote:*` notes → defaults / empty (never throw), mirroring
  existing annotation parse safety.
- A `placement` entry whose subject no longer exists (member left, prospect deleted) is
  ignored by the board and cleaned on the next relevant write.
- Voting with no Discord identity / solo workspace → vote UI hidden; dragging still works.
- LWW on `meta:pipeline`: two officers moving different cards simultaneously could clobber
  one move — acceptable per the chosen storage model; the board refreshes on sync events.
- `archivePassed` and `removeProspect` also purge the subject's entries from every
  `vote:*` row to avoid orphans.
- Reserved keys (`meta:`/`prospect:`/`vote:`) never surface as roster members (guarded in
  reconcile + the index.ts member mapping).

## Testing

- `pipeline.ts` (node): `parsePipelineDoc`/`parseVoteRow` corrupt-safety, `tallyVotes`
  (yes/no/abstain aggregation across rows, ignores other subjects), `groupBoard`
  (bucketing, unknown-stage fallback, terminal columns), `DEFAULT_STAGES` shape.
- `isReservedAnnotationKey` extended cases (`prospect:`/`vote:` excluded) — main test.
- Link/merge + re-key logic: a pure helper for the vote re-key + tag/alias union, node-tested.
- UI (`RecruitmentView`, cards, drag, vote buttons, GuildSettings toggle) — typecheck +
  build + manual (no DOM harness), per repo convention. Run vitest `--maxWorkers=2`.

## Rollout / Compatibility

Purely additive; no schema/migration. Reserved-key guard keeps old clients safe (they'd
ignore `meta:pipeline`/`prospect:`/`vote:` rows). Feature on by default per guild but is
just a nav tab; nothing else changes until officers use it.
