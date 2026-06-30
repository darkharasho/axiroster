# Recruit Card Modal (Jira-style) + Comments — Design

**Date:** 2026-06-29
**Status:** Approved (brainstorm), pending implementation plan

## Goal

Clicking a card on the Recruitment kanban (`RecruitmentView.tsx`) opens a Jira-style
detail modal. The modal is a two-pane "full detail" view:

- **Left pane** — header (name / account / badges) + a **comment thread** with a composer.
  Comments are the one genuinely new feature.
- **Right pane** — an **editable side panel**: stage, vote tally, nickname, aliases, tags,
  and read-only "time in stage".

The subject of a card is either a reconciled member or a manual `prospect:<uuid>`. The modal
works for both.

## Non-goals (YAGNI)

- No threaded replies, reactions, or @mentions on comments.
- No activity/system events in the thread (the mock's "moved from Trialing → Review" lines are
  **out** of this version).
- No rich-text editor for comments — plain text authored, **markdown rendered** on display.
- No notifications/unread counts.

## Decisions (from brainstorm)

1. **Layout:** Full detail, two-pane (option B of the mockups).
2. **Comment storage:** one annotation row per comment (`comment:<uuid>`), no last-write-wins
   clobber — mirrors how `vote:<userId>` already dodges clobber.
3. **Comment format:** plain text + markdown render (`react-markdown` + `remark-gfm`, already
   deps). Author may **edit/delete their own**; the workspace **owner may delete any**.
4. **Side panel editing:** fully editable — stage, votes, nickname, aliases, tags.

## What already exists (no new code needed)

- **Stage** → `client.pipelineSetPlacement(subjectKey, stageId)` (existing).
- **Votes** → `client.pipelineVote(subjectKey, value)` + `tallyVotes` (existing; author derived
  server-side).
- **Nickname / aliases / tags** → `client.upsertAnnotation(memberId, patch)` (existing). Confirmed
  to operate on **any** annotation key including `prospect:<uuid>`, on both desktop
  (`roster.upsert` + `sync.pushAnnotation`) and web (`webUpsertAnnotation` upsert to
  `roster_annotations`). No new method required for the editable side panel.
- **Time in stage** → `placedAt[subjectKey]` already returned by `pipeline:get`.
- **markdown** → `react-markdown@^9` and `remark-gfm@^4` are already in `package.json`.
- **owner role** → web has `roleFor(sb, ws) === 'owner'`; desktop is the local single owner.

So the **only new backend surface is comments.**

## Comment data model

Stored as a **reserved annotation row** per comment, reusing the annotation store + sync (same
zero-migration approach as the rest of the pipeline):

- **Key:** `comment:<uuid>`
- **Row `notes`:** `JSON.stringify({ subjectKey, authorId, authorName, body })`
- **Timestamps:** the row's native `createdAt` / `updatedAt` (no extra fields).

`authorId` / `authorName` are a **snapshot** captured server-side at creation (the renderer never
passes an author — same anti-spoof rule as voting). `authorName` is stored so the thread renders
even if the author later leaves the workspace.

Extend `isReservedAnnotationKey` (`src/shared/rosterReconcile.ts`) to also match `comment:` so
comment rows are excluded from the reconciled member list.

```ts
// src/renderer/src/lib/pipeline.ts (pure, node-testable)
export interface PipelineComment {
  id: string            // the uuid portion (or full comment:<uuid> key — pick one, be consistent)
  subjectKey: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
  updatedAt?: string    // present only if edited
}
export function parseCommentRow(rec: RosterAnnotation): PipelineComment | null
export function sortComments(list: PipelineComment[]): PipelineComment[] // createdAt asc
```

## New client methods (the seam)

Added to the `AxiClient` contract (`src/preload/index.d.ts`), implemented on both platforms and
exposed through `client.ts`:

```ts
pipelineGetComments(subjectKey: string): Promise<PipelineComment[]>   // sorted asc
pipelineAddComment(subjectKey: string, body: string): Promise<PipelineComment>
pipelineEditComment(commentId: string, body: string): Promise<PipelineComment>
pipelineDeleteComment(commentId: string): Promise<void>
```

Comments are **lazy-loaded when the modal opens** (`pipelineGetComments`), not bundled into
`pipeline:get`, to keep the board payload small.

### Desktop (`src/main/index.ts`, mirroring `pipeline:vote`)

- `pipeline:addComment` — derive `authorId`/`authorName` from the restored session; create a
  `comment:<uuid>` row; `sync.pushAnnotation`.
- `pipeline:editComment` — load row, **reject unless `authorId === session user`**; update `body`,
  bump `updatedAt`; push.
- `pipeline:deleteComment` — load row, allow if `authorId === session user` **or** caller is owner;
  `roster.remove` + `sync.removeAnnotation`.
- `pipeline:getComments(subjectKey)` — `roster.list()` filtered to `comment:` rows whose parsed
  `subjectKey` matches, parsed + sorted.

### Web (`src/renderer/src/lib/webClient/pipeline.ts`)

Same four functions against `roster_annotations`, `authorId` = supabase session user id,
`authorName` resolved from the session/workspace member. Owner check via existing `roleFor`.
Edit/delete enforce the same author/owner rule before writing. Registered in `webClient.ts` and
routed through the `client` proxy.

## Frontend

### New component — `src/renderer/src/components/RecruitCardModal.tsx`

Two-pane modal (see approved mockup, variant B). Props: the subject (member or prospect),
the pipeline data (stages, placement, placedAt, votes), `canEdit`, `myVoterId`, owner flag,
and `onClose` / `onChanged`.

- **Header:** avatar, display name, account/handle line, badges (prospect, stage · days, tags).
- **Left — comment thread:**
  - On open, `pipelineGetComments(subjectKey)`; render each comment with `react-markdown` +
    `remark-gfm`.
  - Composer: textarea + Comment/Cancel. `canEdit` required to post.
  - Own comments show edit/delete; owner sees delete on all. Edited comments show an "(edited)"
    marker (presence of `updatedAt`).
  - After add/edit/delete, refetch the thread (simple + correct; volume is low).
- **Right — editable side panel:**
  - **Stage** dropdown → `pipelineSetPlacement`.
  - **Votes** → existing vote tally + buttons (`pipelineVote`), shown under the same
    `canEdit && myVoterId` rule used on the board.
  - **Nickname / Aliases / Tags** → `upsertAnnotation(subjectKey-or-annotationKey, patch)`,
    reusing the editing patterns/components from `MemberDetail.tsx` (incl. tag color registry).
  - **Time in stage** read-only from `placedAt`.
  - All edits gated by `canEdit`; when false the panel is read-only.

### `RecruitmentView.tsx` wiring

- Track `openSubjectKey` state; render `<RecruitCardModal>` when set.
- Add an open affordance on each card. **Distinguish click-to-open from drag** (the cards are
  draggable): only open the modal on a click that did not move past a small drag threshold
  (track pointer down/up position, or open via a dedicated "expand" control on the card to avoid
  fighting the drag handler). Decide the exact mechanism in the plan.
- After modal `onChanged`, refresh the board (re-run the existing `pipeline:get` load) so stage /
  votes / tag edits reflect immediately.

## Permissions summary

| Action | Allowed when |
| --- | --- |
| View modal + comments | anyone who can see the board |
| Post / edit / delete own comment | `canEdit` (workspace member) |
| Delete any comment | workspace **owner** |
| Edit stage / votes / nickname / aliases / tags | `canEdit` |

## Testing

- **Pure (`pipeline.test.ts`):** `parseCommentRow` for valid + malformed rows; `sortComments`
  ordering; `isReservedAnnotationKey` now matches `comment:`.
- **Web (`pipeline` web tests, mirroring existing pipeline/vote tests):** add → get round-trips;
  edit by non-author rejected; delete by author and by owner allowed, by other rejected;
  `subjectKey` filtering.
- **Desktop:** if main-process handler tests exist for `pipeline:vote`, mirror them for the four
  comment handlers (author derivation, author/owner enforcement).
- Manual: open modal from a card, post/edit/delete a comment, edit stage/tags, confirm board
  reflects changes; confirm reserved `comment:` rows never appear in the roster member list.

## Files touched

- `src/shared/rosterReconcile.ts` — `isReservedAnnotationKey` += `comment:`.
- `src/renderer/src/lib/pipeline.ts` — `PipelineComment`, `parseCommentRow`, `sortComments`.
- `src/preload/index.d.ts` — four `pipeline*Comment(s)` methods on the contract.
- `src/preload/index.ts` — Electron bridge for the four methods.
- `src/main/index.ts` — four IPC handlers (author derivation + author/owner enforcement).
- `src/renderer/src/lib/webClient/pipeline.ts` + `webClient.ts` — web implementations + registration.
- `src/renderer/src/components/RecruitCardModal.tsx` — new modal component.
- `src/renderer/src/components/RecruitmentView.tsx` — open/close wiring, click-vs-drag, refresh.
- Tests alongside the above.
</content>
