# Recruitment Pipeline Implementation Plan (Wave 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-guild-toggleable Recruitment kanban that moves reconciled members and manual prospects through stages (Applied→Trialing→Review→Accepted→Passed) with lightweight officer voting, all on the existing annotation/sync layer (zero Supabase migration).

**Architecture:** Pure `pipeline.ts` does stage/vote/board logic (node-tested). Pipeline state reuses `RosterStore` annotations: a shared `meta:pipeline` row (stage config + placement map), one `prospect:<uuid>` row per manual prospect, one `vote:<userId>` row per officer. New main IPC reads/writes those rows (votes are attributed by main from the session, never the renderer). A native-HTML5-drag `RecruitmentView` renders the board.

**Tech Stack:** Electron + React 18 + TS, Tailwind (dark/emerald), lucide-react, Vitest (node env, `src/**/*.test.ts`, `--maxWorkers=2`). Spec: `docs/superpowers/specs/2026-06-27-recruitment-pipeline-design.md`.

## Global Constraints

- **Storage A (zero-migration):** all pipeline state lives in `RosterStore` annotations synced via the existing `sync.pushAnnotation`. No Supabase schema/table change.
- **Reserved keys** `meta:` / `prospect:` / `vote:` must NEVER appear as roster members — `isReservedAnnotationKey` (src/main/rosterReconcile.ts) is the single guard; extend it and it covers both reconcile internals and the index.ts call site (already filters via it).
- **Vote attribution is server-side:** `pipeline:vote` derives the voter id from the authenticated session in MAIN; the renderer never passes an identity (prevents spoofing another officer's vote). `authStatus` gains `userId` only so the UI can highlight the caller's own vote.
- **Stages:** `DEFAULT_STAGES` = applied/trialing/review/accepted/passed; each typed `active`|`accepted`|`declined`. Stage *config* is shared (in `meta:pipeline`); the on/off `pipelineEnabled` toggle is a local `GuildProfile` flag (default **true**), mirroring `retentionEnabled`.
- Drag uses **native HTML5 DnD** (`draggable`/`onDragStart`/`onDragOver`/`onDrop`) — no new dependency.
- Tag matching case-insensitive; reuse `tagRegistry`/notes components. `toast` from `../lib/toast`. UI `.tsx` gated by typecheck + build + manual (no DOM harness); pure `.ts` is unit-tested.
- Read-only members (`authStatus().role === 'read'`) get a static board (no drag/vote/add).

---

### Task 1: `pipeline.ts` — pure stage/vote/board logic + tests

**Files:**
- Create: `src/renderer/src/lib/pipeline.ts`
- Test: `src/renderer/src/lib/pipeline.test.ts`

**Interfaces:** Produces:
- `type StageType = 'active'|'accepted'|'declined'`; `interface PipelineStage { id; label; color; type }`; `type VoteValue = 'yes'|'no'|'abstain'`.
- `DEFAULT_STAGES: PipelineStage[]`.
- `interface PipelineDoc { stages: PipelineStage[]; placement: Record<string,string> }`.
- `parsePipelineDoc(notes: string): PipelineDoc` (corrupt/empty → defaults + `{}`).
- `parseVoteRow(notes: string): Record<string, VoteValue>` (corrupt → `{}`; drops non-vote values).
- `tallyVotes(rows: Record<string,VoteValue>[], subjectKey: string): { yes; no; abstain }`.
- `interface PipelineSubject { key; name; accountName: string|null; isProspect: boolean; tags: string[] }`.
- `groupBoard(subjects, placement, stages): Record<string, PipelineSubject[]>` (only placed subjects; unknown stage id → first active stage).
- `mergeAnnotationData(target, source): { aliases; notes; tags }` (union tags+aliases case-insensitively, keep target notes unless empty).
- `rekeyVotes(row, fromKey, toKey): Record<string,VoteValue>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/lib/pipeline.test.ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_STAGES, parsePipelineDoc, parseVoteRow, tallyVotes, groupBoard,
  mergeAnnotationData, rekeyVotes, type PipelineSubject
} from './pipeline'

describe('parsePipelineDoc', () => {
  it('returns defaults for empty/corrupt', () => {
    expect(parsePipelineDoc('')).toEqual({ stages: DEFAULT_STAGES, placement: {} })
    expect(parsePipelineDoc('nope{')).toEqual({ stages: DEFAULT_STAGES, placement: {} })
  })
  it('reads stages + placement and sanitizes stage types', () => {
    const doc = JSON.stringify({
      stages: [{ id: 'a', label: 'A', type: 'weird' }, { id: 'done', label: 'Done', type: 'accepted' }],
      placement: { 'm1': 'a', 'm2': 'done' }
    })
    const out = parsePipelineDoc(doc)
    expect(out.stages[0]).toEqual({ id: 'a', label: 'A', color: 'slate', type: 'active' }) // bad type → active
    expect(out.stages[1].type).toBe('accepted')
    expect(out.placement).toEqual({ m1: 'a', m2: 'done' })
  })
})

describe('parseVoteRow', () => {
  it('keeps only valid vote values', () => {
    expect(parseVoteRow(JSON.stringify({ m1: 'yes', m2: 'maybe', m3: 'no' }))).toEqual({ m1: 'yes', m3: 'no' })
    expect(parseVoteRow('')).toEqual({})
    expect(parseVoteRow('[]')).toEqual({})
  })
})

describe('tallyVotes', () => {
  it('aggregates a subject across officer rows, ignoring others', () => {
    const rows = [{ m1: 'yes' as const }, { m1: 'yes' as const, m2: 'no' as const }, { m1: 'abstain' as const }]
    expect(tallyVotes(rows, 'm1')).toEqual({ yes: 2, no: 0, abstain: 1 })
    expect(tallyVotes(rows, 'm2')).toEqual({ yes: 0, no: 1, abstain: 0 })
  })
})

describe('groupBoard', () => {
  const subs: PipelineSubject[] = [
    { key: 'm1', name: 'One', accountName: 'One.1', isProspect: false, tags: [] },
    { key: 'prospect:x', name: 'Pro', accountName: null, isProspect: true, tags: [] },
    { key: 'm2', name: 'Two', accountName: 'Two.2', isProspect: false, tags: [] }
  ]
  it('buckets only placed subjects and falls unknown stages back to first active', () => {
    const board = groupBoard(subs, { m1: 'trialing', 'prospect:x': 'ghoststage' /* unknown */ }, DEFAULT_STAGES)
    expect(board.trialing.map((s) => s.key)).toEqual(['m1'])
    expect(board.applied.map((s) => s.key)).toEqual(['prospect:x']) // unknown → first active (applied)
    expect(Object.values(board).flat().some((s) => s.key === 'm2')).toBe(false) // m2 not placed
  })
})

describe('mergeAnnotationData', () => {
  it('unions tags+aliases case-insensitively and keeps target notes unless empty', () => {
    const out = mergeAnnotationData(
      { nickname: 'Mem', aliases: ['Old'], notes: '', tags: ['core'] },
      { nickname: 'Pro', aliases: ['pro.1'], notes: 'trial notes', tags: ['Core', 'trial'] }
    )
    expect(out.tags).toEqual(['core', 'trial'])
    expect(out.aliases).toEqual(['Old', 'Pro', 'pro.1'])
    expect(out.notes).toBe('trial notes') // target empty → take source
  })
})

describe('rekeyVotes', () => {
  it('moves a subject key, leaving others', () => {
    expect(rekeyVotes({ a: 'yes', b: 'no' }, 'a', 'z')).toEqual({ z: 'yes', b: 'no' })
    expect(rekeyVotes({ b: 'no' }, 'a', 'z')).toEqual({ b: 'no' }) // absent → unchanged
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/lib/pipeline.test.ts`
Expected: FAIL — cannot find module `./pipeline`.

- [ ] **Step 3: Write the implementation**

```ts
// src/renderer/src/lib/pipeline.ts
//
// Pure recruitment-pipeline logic. No React/DOM imports so it is node-testable.
// State is persisted in annotation rows (meta:pipeline, prospect:*, vote:*) by the
// main process; this module only parses/derives.

export type StageType = 'active' | 'accepted' | 'declined'
export interface PipelineStage { id: string; label: string; color: string; type: StageType }
export type VoteValue = 'yes' | 'no' | 'abstain'

export const DEFAULT_STAGES: PipelineStage[] = [
  { id: 'applied', label: 'Applied', color: 'slate', type: 'active' },
  { id: 'trialing', label: 'Trialing', color: 'blue', type: 'active' },
  { id: 'review', label: 'Review / Vote', color: 'amber', type: 'active' },
  { id: 'accepted', label: 'Accepted', color: 'emerald', type: 'accepted' },
  { id: 'passed', label: 'Passed', color: 'rose', type: 'declined' }
]

export interface PipelineDoc { stages: PipelineStage[]; placement: Record<string, string> }

function sanitizeStages(arr: unknown): PipelineStage[] {
  if (!Array.isArray(arr)) return DEFAULT_STAGES
  const out: PipelineStage[] = []
  for (const s of arr as Array<Record<string, unknown>>) {
    const id = String(s?.id || '').trim()
    if (!id) continue
    const t = s?.type
    const type: StageType = t === 'accepted' || t === 'declined' ? t : 'active'
    out.push({ id, label: String(s?.label || id), color: String(s?.color || 'slate'), type })
  }
  return out.length ? out : DEFAULT_STAGES
}

export function parsePipelineDoc(notes: string): PipelineDoc {
  if (!notes || !notes.trim()) return { stages: DEFAULT_STAGES, placement: {} }
  try {
    const raw = JSON.parse(notes) as { stages?: unknown; placement?: unknown }
    const stages = sanitizeStages(raw?.stages)
    const placement =
      raw?.placement && typeof raw.placement === 'object' && !Array.isArray(raw.placement)
        ? (raw.placement as Record<string, string>)
        : {}
    return { stages, placement }
  } catch {
    return { stages: DEFAULT_STAGES, placement: {} }
  }
}

export function parseVoteRow(notes: string): Record<string, VoteValue> {
  if (!notes || !notes.trim()) return {}
  try {
    const raw = JSON.parse(notes)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, VoteValue> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === 'yes' || v === 'no' || v === 'abstain') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

export function tallyVotes(rows: Record<string, VoteValue>[], subjectKey: string): { yes: number; no: number; abstain: number } {
  const t = { yes: 0, no: 0, abstain: 0 }
  for (const r of rows) {
    const v = r[subjectKey]
    if (v) t[v]++
  }
  return t
}

export interface PipelineSubject { key: string; name: string; accountName: string | null; isProspect: boolean; tags: string[] }

export function groupBoard(
  subjects: PipelineSubject[],
  placement: Record<string, string>,
  stages: PipelineStage[]
): Record<string, PipelineSubject[]> {
  const firstActive = stages.find((s) => s.type === 'active')?.id ?? stages[0]?.id ?? ''
  const valid = new Set(stages.map((s) => s.id))
  const board: Record<string, PipelineSubject[]> = {}
  for (const s of stages) board[s.id] = []
  for (const subj of subjects) {
    const placed = placement[subj.key]
    if (placed === undefined) continue
    const stageId = valid.has(placed) ? placed : firstActive
    if (board[stageId]) board[stageId].push(subj)
  }
  return board
}

export function mergeAnnotationData(
  target: { nickname: string; aliases: string[]; notes: string; tags: string[] },
  source: { nickname: string; aliases: string[]; notes: string; tags: string[] }
): { aliases: string[]; notes: string; tags: string[] } {
  const lc = (a: string): string => a.toLowerCase()
  const tagSeen = new Set(target.tags.map(lc))
  const tags = [...target.tags]
  for (const t of source.tags) if (t && !tagSeen.has(lc(t))) { tagSeen.add(lc(t)); tags.push(t) }
  const aliasSeen = new Set([...target.aliases.map(lc), lc(target.nickname)])
  const aliases = [...target.aliases]
  for (const a of [source.nickname, ...source.aliases]) if (a && !aliasSeen.has(lc(a))) { aliasSeen.add(lc(a)); aliases.push(a) }
  const notes = target.notes && target.notes.trim() ? target.notes : source.notes
  return { aliases, notes, tags }
}

export function rekeyVotes(row: Record<string, VoteValue>, fromKey: string, toKey: string): Record<string, VoteValue> {
  if (!(fromKey in row)) return row
  const next = { ...row }
  next[toKey] = next[fromKey]
  delete next[fromKey]
  return next
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/lib/pipeline.test.ts`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/pipeline.ts src/renderer/src/lib/pipeline.test.ts
git commit -m "feat(pipeline): pure stage/vote/board logic"
```

---

### Task 2: Backend IPC + reserved-key guard + auth identity

**Files:**
- Modify: `src/main/rosterReconcile.ts` (extend `isReservedAnnotationKey`)
- Test: `src/main/pipelineReserved.test.ts`
- Modify: `src/main/index.ts` (IPC handlers; `auth:status` adds `userId`)
- Modify: `src/preload/index.ts` + `src/preload/index.d.ts` (expose pipeline API; `AuthStatus.userId`)

**Interfaces:** Produces (renderer `window.axiroster`):
- `pipelineGet(): Promise<{ stages; placement; prospects; votes }>` where `prospects: RosterAnnotation[]`, `votes: { voterId: string; row: Record<string,'yes'|'no'|'abstain'> }[]`, `stages: PipelineStage[]`, `placement: Record<string,string>`.
- `pipelineSetPlacement(subjectKey: string, stageId: string): Promise<void>`
- `pipelineSetStages(stages: PipelineStage[]): Promise<void>`
- `pipelineAddProspect(input: { name: string; handle?: string }): Promise<RosterAnnotation>`
- `pipelineRemoveProspect(key: string): Promise<void>`
- `pipelineVote(subjectKey: string, value: 'yes'|'no'|'abstain'|'clear'): Promise<void>`
- `pipelineLinkProspect(prospectKey: string, memberKey: string): Promise<void>`
- `pipelineArchivePassed(): Promise<void>`
- `AuthStatus` gains `userId?: string`.

- [ ] **Step 1: Write the failing test (reserved-key guard)**

```ts
// src/main/pipelineReserved.test.ts
import { describe, it, expect } from 'vitest'
import { isReservedAnnotationKey } from './rosterReconcile'

describe('isReservedAnnotationKey — pipeline keys', () => {
  it('reserves meta:/prospect:/vote:', () => {
    expect(isReservedAnnotationKey('meta:pipeline')).toBe(true)
    expect(isReservedAnnotationKey('prospect:abc-123')).toBe(true)
    expect(isReservedAnnotationKey('vote:user-9')).toBe(true)
  })
  it('does not reserve real member/account keys', () => {
    expect(isReservedAnnotationKey('201537071804973056')).toBe(false)
    expect(isReservedAnnotationKey('acct:Eternal.1234')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/pipelineReserved.test.ts`
Expected: FAIL — `prospect:`/`vote:` not yet reserved.

- [ ] **Step 3: Extend the guard**

In `src/main/rosterReconcile.ts`, replace the `isReservedAnnotationKey` line:
```ts
export const isReservedAnnotationKey = (key: string): boolean =>
  key.startsWith('meta:') || key.startsWith('prospect:') || key.startsWith('vote:')
```

- [ ] **Step 4: Run the guard test (green) + add `userId` to auth:status**

Run: `npx vitest run src/main/pipelineReserved.test.ts` → PASS.

In `src/main/index.ts` `auth:status` handler, return the session user id so the UI can highlight the caller's own vote:
```ts
    return { signedIn: true, role: ws?.role, workspaceId: ws?.workspaceId, userId: session.user?.id ?? null }
```
Add `userId?: string` to `AuthStatus` in `src/preload/index.d.ts`.

- [ ] **Step 5: Add the pipeline IPC handlers**

In `src/main/index.ts`, after the `roster:tags:*` handlers (~line 945), add this block. It uses the existing `roster` (RosterStore), `sync`, and the auth session. Helpers read/write the reserved rows through `roster.upsert`/`roster.get`/`roster.list`/`roster.remove` and push via `sync`.

```ts
  // ---- Recruitment pipeline (stored in reserved annotation rows) ----
  const PIPELINE_KEY = 'meta:pipeline'
  const pipelineParse = (notes: string): { stages: unknown; placement: Record<string, string> } => {
    try {
      const r = JSON.parse(notes || '{}')
      return { stages: r?.stages, placement: r?.placement && typeof r.placement === 'object' ? r.placement : {} }
    } catch {
      return { stages: undefined, placement: {} }
    }
  }
  const pushRow = async (key: string): Promise<void> => {
    const rec = roster.get(key)
    if (rec) await sync.pushAnnotation(rec).catch(() => {})
  }
  const writePipeline = async (doc: { stages?: unknown; placement: Record<string, string> }): Promise<void> => {
    roster.upsert(PIPELINE_KEY, { notes: JSON.stringify(doc) })
    await pushRow(PIPELINE_KEY)
  }
  const readPipelineDoc = (): { stages?: unknown; placement: Record<string, string> } => {
    const rec = roster.get(PIPELINE_KEY)
    return rec ? pipelineParse(rec.notes) : { stages: undefined, placement: {} }
  }
  /** The caller's stable vote-row key, derived server-side from the session. */
  const currentVoterKey = async (): Promise<string | null> => {
    const auth = getOrCreateDiscordAuth()
    const session = auth ? await auth.restoreSession().catch(() => null) : null
    const id = session?.user?.id
    return id ? `vote:${id}` : null
  }

  ipcMain.handle('pipeline:get', () => {
    const doc = readPipelineDoc()
    const all = roster.list()
    const prospects = all.filter((a) => a.memberId.startsWith('prospect:'))
    const votes = all
      .filter((a) => a.memberId.startsWith('vote:'))
      .map((a) => {
        try {
          const row = JSON.parse(a.notes || '{}')
          return { voterId: a.memberId.slice('vote:'.length), row: row && typeof row === 'object' ? row : {} }
        } catch {
          return { voterId: a.memberId.slice('vote:'.length), row: {} }
        }
      })
    return { stages: doc.stages, placement: doc.placement, prospects, votes }
  })

  ipcMain.handle('pipeline:setPlacement', async (_e, subjectKey: string, stageId: string) => {
    const doc = readPipelineDoc()
    doc.placement[subjectKey] = stageId
    await writePipeline(doc)
  })

  ipcMain.handle('pipeline:setStages', async (_e, stages: unknown) => {
    const doc = readPipelineDoc()
    await writePipeline({ stages, placement: doc.placement })
  })

  ipcMain.handle('pipeline:addProspect', async (_e, input: { name: string; handle?: string }) => {
    const id = `prospect:${randomUUID()}`
    const aliases = input?.handle ? [String(input.handle)] : []
    roster.upsert(id, { nickname: String(input?.name || 'Prospect'), aliases })
    // place in the first stage of the current doc (or 'applied')
    const doc = readPipelineDoc()
    const stagesArr = Array.isArray(doc.stages) ? (doc.stages as Array<{ id?: string }>) : []
    const firstStage = String(stagesArr[0]?.id || 'applied')
    doc.placement[id] = firstStage
    await writePipeline(doc)
    await pushRow(id)
    return roster.get(id)
  })

  ipcMain.handle('pipeline:removeProspect', async (_e, key: string) => {
    roster.remove(key)
    await sync.removeAnnotation(key).catch(() => {})
    const doc = readPipelineDoc()
    delete doc.placement[key]
    await writePipeline(doc)
    // purge from every vote row
    for (const a of roster.list().filter((x) => x.memberId.startsWith('vote:'))) {
      try {
        const row = JSON.parse(a.notes || '{}')
        if (row && typeof row === 'object' && key in row) {
          delete row[key]
          roster.upsert(a.memberId, { notes: JSON.stringify(row) })
          await pushRow(a.memberId)
        }
      } catch { /* ignore corrupt row */ }
    }
  })

  ipcMain.handle('pipeline:vote', async (_e, subjectKey: string, value: 'yes' | 'no' | 'abstain' | 'clear') => {
    const voterKey = await currentVoterKey()
    if (!voterKey) return
    const rec = roster.get(voterKey)
    let row: Record<string, string> = {}
    try { row = rec ? JSON.parse(rec.notes || '{}') : {} } catch { row = {} }
    if (value === 'clear') delete row[subjectKey]
    else row[subjectKey] = value
    roster.upsert(voterKey, { notes: JSON.stringify(row) })
    await pushRow(voterKey)
  })

  ipcMain.handle('pipeline:linkProspect', async (_e, prospectKey: string, memberKey: string) => {
    const prospect = roster.get(prospectKey)
    if (!prospect) return
    const member = roster.get(memberKey) ?? { nickname: '', aliases: [], notes: '', tags: [] }
    // union tags+aliases, keep member notes unless empty (mirror lib/pipeline.mergeAnnotationData)
    const lc = (s: string): string => s.toLowerCase()
    const tagSeen = new Set(member.tags.map(lc))
    const tags = [...member.tags]
    for (const t of prospect.tags) if (t && !tagSeen.has(lc(t))) { tagSeen.add(lc(t)); tags.push(t) }
    const aliasSeen = new Set([...member.aliases.map(lc), lc(member.nickname)])
    const aliases = [...member.aliases]
    for (const a of [prospect.nickname, ...prospect.aliases]) if (a && !aliasSeen.has(lc(a))) { aliasSeen.add(lc(a)); aliases.push(a) }
    const notes = member.notes && member.notes.trim() ? member.notes : prospect.notes
    roster.upsert(memberKey, { aliases, notes, tags })
    await pushRow(memberKey)
    // move placement
    const doc = readPipelineDoc()
    if (doc.placement[prospectKey] !== undefined) {
      doc.placement[memberKey] = doc.placement[prospectKey]
      delete doc.placement[prospectKey]
    }
    await writePipeline(doc)
    // re-key votes
    for (const a of roster.list().filter((x) => x.memberId.startsWith('vote:'))) {
      try {
        const r = JSON.parse(a.notes || '{}')
        if (r && typeof r === 'object' && prospectKey in r) {
          r[memberKey] = r[prospectKey]
          delete r[prospectKey]
          roster.upsert(a.memberId, { notes: JSON.stringify(r) })
          await pushRow(a.memberId)
        }
      } catch { /* ignore */ }
    }
    // remove the prospect row
    roster.remove(prospectKey)
    await sync.removeAnnotation(prospectKey).catch(() => {})
  })

  ipcMain.handle('pipeline:archivePassed', async () => {
    const doc = readPipelineDoc()
    const stagesArr = Array.isArray(doc.stages) ? (doc.stages as Array<{ id?: string; type?: string }>) : []
    const declined = new Set(stagesArr.filter((s) => s?.type === 'declined').map((s) => String(s?.id)))
    const removed: string[] = []
    for (const [subj, stage] of Object.entries(doc.placement)) {
      if (declined.has(stage)) { delete doc.placement[subj]; removed.push(subj) }
    }
    await writePipeline(doc)
    for (const a of roster.list().filter((x) => x.memberId.startsWith('vote:'))) {
      try {
        const r = JSON.parse(a.notes || '{}')
        let changed = false
        for (const subj of removed) if (subj in r) { delete r[subj]; changed = true }
        if (changed) { roster.upsert(a.memberId, { notes: JSON.stringify(r) }); await pushRow(a.memberId) }
      } catch { /* ignore */ }
    }
  })
```
Ensure `randomUUID` is imported at the top of `index.ts`: `import { randomUUID } from 'node:crypto'` (add if absent). Confirm `getOrCreateDiscordAuth` and `roster`/`sync` are in this scope (they are — used by the nearby auth + annotation handlers).

Note: `meta:pipeline`, `prospect:*`, `vote:*` rows are non-empty (JSON) so `RosterStore.isEmpty` never prunes them; they're excluded from members by the extended guard.

- [ ] **Step 6: Expose in preload**

In `src/preload/index.ts` (Roster group), add:
```ts
  pipelineGet: () => ipcRenderer.invoke('pipeline:get'),
  pipelineSetPlacement: (subjectKey: string, stageId: string) => ipcRenderer.invoke('pipeline:setPlacement', subjectKey, stageId),
  pipelineSetStages: (stages: unknown) => ipcRenderer.invoke('pipeline:setStages', stages),
  pipelineAddProspect: (input: { name: string; handle?: string }) => ipcRenderer.invoke('pipeline:addProspect', input),
  pipelineRemoveProspect: (key: string) => ipcRenderer.invoke('pipeline:removeProspect', key),
  pipelineVote: (subjectKey: string, value: string) => ipcRenderer.invoke('pipeline:vote', subjectKey, value),
  pipelineLinkProspect: (prospectKey: string, memberKey: string) => ipcRenderer.invoke('pipeline:linkProspect', prospectKey, memberKey),
  pipelineArchivePassed: () => ipcRenderer.invoke('pipeline:archivePassed'),
```
In `src/preload/index.d.ts` `AxiRosterApi`, declare them (use `PipelineStage` imported from the renderer lib is not available in preload; type `stages` as `unknown[]` / a local minimal shape, and `prospects` as `RosterAnnotation[]`):
```ts
  pipelineGet(): Promise<{ stages: unknown; placement: Record<string,string>; prospects: RosterAnnotation[]; votes: { voterId: string; row: Record<string,'yes'|'no'|'abstain'> }[] }>
  pipelineSetPlacement(subjectKey: string, stageId: string): Promise<void>
  pipelineSetStages(stages: unknown): Promise<void>
  pipelineAddProspect(input: { name: string; handle?: string }): Promise<RosterAnnotation>
  pipelineRemoveProspect(key: string): Promise<void>
  pipelineVote(subjectKey: string, value: 'yes'|'no'|'abstain'|'clear'): Promise<void>
  pipelineLinkProspect(prospectKey: string, memberKey: string): Promise<void>
  pipelineArchivePassed(): Promise<void>
```

- [ ] **Step 7: Typecheck + full suite + commit**

Run: `npm run typecheck` → clean. `npm test` → all pass (incl. `pipelineReserved.test.ts`).
```bash
git add src/main/rosterReconcile.ts src/main/pipelineReserved.test.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(pipeline): reserved-row IPC (placement/prospects/votes/link/archive) + userId in auth"
```

---

### Task 3: Per-guild `pipelineEnabled` toggle

**Files:**
- Modify: `src/main/guildStore.ts` (`GuildProfile` + `GuildSummary` + normalize default true + summary mapping)
- Modify: `src/preload/index.d.ts` (mirror)
- Modify: `src/main/index.ts` (any `GuildProfileInput` construction sites — default true)
- Modify: `src/renderer/src/components/GuildSettings.tsx` (toggle)

This mirrors the `retentionEnabled` work exactly, EXCEPT the default is **true**.

- [ ] **Step 1: Add the field (default true)**

In `src/main/guildStore.ts`, add to `GuildProfile` and `GuildSummary`:
```ts
  /** Enables the Recruitment pipeline tab for this guild (default true). */
  pipelineEnabled: boolean
```
In the normalize function, default it true when absent: `pipelineEnabled: p.pipelineEnabled !== false` (so existing guilds default to on). Include `pipelineEnabled: profile.pipelineEnabled` where `GuildSummary` is built. Find every `GuildProfileInput` construction (incl. the workspace-sync site that `retentionEnabled` also needed, around index.ts ~668) and add `pipelineEnabled: existing?.pipelineEnabled !== false`.

- [ ] **Step 2: Mirror in preload + add the toggle UI**

In `src/preload/index.d.ts`, add `pipelineEnabled: boolean` to `GuildProfile` and `GuildSummary`.

In `src/renderer/src/components/GuildSettings.tsx`, add a checkbox mirroring the retention toggle (per-field `useState` + `buildInput()` include + `editSignature`), defaulting from the loaded summary:
```tsx
        <label className="flex items-center gap-2 text-sm text-ink-dim">
          <input type="checkbox" checked={pipelineEnabled} onChange={(e) => { markEdited(); setPipelineEnabled(e.target.checked) }} disabled={!canEditConfig} className="accent-accent" />
          Enable Recruitment pipeline
        </label>
```
Wire `pipelineEnabled` into the same state/`buildInput()`/`editSignature` the retention toggle uses (read the file's actual names; `retentionEnabled` is the template).

- [ ] **Step 3: Typecheck + build + commit**

Run: `npm run typecheck` → clean. `npm run build` → succeeds. `npm test` → green.
```bash
git add src/main/guildStore.ts src/preload/index.d.ts src/main/index.ts src/renderer/src/components/GuildSettings.tsx
git commit -m "feat(pipeline): per-guild pipelineEnabled toggle (default on)"
```

---

### Task 4: `RecruitmentView` board (columns, cards, drag, nav tab)

**Files:**
- Create: `src/renderer/src/components/RecruitmentView.tsx`
- Modify: `src/renderer/src/App.tsx` (gated `recruitment` tab, after Retention)

**Interfaces:** Consumes `pipeline.ts` (Task 1), the `pipeline*` API + `authStatus.userId` (Task 2), `tagRegistry` (`resolveColorId`/`tagStyle`/`dotColor`), `aggregateMemberMetrics`/`deriveRow`-style metrics for attendance, `toast`. This task ships the read board + drag-to-restage + add-prospect entry point; votes/link/stage-settings come in Task 5.

- [ ] **Step 1: Add the gated nav tab in `App.tsx`**

Mirror the Retention tab wiring: add `{ id: 'recruitment', label: 'Recruitment', icon: <Users2 size={15} /> }` to `TABS` right after the `retention` entry; extend the `Tab` union with `'recruitment'`; import `Users2` from lucide-react and `RecruitmentView`. Extend the visible-tab filter so it shows only when `selected?.pipelineEnabled`:
```tsx
TABS.filter((t) =>
  (t.id !== 'retention' || selected?.retentionEnabled) &&
  (t.id !== 'recruitment' || selected?.pipelineEnabled)
).map(...)
```
In the content switch, add (with a fallback to roster if the toggle is off but tab is stale):
```tsx
          ) : tab === 'recruitment' && selected?.pipelineEnabled ? (
            <RecruitmentView />
          ) : tab === 'recruitment' ? (
            <RosterView resetToken={rosterReset} />
```

- [ ] **Step 2: Create the board component**

```tsx
// src/renderer/src/components/RecruitmentView.tsx
//
// Recruitment kanban. Subjects = reconciled members + prospect:* rows, placed into
// stage columns via the shared meta:pipeline doc. Drag a card to restage. Votes,
// linking, and stage settings live alongside (added in the actions pass). Pipeline
// state is read via window.axiroster.pipeline* and is workspace-synced.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Users2, RefreshCw, Plus } from 'lucide-react'
import type { BridgePlayerMetrics, ReconciledMember, RosterPayload, RosterAnnotation } from '../../../preload/index.d'
import {
  DEFAULT_STAGES, parsePipelineDoc, parseVoteRow, groupBoard,
  type PipelineStage, type PipelineSubject, type VoteValue
} from '../lib/pipeline'
import { aggregateMemberMetrics } from '../lib/metrics'
import { resolveColorId, tagStyle, dotColor } from '../lib/tagRegistry'
import { toast } from '../lib/toast'

const STAGE_DOT: Record<string, string> = { slate: '#94a3b8', blue: '#3b82f6', amber: '#f59e0b', emerald: '#10b981', rose: '#f43f5e' }

export default function RecruitmentView(): JSX.Element {
  const [payload, setPayload] = useState<RosterPayload | null>(null)
  const [stages, setStages] = useState<PipelineStage[]>(DEFAULT_STAGES)
  const [placement, setPlacement] = useState<Record<string, string>>({})
  const [prospects, setProspects] = useState<RosterAnnotation[]>([])
  const [voteRows, setVoteRows] = useState<Record<string, VoteValue>[]>([])
  const [myVote, setMyVote] = useState<Record<string, VoteValue>>({})
  const [myVoterId, setMyVoterId] = useState<string | null>(null)
  const [canEdit, setCanEdit] = useState(true)
  const [loading, setLoading] = useState(false)
  const [dragKey, setDragKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [roster, pipe, auth] = await Promise.all([
      window.axiroster.buildRoster(),
      window.axiroster.pipelineGet(),
      window.axiroster.authStatus()
    ])
    if (roster.ok) setPayload(roster.data)
    setCanEdit(auth.role !== 'read')
    setMyVoterId(auth.userId ?? null)
    // pipe.stages may be undefined → defaults; reuse the pure parser by round-tripping
    const doc = parsePipelineDoc(JSON.stringify({ stages: pipe.stages, placement: pipe.placement }))
    setStages(doc.stages)
    setPlacement(doc.placement)
    setProspects(pipe.prospects)
    setVoteRows(pipe.votes.map((v) => parseVoteRow(JSON.stringify(v.row))))
    const mine = pipe.votes.find((v) => v.voterId === (auth.userId ?? ''))
    setMyVote(mine ? parseVoteRow(JSON.stringify(mine.row)) : {})
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const members: ReconciledMember[] = useMemo(() => payload?.members ?? [], [payload])
  const metrics: Record<string, BridgePlayerMetrics> = payload?.metrics ?? {}

  const subjects: PipelineSubject[] = useMemo(() => {
    const memberSubs: PipelineSubject[] = members.map((m) => ({
      key: m.annotationKey, name: m.label,
      accountName: m.accounts[0]?.account_name ?? null, isProspect: false, tags: m.tags
    }))
    const prospectSubs: PipelineSubject[] = prospects.map((p) => ({
      key: p.memberId, name: p.nickname || 'Prospect',
      accountName: p.aliases[0] ?? null, isProspect: true, tags: p.tags
    }))
    return [...memberSubs, ...prospectSubs]
  }, [members, prospects])

  const board = useMemo(() => groupBoard(subjects, placement, stages), [subjects, placement, stages])

  const restage = async (subjectKey: string, stageId: string): Promise<void> => {
    setPlacement((p) => ({ ...p, [subjectKey]: stageId })) // optimistic
    await window.axiroster.pipelineSetPlacement(subjectKey, stageId)
  }

  const addProspect = async (): Promise<void> => {
    const name = window.prompt('Prospect name (Discord handle or IGN):')?.trim()
    if (!name) return
    await window.axiroster.pipelineAddProspect({ name })
    toast('Prospect added')
    await load()
  }

  const attendanceOf = (m: PipelineSubject): string | null => {
    if (m.isProspect) return null
    const member = members.find((x) => x.annotationKey === m.key)
    if (!member) return null
    const agg = aggregateMemberMetrics(member.accounts, metrics)
    if (!agg || agg.raidsConsidered === 0) return null
    return `${Math.round((agg.raidsAttended / agg.raidsConsidered) * 100)}% · ${agg.raidsAttended} raids`
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-panel-line bg-panel-sunk px-4 py-2.5">
        <Users2 size={15} className="text-accent-soft" />
        <span className="text-sm font-semibold text-ink">Recruitment</span>
        <span className="text-xs text-ink-faint">· {Object.keys(placement).length} in pipeline</span>
        {canEdit && (
          <button onClick={addProspect} className="btn ml-auto px-2 py-1 text-xs"><Plus size={13} /> Add prospect</button>
        )}
        <button onClick={load} className={`btn px-2 ${canEdit ? '' : 'ml-auto'}`} title="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto p-4">
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(190px, 1fr))` }}>
          {stages.map((stage) => (
            <div
              key={stage.id}
              onDragOver={(e) => { if (canEdit && dragKey) e.preventDefault() }}
              onDrop={() => { if (canEdit && dragKey) { restage(dragKey, stage.id); setDragKey(null) } }}
              className="rounded-xl border border-panel-line bg-panel-sunk p-2"
            >
              <div className="flex items-center gap-1.5 px-1.5 pb-2 pt-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: STAGE_DOT[stage.color] ?? '#94a3b8' }} />
                <span className="text-xs font-semibold">{stage.label}</span>
                <span className="ml-auto rounded-full bg-panel-raised px-1.5 font-mono text-[10px] text-ink-faint">{board[stage.id]?.length ?? 0}</span>
              </div>
              {(board[stage.id] ?? []).map((subj) => (
                <div
                  key={subj.key}
                  draggable={canEdit}
                  onDragStart={() => setDragKey(subj.key)}
                  onDragEnd={() => setDragKey(null)}
                  className="mb-2 cursor-grab rounded-lg border border-panel-line bg-panel-raised p-2.5 hover:border-panel-line2"
                >
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-ink">{subj.name}</div>
                      <div className="truncate text-[10.5px] text-ink-faint">{subj.accountName ?? 'Discord only'}</div>
                    </div>
                    {subj.isProspect && <span className="rounded border border-amber-500/30 px-1 text-[9px] uppercase tracking-wide text-amber-300">prospect</span>}
                  </div>
                  {subj.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {subj.tags.map((t) => {
                        const id = resolveColorId(t, payload?.attendance ? {} : {})
                        return (
                          <span key={t} className="inline-flex items-center gap-1 rounded px-1.5 text-[10px]" style={tagStyle(id)}>
                            <span className="h-1 w-1 rounded-full" style={{ background: dotColor(id) }} />{t}
                          </span>
                        )
                      })}
                    </div>
                  )}
                  {attendanceOf(subj) && <div className="mt-1.5 text-[10.5px] text-ink-faint">⚔ {attendanceOf(subj)}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```
Note: this task wires the **tag registry** for pill colors — replace the placeholder `resolveColorId(t, {})` by loading the registry like `RetentionView`/`MemberDetail` do (`getTagRegistry()` → `parseRegistry`), and pass it to `resolveColorId(t, registry)`. Include the `registry` state + load in this task so pills are correctly colored. (The snippet above shows the structure; use the real registry, not `{}`.)

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck` → clean (resolve unused imports; wire the real registry). `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/RecruitmentView.tsx src/renderer/src/App.tsx
git commit -m "feat(pipeline): Recruitment kanban board with drag-to-restage"
```

---

### Task 5: Board actions — voting, link-to-member, stage settings, archive

**Files:**
- Modify: `src/renderer/src/components/RecruitmentView.tsx`

Builds on Task 4's board. Adds, for cards in an `active` stage whose `type` review-like (we show votes on ALL active stages so it works with custom stages, but emphasize the one flagged in UI), the vote bar + buttons; plus header actions.

- [ ] **Step 1: Vote bar + buttons on cards**

Add a helper and render block. Tally uses the pure `tallyVotes`; "my vote" highlights from `myVote`. Show voting only when `canEdit && myVoterId` (shared workspace + identity) and the subject is in a stage of `type==='active'` that is not the first (i.e., review-ish) — simplest: show on any stage flagged for review. For v1, show the vote UI on every `active` stage card; it's harmless and works with custom stage sets.

```tsx
  const vote = async (subjectKey: string, value: VoteValue): Promise<void> => {
    const next = myVote[subjectKey] === value ? 'clear' : value
    setMyVote((m) => { const c = { ...m }; if (next === 'clear') delete c[subjectKey]; else c[subjectKey] = value; return c })
    await window.axiroster.pipelineVote(subjectKey, next)
    await load()
  }
```
Inside the card, after the attendance line, add (import `tallyVotes` from `../lib/pipeline`):
```tsx
                  {canEdit && myVoterId && (() => {
                    const t = tallyVotes(voteRows, subj.key)
                    const total = t.yes + t.no || 1
                    const mine = myVote[subj.key]
                    return (
                      <div className="mt-2 border-t border-panel-line pt-2">
                        <div className="flex h-1.5 overflow-hidden rounded-full bg-panel-line2">
                          <div style={{ width: `${(t.yes / total) * 100}%`, background: '#10b981' }} />
                          <div style={{ width: `${(t.no / total) * 100}%`, background: '#f43f5e' }} />
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                          <span className="font-semibold text-emerald-300">✓ {t.yes}</span>
                          <span className="font-semibold text-rose-300">✕ {t.no}</span>
                          <span className="text-ink-faint">– {t.abstain}</span>
                          <span className="ml-auto flex gap-1" onDragStart={(e) => e.preventDefault()}>
                            <button onClick={() => vote(subj.key, 'yes')} className={`h-5 w-5 rounded border text-[11px] ${mine === 'yes' ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300' : 'border-panel-line2 text-ink-faint'}`}>✓</button>
                            <button onClick={() => vote(subj.key, 'no')} className={`h-5 w-5 rounded border text-[11px] ${mine === 'no' ? 'border-rose-500/50 bg-rose-500/20 text-rose-300' : 'border-panel-line2 text-ink-faint'}`}>✕</button>
                            <button onClick={() => vote(subj.key, 'abstain')} className={`h-5 w-5 rounded border text-[11px] ${mine === 'abstain' ? 'border-panel-line2 bg-panel-hover text-ink' : 'border-panel-line2 text-ink-faint'}`}>–</button>
                          </span>
                        </div>
                      </div>
                    )
                  })()}
```
Show the vote block only for cards whose stage `type === 'active'` and is not the first active stage (the "review-ish" ones). Compute `const reviewStageIds = new Set(stages.filter((s,i)=>s.type==='active' && i>0).map(s=>s.id))` and gate the block with `placement[subj.key] && reviewStageIds.has(placement[subj.key]) && ...`.

- [ ] **Step 2: Link-to-member for prospects**

Add a small "Link" affordance on prospect cards that opens a member search (reuse the existing typeahead pattern from `MemberDetail`'s `LinkToMemberPicker`, or a minimal inline `<select>` of current members). On choose:
```tsx
  const linkProspect = async (prospectKey: string, memberKey: string): Promise<void> => {
    await window.axiroster.pipelineLinkProspect(prospectKey, memberKey)
    toast('Prospect linked to member')
    await load()
  }
```
Minimal UI: on a prospect card, a "Link" button toggles an inline `<select>` listing `members` (label + account); selecting calls `linkProspect(subj.key, member.annotationKey)`.

- [ ] **Step 3: Header actions — stage settings + archive passed**

Add to the header: an "Archive passed" button → `await window.axiroster.pipelineArchivePassed(); toast('Archived'); load()`. And a stage-settings popover (gear) that lets the user rename existing stage labels and reorder; on save → `await window.axiroster.pipelineSetStages(nextStages); load()`. Keep it minimal: an editable list of `{label}` per stage (ids/types fixed for v1 edit — renaming labels + reordering only; do not allow deleting the last accepted/declined stage). Save the full `stages` array (preserving `id`/`type`/`color`, updating `label` and order).

```tsx
  const archivePassed = async (): Promise<void> => {
    await window.axiroster.pipelineArchivePassed()
    toast('Archived passed recruits')
    await load()
  }
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck` → clean. `npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/RecruitmentView.tsx
git commit -m "feat(pipeline): voting, prospect linking, stage settings, archive"
```

---

### Task 6: Verification sweep + manual smoke

- [ ] **Step 1: Full suite** — Run: `npm test` → all pass (incl. `pipeline.test.ts`, `pipelineReserved.test.ts`).
- [ ] **Step 2: Typecheck + build** — Run: `npm run typecheck && npm run build` → clean / succeeds.
- [ ] **Step 3: Manual smoke (needs running app + a guild with `pipelineEnabled`):**
  1. Toggle off in Settings → no Recruitment tab; on → tab appears after Retention.
  2. Add a prospect → appears in the first column with a "prospect" badge.
  3. Drag cards between columns → placement persists across refresh.
  4. In a shared workspace signed in: cast yes/no/abstain on a review-stage card → tally updates; your vote highlights; a second officer's vote adds to the tally without clobbering yours.
  5. Link a prospect to a member → prospect card disappears, member carries the tags/notes/votes; the card now shows the real account.
  6. Rename/reorder stages → board reflects it for all officers (synced).
  7. Archive passed → declined-column cards clear.
  8. Read-only member → static board (no drag/vote/add).
- [ ] **Step 4: Commit fixups** — `git add -A && git commit -m "test: recruitment pipeline verification sweep" --allow-empty`

---

## Self-Review Notes

- **Spec coverage:** subjects=members+prospects (Tasks 1/4) ✓; zero-migration storage in meta:pipeline/prospect:/vote: rows (Task 2) ✓; reserved-key guard extended (Task 2) ✓; default+overridable stages with types (Task 1 `DEFAULT_STAGES`/`sanitizeStages`, Task 5 stage settings) ✓; server-attributed votes, no clobber, tally (Task 2 `pipeline:vote`, Task 1 `tallyVotes`, Task 5 UI) ✓; promote/link merge+rekey (Task 2 `pipeline:linkProspect`, Task 1 `mergeAnnotationData`/`rekeyVotes`) ✓; archive passed (Task 2/5) ✓; per-guild toggle default-on (Task 3) ✓; native-drag kanban + nav gating + read-only (Task 4) ✓; pure logic node-tested (Task 1), guard tested (Task 2) ✓.
- **Placeholders:** the Task 4 tag-registry note and Task 5 stage-settings/link UI are described with concrete code + explicit "wire the real registry / reuse LinkToMemberPicker" instructions, not deferred TODOs. The implementer must load the registry (as RetentionView does) rather than the `{}` placeholder shown.
- **Type consistency:** `PipelineStage`/`PipelineSubject`/`VoteValue`/`parsePipelineDoc`/`parseVoteRow`/`tallyVotes`/`groupBoard`/`mergeAnnotationData`/`rekeyVotes` consistent Task 1↔4↔5; the IPC names match preload (Task 2) and their uses (Tasks 4/5); `pipelineEnabled` consistent Task 3↔4; `authStatus.userId` defined Task 2, used Task 4.
- **Cross-task risk:** the main-side `linkProspect`/`archivePassed`/`removeProspect` re-implement the tag/alias union + vote re-key inline (mirroring `lib/pipeline` which is renderer-only and can't be imported into main); the logic is identical and the lib version is unit-tested — flagged so a reviewer checks parity.
- **Manual-only UI:** all `.tsx` gated by typecheck+build+manual (no DOM harness), matching repo convention.
```
