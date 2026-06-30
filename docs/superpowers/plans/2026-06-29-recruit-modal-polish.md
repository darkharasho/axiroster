# Recruit Modal Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Three visual/UX improvements to the recruit-card feature: (1) comment-count badge on kanban cards, (2) a styled custom Stage dropdown in the modal, (3) a styled vote bar in the modal.

**Architecture:** Comment counts are added to the existing `pipeline:get` payload (desktop + web) so cards render counts without opening each modal. The Stage dropdown and vote bar are presentational rewrites inside `RecruitCardModal.tsx` — no backend or data-model change.

**Tech Stack:** TypeScript, React, Electron IPC, Supabase, Vitest, Tailwind, lucide-react.

## Global Constraints
- No new dependencies. `lucide-react` is already imported in both `RecruitmentView.tsx` and `RecruitCardModal.tsx`.
- Comment counts are a per-subject total (no unread/seen tracking).
- Stage colors map: `{ slate:'#94a3b8', blue:'#3b82f6', amber:'#f59e0b', emerald:'#10b981', rose:'#f43f5e' }` (the existing `STAGE_DOT` in `RecruitmentView.tsx:20`); fallback `#94a3b8`.
- The card comment badge is hidden when the count is 0.
- Run vitest with `--pool=forks --poolOptions.forks.maxForks=2`.
- Behavior of stage-change and voting must not change — only their presentation.

---

### Task 1: Comment counts on kanban cards (backend + contract + card render)

**Files:**
- Modify: `src/main/index.ts` (the `pipeline:get` handler, ~755-773)
- Modify: `src/renderer/src/lib/webClient/pipeline.ts` (`PipelineResult` interface ~23-28, `webPipelineGet` ~115-138)
- Modify: `src/preload/index.d.ts:424` (`pipelineGet()` return type)
- Modify: `src/renderer/src/components/RecruitmentView.tsx` (load(), state, card header render)
- Test: `src/renderer/src/lib/webClient/pipeline.test.ts`

**Interfaces:**
- Produces: `pipelineGet()` now returns an additional `commentCounts: Record<string, number>` (subjectKey → number of `comment:` rows whose payload `subjectKey` matches).

- [ ] **Step 1: Write the failing web test** — append to `src/renderer/src/lib/webClient/pipeline.test.ts`. Reuse the test file's existing `fakeSbWithUser`/`fakeSb` helpers and `webPipelineAddComment`/`webPipelineGet` imports (add any missing to the existing import block):

```ts
test('web: pipelineGet returns commentCounts per subject', async () => {
  const settings = createWebSettings(fakeStorage())
  settings.set('activeGuildId', 'w1')
  const sb = fakeSbWithUser('u1', 'member', { 'wm:u1': { workspace_id: 'w1', role: 'member', user_id: 'u1' } })
  await webPipelineAddComment(sb, settings, 'prospect:1', 'a')
  await webPipelineAddComment(sb, settings, 'prospect:1', 'b')
  await webPipelineAddComment(sb, settings, 'prospect:2', 'c')
  const res = await webPipelineGet(sb, settings)
  expect(res.commentCounts['prospect:1']).toBe(2)
  expect(res.commentCounts['prospect:2']).toBe(1)
  expect(res.commentCounts['prospect:3']).toBeUndefined()
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/renderer/src/lib/webClient/pipeline.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — `commentCounts` is undefined.

- [ ] **Step 3: Add commentCounts to the web result** — in `src/renderer/src/lib/webClient/pipeline.ts`:

In the `PipelineResult` interface (~23-28) add:
```ts
  commentCounts: Record<string, number>
```

In `webPipelineGet`, update the `empty` fallback (line 116) to include `commentCounts: {}`:
```ts
  const empty: PipelineResult = { stages: undefined, placement: {}, placedAt: {}, prospects: [], votes: [], commentCounts: {} }
```

Before the `return` on line 135, build the counts from the already-fetched `rows` (reuse the existing `commentToDTO` helper in this file):
```ts
    const commentCounts: Record<string, number> = {}
    for (const r of rows) {
      const c = commentToDTO(r)
      if (c) commentCounts[c.subjectKey] = (commentCounts[c.subjectKey] ?? 0) + 1
    }
```

And add it to the return:
```ts
    return { stages: doc.stages, placement: doc.placement, placedAt: doc.placedAt, prospects, votes, commentCounts }
```

- [ ] **Step 4: Run the web test to confirm it passes**

Run: `npx vitest run src/renderer/src/lib/webClient/pipeline.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS.

- [ ] **Step 5: Add commentCounts to the desktop handler** — in `src/main/index.ts`, inside `pipeline:get`, after the `votes` array is built (after line 772) and before the `return`:

```ts
    const commentCounts: Record<string, number> = {}
    for (const a of all) {
      if (!a.memberId.startsWith('comment:')) continue
      try {
        const p = JSON.parse(a.notes || '{}')
        if (p && typeof p.subjectKey === 'string') commentCounts[p.subjectKey] = (commentCounts[p.subjectKey] ?? 0) + 1
      } catch { /* ignore corrupt row */ }
    }
```

Change the return (line 773) to:
```ts
    return { stages: doc.stages, placement: doc.placement, placedAt: doc.placedAt, prospects, votes, commentCounts }
```

- [ ] **Step 6: Update the contract type** — in `src/preload/index.d.ts:424`, add `commentCounts` to the `pipelineGet()` return object:
```ts
  pipelineGet(): Promise<{ stages: unknown; placement: Record<string, string>; placedAt: Record<string, string>; prospects: RosterAnnotation[]; votes: { voterId: string; row: Record<string, 'yes' | 'no' | 'abstain'> }[]; commentCounts: Record<string, number> }>
```

- [ ] **Step 7: Render the badge in RecruitmentView** — in `src/renderer/src/components/RecruitmentView.tsx`:

Add `MessageSquare` to the lucide import on line 8:
```tsx
import { Users2, RefreshCw, Plus, Settings, Archive, MessageSquare } from 'lucide-react'
```

Add state near the other pipeline state (after line 25 `placedAt`):
```tsx
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
```

In `load()`, after `setPlacedAt(pipe.placedAt ?? {})` (line 63), add:
```tsx
    setCommentCounts(pipe.commentCounts ?? {})
```

In the card header row, render the badge next to the days badge. The days badge is the IIFE at lines ~442-449 ending with `})()}`. Immediately AFTER that closing `})()}` and before the closing `</div>` of the header flex row, add:
```tsx
                    {commentCounts[subj.key] > 0 && (
                      <span
                        className="flex shrink-0 items-center gap-0.5 rounded bg-panel-sunk px-1.5 py-0.5 text-[10px] text-ink-faint"
                        title={`${commentCounts[subj.key]} comment${commentCounts[subj.key] === 1 ? '' : 's'}`}
                      >
                        <MessageSquare size={10} /> {commentCounts[subj.key]}
                      </span>
                    )}
```

(If the exact placement is ambiguous, place the badge as the last child of the same flex row that holds the name and the `{d}d` days badge — read lines ~430-452 to confirm the row boundary.)

- [ ] **Step 8: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/main/index.ts src/renderer/src/lib/webClient/pipeline.ts src/renderer/src/lib/webClient/pipeline.test.ts src/preload/index.d.ts src/renderer/src/components/RecruitmentView.tsx
git commit -m "feat(recruitment): comment-count badge on kanban cards"
```

---

### Task 2: Styled Stage dropdown + vote bar in the modal

**Files:**
- Modify: `src/renderer/src/components/RecruitCardModal.tsx`

**Interfaces:**
- Consumes: existing `stages`, `stageId`, `changeStage`, `canEdit`, `tallyVotes`, `voteRows`, `myVote`, `castVote`, `reviewStageIds`, `subject` already in scope.
- Produces: no new exports — internal presentation only.

This task is presentational. The two existing behaviors (`changeStage`, `castVote`) are unchanged; only the markup that invokes them changes. Add a stage-color map and a tiny click-outside hook at the top of the component file.

- [ ] **Step 1: Add the stage color map + imports** — at the top of `RecruitCardModal.tsx`:

Add `ChevronDown`, `Check` to the existing lucide import (it already imports `X, Pencil, Trash2`):
```tsx
import { X, Pencil, Trash2, ChevronDown, Check } from 'lucide-react'
```

Add `useRef` to the React import (it already imports `useCallback, useEffect, useState`):
```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
```

Add a module-level color map (below the imports, near the top of the file):
```tsx
const STAGE_DOT: Record<string, string> = { slate: '#94a3b8', blue: '#3b82f6', amber: '#f59e0b', emerald: '#10b981', rose: '#f43f5e' }
```

- [ ] **Step 2: Add dropdown open/close state** — inside the component, near the other `useState` hooks, add:
```tsx
  const [stageOpen, setStageOpen] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!stageOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (stageRef.current && !stageRef.current.contains(e.target as Node)) setStageOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [stageOpen])
  const currentStage = stages.find((s) => s.id === stageId)
```

- [ ] **Step 3: Replace the Stage `<select>` block** — replace the entire Stage `<div className="mb-4">…</div>` block (the one containing the `<select>`, lines ~200-211) with:

```tsx
            {/* Stage */}
            <div className="mb-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Stage</div>
              <div className="relative" ref={stageRef}>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setStageOpen((o) => !o)}
                  className="flex w-full items-center gap-2 rounded-lg border border-panel-line2 bg-panel-raised px-3 py-2 text-sm font-semibold disabled:opacity-60"
                >
                  <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: STAGE_DOT[currentStage?.color ?? 'slate'] ?? '#94a3b8' }} />
                  <span className="truncate">{currentStage?.label ?? 'Unplaced'}</span>
                  <ChevronDown size={14} className="ml-auto text-ink-faint" />
                </button>
                {stageOpen && canEdit && (
                  <div className="absolute z-10 mt-1.5 w-full rounded-lg border border-panel-line2 bg-panel-raised p-1 shadow-xl">
                    {stages.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { setStageOpen(false); if (s.id !== stageId) void changeStage(s.id) }}
                        className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm ${s.id === stageId ? 'bg-accent/15' : 'hover:bg-panel-hover'}`}
                      >
                        <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: STAGE_DOT[s.color] ?? '#94a3b8' }} />
                        <span className="truncate">{s.label}</span>
                        {s.id === stageId && <Check size={14} className="ml-auto text-accent" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
```

- [ ] **Step 4: Replace the Votes block** — replace the Votes IIFE block (lines ~213-227, the `{myVoterId && stageId && reviewStageIds.has(stageId) && (() => { … })()}`) with a version that renders a split bar + legend + toggle buttons. Keep the same outer guard and the same `castVote` calls:

```tsx
            {/* Votes — only meaningful in review-ish stages */}
            {myVoterId && stageId && reviewStageIds.has(stageId) && (() => {
              const t = tallyVotes(voteRows, subject.key)
              const mine = myVote[subject.key]
              const total = t.yes + t.no + t.abstain
              const pct = (n: number): string => `${total ? (n / total) * 100 : 0}%`
              const favor = t.yes + t.no > 0 ? Math.round((t.yes / (t.yes + t.no)) * 100) : null
              return (
                <div className="mb-4">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Votes</div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-panel-line">
                    <div style={{ width: pct(t.yes), background: '#10b981' }} />
                    <div style={{ width: pct(t.no), background: '#f43f5e' }} />
                    <div style={{ width: pct(t.abstain), background: '#3b4151' }} />
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[11px]">
                    <span className="flex items-center gap-1 font-semibold text-emerald-300"><span className="h-2 w-2 rounded-sm bg-emerald-500" />{t.yes}</span>
                    <span className="flex items-center gap-1 font-semibold text-rose-300"><span className="h-2 w-2 rounded-sm bg-rose-500" />{t.no}</span>
                    <span className="flex items-center gap-1 text-ink-faint"><span className="h-2 w-2 rounded-sm bg-panel-line2" />{t.abstain}</span>
                    {favor !== null && <span className="ml-auto text-ink-faint">{favor}% in favor</span>}
                  </div>
                  <div className="mt-2.5 flex gap-2">
                    <button onClick={() => void castVote('yes')} disabled={!canEdit} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-semibold ${mine === 'yes' ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300' : 'border-panel-line text-ink-dim hover:border-panel-line2'}`}>✓ Yes</button>
                    <button onClick={() => void castVote('no')} disabled={!canEdit} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-semibold ${mine === 'no' ? 'border-rose-500/50 bg-rose-500/15 text-rose-300' : 'border-panel-line text-ink-dim hover:border-panel-line2'}`}>✕ No</button>
                    <button onClick={() => void castVote('abstain')} disabled={!canEdit} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm ${mine === 'abstain' ? 'border-panel-line2 bg-panel-hover text-ink' : 'border-panel-line text-ink-faint hover:border-panel-line2'}`}>– Abstain</button>
                  </div>
                </div>
              )
            })()}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean. (`reviewStageIds`, `tallyVotes`, `castVote`, `changeStage` are already in scope from the existing component.)

- [ ] **Step 6: Verify Tailwind tokens exist** — the snippets use `bg-panel-raised`, `bg-panel-hover`, `border-panel-line2`, `bg-accent/15`, `text-ink-dim`. These are used elsewhere in the codebase; if `npm run typecheck` passes and the classes already appear in sibling components (grep `bg-panel-hover` / `text-ink-dim` under `src/renderer`), no action. If a token is missing, substitute the nearest existing one (e.g. `bg-panel-raised` → `bg-panel`).

Run: `grep -rl "bg-panel-hover\|text-ink-dim\|border-panel-line2" src/renderer/src/components | head`
Expected: at least one existing file uses each — confirms the tokens are valid.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/RecruitCardModal.tsx
git commit -m "feat(recruitment): styled stage dropdown + vote bar in card modal"
```

---

## Self-Review

**Spec coverage:**
- Comment-count badge on cards → Task 1 (backend counts + card render). ✓
- Styled Stage dropdown → Task 2 Steps 1-3. ✓
- Styled vote bar → Task 2 Step 4. ✓

**Placeholder scan:** none — all steps carry concrete code. The only conditional guidance (badge placement in Step 7, token check in Step 6) names the exact grep/lines to resolve it.

**Type consistency:** `commentCounts: Record<string, number>` is added identically to the web `PipelineResult`, the desktop return, and the contract `pipelineGet()` type; `RecruitmentView` reads `pipe.commentCounts ?? {}`. `STAGE_DOT` keys/values match the existing map in `RecruitmentView.tsx:20`.
