# Web Version — Phase 2c-13: Web Recruitment Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 9 `pipeline*` methods by porting the desktop's reserved-`roster_annotations`-row board to direct Supabase ops, replacing their `notImplemented` stubs.

**Architecture:** New `pipeline.ts` module with raw `roster_annotations` helpers + the 9 functions + wiring in `webClient.ts`. Reserved rows (`meta:pipeline`, `prospect:*`, `vote:*`) are written RAW (full row, no empty-prune).

**Tech Stack:** TypeScript, React renderer, Vitest, `@supabase/supabase-js`. No new deps.

## Global Constraints

- Confined to `src/renderer/src/lib/webClient/` (one new module + tests + edits to `webClient.ts`/`webClient.test.ts`). Do NOT touch `src/main`/`src/shared`/`src/preload`/other-renderer/contract.
- `createWebClient` stays conformant; only the nine `pipeline*` methods change from `ni(...)`.
- `pipelineGet` NEVER throws (catch → empty doc). The mutators no-op on no-workspace/no-supabase. `pipelineAddProspect` ALWAYS returns a `RosterAnnotation` (persists only when a workspace is active).
- Renderer→preload via `../../../../preload/index.d`; reuse `activeWorkspaceId` from `./discordGw2`. Uses `crypto.randomUUID()` (browser + Node 19+).
- Run vitest `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` green.

---

### Task 1: `pipeline.ts` + wiring

**Files:**
- Create: `src/renderer/src/lib/webClient/pipeline.ts`, `.../pipeline.test.ts`
- Modify: `src/renderer/src/lib/webClient/webClient.ts` (+ `webClient.test.ts`)

- [ ] **Step 1: Write the failing test**

`src/renderer/src/lib/webClient/pipeline.test.ts`:
```ts
import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  webPipelineGet,
  webPipelineSetPlacement,
  webPipelineAddProspect,
  webPipelineVote,
  webPipelineRemoveProspect,
  webPipelineLinkProspect
} from './pipeline'
import { createWebSettings } from './settings'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size
    }
  } as Storage
}

// In-memory roster_annotations keyed by member_id, plus a workspace_members row
// for activeWorkspaceId. Supports select/eq/maybeSingle/upsert/delete.
function fakeSb(initial: Record<string, Record<string, unknown>> = {}) {
  const ann = new Map<string, Record<string, unknown>>(Object.entries(initial))
  const upserts: Record<string, unknown>[] = []
  const deletes: string[] = []
  function annBuilder() {
    let mid: string | null = null
    const b: Record<string, unknown> = {}
    Object.assign(b, {
      select: () => b,
      eq: (col: string, val: unknown) => {
        if (col === 'member_id') mid = String(val)
        return b
      },
      upsert: async (row: Record<string, unknown>) => {
        upserts.push(row)
        ann.set(String(row.member_id), row)
        return { error: null }
      },
      delete: () => ({
        eq: (col: string, val: unknown) => {
          if (col === 'member_id') {
            deletes.push(String(val))
            ann.delete(String(val))
          }
          return { eq: async () => ({ error: null }), then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) }
        }
      }),
      maybeSingle: async () => ({ data: mid ? ann.get(mid) ?? null : null }),
      then: (res: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: [...ann.values()], error: null }).then(res)
    })
    return b
  }
  const sb = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) =>
      t === 'workspace_members'
        ? {
            select: () => ({
              eq: () => Promise.resolve({ data: [{ workspace_id: 'w1', role: 'owner' }] })
            })
          }
        : annBuilder()
  } as unknown as SupabaseClient
  return { sb, ann, upserts, deletes }
}

const settings = () => createWebSettings(fakeStorage())

test('pipelineGet parses the doc, prospects, and votes', async () => {
  const { sb } = fakeSb({
    'meta:pipeline': { member_id: 'meta:pipeline', notes: JSON.stringify({ stages: [{ id: 'applied' }], placement: { 'prospect:p1': 'applied' }, placedAt: { 'prospect:p1': '2026-06-20T00:00:00Z' } }) },
    'prospect:p1': { member_id: 'prospect:p1', nickname: 'Newbie', aliases: [], notes: '', tags: [] },
    'vote:u1': { member_id: 'vote:u1', notes: JSON.stringify({ 'prospect:p1': 'yes' }) }
  })
  const r = await webPipelineGet(sb, settings())
  expect(r.placement).toEqual({ 'prospect:p1': 'applied' })
  expect(r.prospects.map((p) => p.memberId)).toEqual(['prospect:p1'])
  expect(r.votes).toEqual([{ voterId: 'u1', row: { 'prospect:p1': 'yes' } }])
})

test('setPlacement writes placement + placedAt to the doc', async () => {
  const { sb, ann } = fakeSb()
  await webPipelineSetPlacement(sb, settings(), 'x', 'applied')
  const doc = JSON.parse(String(ann.get('meta:pipeline')!.notes))
  expect(doc.placement.x).toBe('applied')
  expect(typeof doc.placedAt.x).toBe('string')
})

test('addProspect creates a prospect row, places it, returns the annotation', async () => {
  const { sb, ann } = fakeSb()
  const a = await webPipelineAddProspect(sb, settings(), { name: 'Bob', handle: 'Bob.1' })
  expect(a.memberId.startsWith('prospect:')).toBe(true)
  expect(a.nickname).toBe('Bob')
  expect(a.aliases).toEqual(['Bob.1'])
  expect(ann.has(a.memberId)).toBe(true)
  const doc = JSON.parse(String(ann.get('meta:pipeline')!.notes))
  expect(doc.placement[a.memberId]).toBe('applied')
})

test('vote writes the caller vote row', async () => {
  const { sb, ann } = fakeSb()
  await webPipelineVote(sb, settings(), 'prospect:p1', 'yes')
  expect(JSON.parse(String(ann.get('vote:u1')!.notes))).toEqual({ 'prospect:p1': 'yes' })
  await webPipelineVote(sb, settings(), 'prospect:p1', 'clear')
  expect(JSON.parse(String(ann.get('vote:u1')!.notes))).toEqual({})
})

test('removeProspect deletes the row and purges it from votes', async () => {
  const { sb, ann, deletes } = fakeSb({
    'meta:pipeline': { member_id: 'meta:pipeline', notes: JSON.stringify({ placement: { 'prospect:p1': 'applied' }, placedAt: {} }) },
    'prospect:p1': { member_id: 'prospect:p1', nickname: 'X', aliases: [], notes: '', tags: [] },
    'vote:u1': { member_id: 'vote:u1', notes: JSON.stringify({ 'prospect:p1': 'yes' }) }
  })
  await webPipelineRemoveProspect(sb, settings(), 'prospect:p1')
  expect(deletes).toContain('prospect:p1')
  expect(JSON.parse(String(ann.get('vote:u1')!.notes))).toEqual({})
  const doc = JSON.parse(String(ann.get('meta:pipeline')!.notes))
  expect(doc.placement['prospect:p1']).toBeUndefined()
})

test('linkProspect merges into the member, re-keys votes, deletes the prospect', async () => {
  const { sb, ann, deletes } = fakeSb({
    'meta:pipeline': { member_id: 'meta:pipeline', notes: JSON.stringify({ placement: { 'prospect:p1': 'applied' }, placedAt: { 'prospect:p1': 't' } }) },
    'prospect:p1': { member_id: 'prospect:p1', nickname: 'Alt', aliases: ['Alt.1'], notes: 'n', tags: ['trial'] },
    'acct:Alice.1': { member_id: 'acct:Alice.1', nickname: 'Alice', aliases: [], notes: '', tags: ['core'] },
    'vote:u1': { member_id: 'vote:u1', notes: JSON.stringify({ 'prospect:p1': 'yes' }) }
  })
  await webPipelineLinkProspect(sb, settings(), 'prospect:p1', 'acct:Alice.1')
  expect(deletes).toContain('prospect:p1')
  const member = ann.get('acct:Alice.1')!
  expect(member.tags).toEqual(['core', 'trial'])
  expect(member.aliases).toContain('Alt')
  expect(JSON.parse(String(ann.get('vote:u1')!.notes))).toEqual({ 'acct:Alice.1': 'yes' })
  const doc = JSON.parse(String(ann.get('meta:pipeline')!.notes))
  expect(doc.placement['acct:Alice.1']).toBe('applied')
  expect(doc.placement['prospect:p1']).toBeUndefined()
})
```

- [ ] **Step 2: Run — expect FAIL (missing module)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/pipeline.test.ts`
Expected: FAIL — cannot find `./pipeline`.

- [ ] **Step 3: Implement `pipeline.ts`**

```ts
// src/renderer/src/lib/webClient/pipeline.ts
// Web recruitment pipeline: ports the desktop reserved-row board to direct
// roster_annotations ops. meta:pipeline holds { stages, placement, placedAt };
// prospect:<uuid> rows are prospect annotations; vote:<userId> rows hold a JSON
// { subjectKey: 'yes'|'no'|'abstain' } map. Reserved rows are written RAW (full
// row, no empty-prune) because their notes-JSON payload must persist.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RosterAnnotation } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { activeWorkspaceId } from './discordGw2'

const ANN = 'roster_annotations'
const PIPELINE_KEY = 'meta:pipeline'
const now = (): string => new Date().toISOString()

interface Doc {
  stages?: unknown
  placement: Record<string, string>
  placedAt: Record<string, string>
}
type Vote = 'yes' | 'no' | 'abstain'
interface PipelineResult {
  stages: unknown
  placement: Record<string, string>
  placedAt: Record<string, string>
  prospects: RosterAnnotation[]
  votes: { voterId: string; row: Record<string, Vote> }[]
}

function parseDoc(notes: unknown): Doc {
  try {
    const r = JSON.parse(typeof notes === 'string' && notes ? notes : '{}')
    return {
      stages: r?.stages,
      placement: r?.placement && typeof r.placement === 'object' ? r.placement : {},
      placedAt: r?.placedAt && typeof r.placedAt === 'object' ? r.placedAt : {}
    }
  } catch {
    return { stages: undefined, placement: {}, placedAt: {} }
  }
}

function rowToAnn(r: Record<string, unknown>): RosterAnnotation {
  return {
    memberId: String(r.member_id),
    nickname: typeof r.nickname === 'string' ? r.nickname : '',
    aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [],
    notes: typeof r.notes === 'string' ? r.notes : '',
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    mainAccount: typeof r.main_account === 'string' ? r.main_account : '',
    createdAt: typeof r.created_at === 'string' ? r.created_at : now(),
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : now()
  }
}

async function allRows(sb: SupabaseClient, ws: string): Promise<Record<string, unknown>[]> {
  const { data } = await sb.from(ANN).select('*').eq('workspace_id', ws)
  return (data ?? []) as Record<string, unknown>[]
}

async function getAnn(sb: SupabaseClient, ws: string, memberId: string): Promise<RosterAnnotation | null> {
  const { data } = await sb.from(ANN).select('*').eq('workspace_id', ws).eq('member_id', memberId).maybeSingle()
  return data ? rowToAnn(data as Record<string, unknown>) : null
}

async function upsertAnn(
  sb: SupabaseClient,
  ws: string,
  a: { memberId: string; nickname?: string; aliases?: string[]; notes?: string; tags?: string[]; mainAccount?: string }
): Promise<void> {
  await sb.from(ANN).upsert(
    {
      workspace_id: ws,
      member_id: a.memberId,
      nickname: a.nickname ?? '',
      aliases: a.aliases ?? [],
      notes: a.notes ?? '',
      tags: a.tags ?? [],
      main_account: a.mainAccount ?? '',
      updated_at: now()
    },
    { onConflict: 'workspace_id,member_id' }
  )
}

async function deleteAnn(sb: SupabaseClient, ws: string, memberId: string): Promise<void> {
  await sb.from(ANN).delete().eq('workspace_id', ws).eq('member_id', memberId)
}

async function readDoc(sb: SupabaseClient, ws: string): Promise<Doc> {
  const row = await getAnn(sb, ws, PIPELINE_KEY)
  return parseDoc(row?.notes)
}

async function writeDoc(sb: SupabaseClient, ws: string, doc: Doc): Promise<void> {
  await upsertAnn(sb, ws, { memberId: PIPELINE_KEY, notes: JSON.stringify(doc) })
}

function voteRows(rows: Record<string, unknown>[]): { memberId: string; map: Record<string, string> }[] {
  return rows
    .filter((r) => String(r.member_id).startsWith('vote:'))
    .map((r) => {
      let map: Record<string, string> = {}
      try {
        const j = JSON.parse(typeof r.notes === 'string' ? r.notes : '{}')
        map = j && typeof j === 'object' && !Array.isArray(j) ? j : {}
      } catch {
        map = {}
      }
      return { memberId: String(r.member_id), map }
    })
}

export async function webPipelineGet(sb: SupabaseClient, settings: WebSettings): Promise<PipelineResult> {
  const empty: PipelineResult = { stages: undefined, placement: {}, placedAt: {}, prospects: [], votes: [] }
  try {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) return empty
    const rows = await allRows(sb, ws)
    const doc = parseDoc(rows.find((r) => String(r.member_id) === PIPELINE_KEY)?.notes)
    let backfilled = false
    for (const key of Object.keys(doc.placement)) {
      if (!doc.placedAt[key]) {
        doc.placedAt[key] = now()
        backfilled = true
      }
    }
    if (backfilled) await writeDoc(sb, ws, doc)
    const prospects = rows.filter((r) => String(r.member_id).startsWith('prospect:')).map(rowToAnn)
    const votes = voteRows(rows).map((v) => ({
      voterId: v.memberId.slice('vote:'.length),
      row: v.map as Record<string, Vote>
    }))
    return { stages: doc.stages, placement: doc.placement, placedAt: doc.placedAt, prospects, votes }
  } catch {
    return empty
  }
}

export async function webPipelineSetPlacement(
  sb: SupabaseClient,
  settings: WebSettings,
  subjectKey: string,
  stageId: string
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  const doc = await readDoc(sb, ws)
  doc.placement[subjectKey] = stageId
  doc.placedAt[subjectKey] = now()
  await writeDoc(sb, ws, doc)
}

export async function webPipelinePlaceMany(
  sb: SupabaseClient,
  settings: WebSettings,
  keys: string[],
  stageId: string
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  const doc = await readDoc(sb, ws)
  const at = now()
  for (const key of Array.isArray(keys) ? keys : []) {
    const k = String(key || '').trim()
    if (!k) continue
    doc.placement[k] = stageId
    doc.placedAt[k] = at
  }
  await writeDoc(sb, ws, doc)
}

export async function webPipelineSetStages(
  sb: SupabaseClient,
  settings: WebSettings,
  stages: unknown
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  const doc = await readDoc(sb, ws)
  await writeDoc(sb, ws, { stages, placement: doc.placement, placedAt: doc.placedAt })
}

export async function webPipelineAddProspect(
  sb: SupabaseClient,
  settings: WebSettings,
  input: { name: string; handle?: string }
): Promise<RosterAnnotation> {
  const id = `prospect:${crypto.randomUUID()}`
  const nickname = String(input?.name || 'Prospect')
  const aliases = input?.handle ? [String(input.handle)] : []
  const annotation: RosterAnnotation = {
    memberId: id,
    nickname,
    aliases,
    notes: '',
    tags: [],
    mainAccount: '',
    createdAt: now(),
    updatedAt: now()
  }
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return annotation
  await upsertAnn(sb, ws, { memberId: id, nickname, aliases })
  const doc = await readDoc(sb, ws)
  const stagesArr = Array.isArray(doc.stages) ? (doc.stages as Array<{ id?: string }>) : []
  doc.placement[id] = String(stagesArr[0]?.id || 'applied')
  doc.placedAt[id] = now()
  await writeDoc(sb, ws, doc)
  return annotation
}

export async function webPipelineRemoveProspect(
  sb: SupabaseClient,
  settings: WebSettings,
  key: string
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  await deleteAnn(sb, ws, key)
  const doc = await readDoc(sb, ws)
  delete doc.placement[key]
  delete doc.placedAt[key]
  await writeDoc(sb, ws, doc)
  for (const v of voteRows(await allRows(sb, ws))) {
    if (key in v.map) {
      delete v.map[key]
      await upsertAnn(sb, ws, { memberId: v.memberId, notes: JSON.stringify(v.map) })
    }
  }
}

export async function webPipelineVote(
  sb: SupabaseClient,
  settings: WebSettings,
  subjectKey: string,
  value: 'yes' | 'no' | 'abstain' | 'clear'
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  const {
    data: { user }
  } = await sb.auth.getUser()
  if (!user?.id) return
  const voterKey = `vote:${user.id}`
  const existing = await getAnn(sb, ws, voterKey)
  let map: Record<string, string> = {}
  try {
    map = existing ? JSON.parse(existing.notes || '{}') : {}
  } catch {
    map = {}
  }
  if (value === 'clear') delete map[subjectKey]
  else map[subjectKey] = value
  await upsertAnn(sb, ws, { memberId: voterKey, notes: JSON.stringify(map) })
}

export async function webPipelineLinkProspect(
  sb: SupabaseClient,
  settings: WebSettings,
  prospectKey: string,
  memberKey: string
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  const prospect = await getAnn(sb, ws, prospectKey)
  if (!prospect) return
  const member =
    (await getAnn(sb, ws, memberKey)) ??
    ({ memberId: memberKey, nickname: '', aliases: [], notes: '', tags: [], mainAccount: '', createdAt: now(), updatedAt: now() } as RosterAnnotation)
  const lc = (s: string): string => s.toLowerCase()
  const tagSeen = new Set(member.tags.map(lc))
  const tags = [...member.tags]
  for (const t of prospect.tags) if (t && !tagSeen.has(lc(t))) { tagSeen.add(lc(t)); tags.push(t) }
  const aliasSeen = new Set([...member.aliases.map(lc), lc(member.nickname)])
  const aliases = [...member.aliases]
  for (const a of [prospect.nickname, ...prospect.aliases]) if (a && !aliasSeen.has(lc(a))) { aliasSeen.add(lc(a)); aliases.push(a) }
  const notes = member.notes && member.notes.trim() ? member.notes : prospect.notes
  await upsertAnn(sb, ws, { memberId: memberKey, nickname: member.nickname, aliases, notes, tags, mainAccount: member.mainAccount })
  const doc = await readDoc(sb, ws)
  if (doc.placement[prospectKey] !== undefined) {
    doc.placement[memberKey] = doc.placement[prospectKey]
    delete doc.placement[prospectKey]
    if (doc.placedAt[prospectKey]) {
      doc.placedAt[memberKey] = doc.placedAt[prospectKey]
      delete doc.placedAt[prospectKey]
    }
  }
  await writeDoc(sb, ws, doc)
  for (const v of voteRows(await allRows(sb, ws))) {
    if (prospectKey in v.map) {
      v.map[memberKey] = v.map[prospectKey]
      delete v.map[prospectKey]
      await upsertAnn(sb, ws, { memberId: v.memberId, notes: JSON.stringify(v.map) })
    }
  }
  await deleteAnn(sb, ws, prospectKey)
}

export async function webPipelineArchivePassed(sb: SupabaseClient, settings: WebSettings): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  const doc = await readDoc(sb, ws)
  const stagesArr = Array.isArray(doc.stages) ? (doc.stages as Array<{ id?: string; type?: string }>) : []
  const declined = new Set(stagesArr.filter((s) => s?.type === 'declined').map((s) => String(s?.id)))
  const removed: string[] = []
  for (const [subj, stage] of Object.entries(doc.placement)) {
    if (declined.has(stage)) {
      delete doc.placement[subj]
      delete doc.placedAt[subj]
      removed.push(subj)
    }
  }
  await writeDoc(sb, ws, doc)
  for (const v of voteRows(await allRows(sb, ws))) {
    let changed = false
    for (const subj of removed) if (subj in v.map) { delete v.map[subj]; changed = true }
    if (changed) await upsertAnn(sb, ws, { memberId: v.memberId, notes: JSON.stringify(v.map) })
  }
}
```

- [ ] **Step 4: Run — expect PASS (6 tests)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/pipeline.test.ts`
Expected: PASS. (If a chain method is missing on the fake, add it to the fake — not the module.)

- [ ] **Step 5: Wire in `webClient.ts`**

Add import: `import { webPipelineGet, webPipelineSetPlacement, webPipelinePlaceMany, webPipelineSetStages, webPipelineAddProspect, webPipelineRemoveProspect, webPipelineVote, webPipelineLinkProspect, webPipelineArchivePassed } from './pipeline'`. Replace the nine stubs:
```ts
pipelineGet: async () =>
  deps.supabase
    ? webPipelineGet(deps.supabase, settings)
    : { stages: undefined, placement: {}, placedAt: {}, prospects: [], votes: [] },
pipelineSetPlacement: async (subjectKey, stageId) => {
  if (deps.supabase) await webPipelineSetPlacement(deps.supabase, settings, subjectKey, stageId)
},
pipelinePlaceMany: async (keys, stageId) => {
  if (deps.supabase) await webPipelinePlaceMany(deps.supabase, settings, keys, stageId)
},
pipelineSetStages: async (stages) => {
  if (deps.supabase) await webPipelineSetStages(deps.supabase, settings, stages)
},
pipelineAddProspect: async (input) =>
  deps.supabase
    ? webPipelineAddProspect(deps.supabase, settings, input)
    : {
        memberId: `prospect:${crypto.randomUUID()}`,
        nickname: input.name,
        aliases: input.handle ? [input.handle] : [],
        notes: '',
        tags: [],
        mainAccount: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
pipelineRemoveProspect: async (key) => {
  if (deps.supabase) await webPipelineRemoveProspect(deps.supabase, settings, key)
},
pipelineVote: async (subjectKey, value) => {
  if (deps.supabase) await webPipelineVote(deps.supabase, settings, subjectKey, value)
},
pipelineLinkProspect: async (prospectKey, memberKey) => {
  if (deps.supabase) await webPipelineLinkProspect(deps.supabase, settings, prospectKey, memberKey)
},
pipelineArchivePassed: async () => {
  if (deps.supabase) await webPipelineArchivePassed(deps.supabase, settings)
},
```
Leave every other `ni(...)` method unchanged.

- [ ] **Step 6: Add `webClient.test.ts` smoke**

```ts
test('pipelineGet returns an empty doc without supabase', async () => {
  expect(await createWebClient({ storage: fakeStorage() }).pipelineGet()).toEqual({
    stages: undefined,
    placement: {},
    placedAt: {},
    prospects: [],
    votes: []
  })
})
```

- [ ] **Step 7: Run web-client suite + full suite + typecheck**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/`
Expected: PASS. Run: `npm test` → all pass. Run: `npm run typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/lib/webClient
git commit -m "feat(web): recruitment pipeline — 9 pipeline* methods on reserved annotation rows"
```

---

## Self-Review Notes

- **Spec coverage:** all 9 `pipeline*` ported (Step 3): `get` (parse doc + prospects + votes + placedAt backfill, never-throws), `setPlacement`/`placeMany`/`setStages` (doc writes), `addProspect` (prospect row + place + returns annotation, always returns), `removeProspect`/`linkProspect`/`archivePassed` (with vote-row purge/re-key), `vote` (caller's vote row). Wired with no-supabase guards (Step 5). Tests cover get/setPlacement/addProspect/vote(+clear)/removeProspect-purge/linkProspect-rekey (Step 1). Other methods stay `ni(...)`; `src/main`/`src/shared`/`src/preload` untouched.
- **Faithful port:** mirrors the desktop `pipeline:*` handlers (`meta:pipeline` doc, `prospect:`/`vote:` rows, the link-merge union + placement move + vote re-key, archive of declined-type stages). Reserved rows written RAW (full row, no prune) so JSON-notes payloads persist; the link member-merge reads-then-writes the full annotation so nickname/mainAccount survive.
- **Type consistency:** `pipelineGet` returns the contract's `{stages, placement, placedAt, prospects: RosterAnnotation[], votes}`; `pipelineAddProspect` returns `RosterAnnotation`; the rest `void`. Uses `crypto.randomUUID()`.
