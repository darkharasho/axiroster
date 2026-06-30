# Recruit Card Modal + Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a card on the Recruitment kanban opens a Jira-style two-pane modal with an editable side panel (stage, votes, nickname, aliases, tags) and a comment thread.

**Architecture:** Comments are the only new backend surface. Each comment is a reserved annotation row `comment:<uuid>` whose `notes` holds `{subjectKey, authorId, authorName, body, editedAt?}`; author is derived server-side (no spoofing, mirrors `pipeline:vote`). The editable side panel reuses methods that already exist on both platforms (`pipelineSetPlacement`, `pipelineVote`, `upsertAnnotation`). New comment methods are added to the desktop IPC layer, the web Supabase layer, and the shared client contract.

**Tech Stack:** TypeScript, React, Electron (desktop IPC), Supabase (web), Vitest, `react-markdown` + `remark-gfm` (already deps), `TagPicker` (existing component).

## Global Constraints

- **No new dependencies** — `react-markdown@^9` and `remark-gfm@^4` are already in `package.json`.
- **Server-side author** — the renderer NEVER passes an author id/name for comments; the desktop/web layer derives it from the session (same anti-spoof rule as voting).
- **Reserved-row storage** — comments live in the annotation store as `comment:<uuid>` rows, synced via the existing `sync.pushAnnotation` / Supabase `roster_annotations` paths. No schema migration.
- **Vitest parallelism** — run with `--pool=forks --poolOptions.forks.maxForks=2` (machine constraint).
- **Permissions** — post/edit own comment requires `canEdit` (`role !== 'read'`); delete requires author OR workspace `role === 'owner'`. Side-panel edits require `canEdit`.
- **Comment payload shape (verbatim):** `{ subjectKey: string, authorId: string, authorName: string, body: string, editedAt?: string }` stored as JSON in the row's `notes`.

---

### Task 1: Pure comment logic + reserved key

**Files:**
- Modify: `src/renderer/src/lib/pipeline.ts`
- Modify: `src/shared/rosterReconcile.ts:74-75`
- Test: `src/renderer/src/lib/pipeline.test.ts`
- Test: `src/shared/rosterReconcile.test.ts` (create if absent — check first with `ls src/shared/rosterReconcile.test.ts`)

**Interfaces:**
- Produces:
  - `export interface PipelineComment { id: string; subjectKey: string; authorId: string; authorName: string; body: string; createdAt: string; editedAt?: string }`
  - `export function parseCommentRow(rec: { memberId: string; notes: string; createdAt: string }): PipelineComment | null` — returns null for malformed rows or rows whose key doesn't start with `comment:`.
  - `export function sortComments(list: PipelineComment[]): PipelineComment[]` — ascending by `createdAt`, ties broken by `id`.
  - `export const COMMENT_PREFIX = 'comment:'`

- [ ] **Step 1: Write the failing test** — append to `src/renderer/src/lib/pipeline.test.ts`:

```ts
import { parseCommentRow, sortComments, COMMENT_PREFIX, type PipelineComment } from './pipeline'

test('parseCommentRow parses a valid comment row', () => {
  const rec = {
    memberId: 'comment:abc',
    notes: JSON.stringify({ subjectKey: 'prospect:1', authorId: 'u1', authorName: 'Dark', body: 'hi' }),
    createdAt: '2026-06-29T00:00:00.000Z'
  }
  expect(parseCommentRow(rec)).toEqual({
    id: 'comment:abc',
    subjectKey: 'prospect:1',
    authorId: 'u1',
    authorName: 'Dark',
    body: 'hi',
    createdAt: '2026-06-29T00:00:00.000Z',
    editedAt: undefined
  })
})

test('parseCommentRow carries editedAt when present', () => {
  const rec = {
    memberId: 'comment:abc',
    notes: JSON.stringify({ subjectKey: 's', authorId: 'u', authorName: 'N', body: 'b', editedAt: '2026-06-29T01:00:00.000Z' }),
    createdAt: '2026-06-29T00:00:00.000Z'
  }
  expect(parseCommentRow(rec)?.editedAt).toBe('2026-06-29T01:00:00.000Z')
})

test('parseCommentRow returns null for malformed or non-comment rows', () => {
  expect(parseCommentRow({ memberId: 'comment:x', notes: 'not json', createdAt: 't' })).toBeNull()
  expect(parseCommentRow({ memberId: 'prospect:x', notes: '{}', createdAt: 't' })).toBeNull()
  expect(parseCommentRow({ memberId: 'comment:x', notes: JSON.stringify({ authorId: 'u' }), createdAt: 't' })).toBeNull()
})

test('sortComments orders ascending by createdAt then id', () => {
  const a: PipelineComment = { id: 'comment:b', subjectKey: 's', authorId: 'u', authorName: 'N', body: '2', createdAt: '2026-06-29T00:00:02.000Z' }
  const b: PipelineComment = { id: 'comment:a', subjectKey: 's', authorId: 'u', authorName: 'N', body: '1', createdAt: '2026-06-29T00:00:01.000Z' }
  expect(sortComments([a, b]).map((c) => c.body)).toEqual(['1', '2'])
})

test('COMMENT_PREFIX is comment:', () => {
  expect(COMMENT_PREFIX).toBe('comment:')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/lib/pipeline.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — `parseCommentRow is not a function`.

- [ ] **Step 3: Write minimal implementation** — append to `src/renderer/src/lib/pipeline.ts`:

```ts
export const COMMENT_PREFIX = 'comment:'

export interface PipelineComment {
  id: string
  subjectKey: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
  editedAt?: string
}

export function parseCommentRow(rec: { memberId: string; notes: string; createdAt: string }): PipelineComment | null {
  if (!rec.memberId.startsWith(COMMENT_PREFIX)) return null
  try {
    const p = JSON.parse(rec.notes || '{}')
    if (!p || typeof p !== 'object') return null
    const { subjectKey, authorId, authorName, body, editedAt } = p as Record<string, unknown>
    if (typeof subjectKey !== 'string' || typeof authorId !== 'string' || typeof body !== 'string') return null
    return {
      id: rec.memberId,
      subjectKey,
      authorId,
      authorName: typeof authorName === 'string' ? authorName : 'Member',
      body,
      createdAt: rec.createdAt,
      editedAt: typeof editedAt === 'string' ? editedAt : undefined
    }
  } catch {
    return null
  }
}

export function sortComments(list: PipelineComment[]): PipelineComment[] {
  return [...list].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
}
```

- [ ] **Step 4: Extend reserved-key matcher** — in `src/shared/rosterReconcile.ts` change lines 74-75:

```ts
export const isReservedAnnotationKey = (key: string): boolean =>
  key.startsWith('meta:') || key.startsWith('prospect:') || key.startsWith('vote:') || key.startsWith('comment:')
```

- [ ] **Step 5: Add reserved-key test** — if `src/shared/rosterReconcile.test.ts` exists, add a case; otherwise create the file:

```ts
import { test, expect } from 'vitest'
import { isReservedAnnotationKey } from './rosterReconcile'

test('comment: keys are reserved (excluded from member list)', () => {
  expect(isReservedAnnotationKey('comment:abc')).toBe(true)
  expect(isReservedAnnotationKey('123456789')).toBe(false)
})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/lib/pipeline.test.ts src/shared/rosterReconcile.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/lib/pipeline.ts src/renderer/src/lib/pipeline.test.ts src/shared/rosterReconcile.ts src/shared/rosterReconcile.test.ts
git commit -m "feat(pipeline): comment row parsing + reserve comment: keys"
```

---

### Task 2: Contract + Electron bridge + desktop IPC handlers

**Files:**
- Modify: `src/preload/index.d.ts:422` (after `pipelineArchivePassed`)
- Modify: `src/preload/index.ts:125` (after `pipelineArchivePassed`)
- Modify: `src/main/index.ts` (add handlers + helpers near the other `pipeline:*` handlers, after `pipeline:archivePassed` ~line 905)

**Interfaces:**
- Consumes: `PipelineComment` (Task 1), existing `roster`, `sync`, `getOrCreateDiscordAuth`, `effectiveWorkspace`, `pushRow`, `nowIso`.
- Produces (on `AxiClient`):
  - `pipelineGetComments(subjectKey: string): Promise<PipelineComment[]>`
  - `pipelineAddComment(subjectKey: string, body: string): Promise<PipelineComment | null>`
  - `pipelineEditComment(commentId: string, body: string): Promise<PipelineComment | null>`
  - `pipelineDeleteComment(commentId: string): Promise<void>`

- [ ] **Step 1: Add to the contract** — in `src/preload/index.d.ts`, import is implicit (same file uses `RosterAnnotation`); add after line 422. Note `PipelineComment` is defined in the renderer lib, so declare a structurally identical inline type to avoid a cross-boundary import:

```ts
  pipelineGetComments(subjectKey: string): Promise<PipelineCommentDTO[]>
  pipelineAddComment(subjectKey: string, body: string): Promise<PipelineCommentDTO | null>
  pipelineEditComment(commentId: string, body: string): Promise<PipelineCommentDTO | null>
  pipelineDeleteComment(commentId: string): Promise<void>
```

And add this interface near the other exported interfaces (e.g. just below `AuthStatus`, ~line 251):

```ts
export interface PipelineCommentDTO {
  id: string
  subjectKey: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
  editedAt?: string
}
```

- [ ] **Step 2: Add the Electron bridge** — in `src/preload/index.ts` after line 125:

```ts
  pipelineGetComments: (subjectKey: string) => ipcRenderer.invoke('pipeline:getComments', subjectKey),
  pipelineAddComment: (subjectKey: string, body: string) => ipcRenderer.invoke('pipeline:addComment', subjectKey, body),
  pipelineEditComment: (commentId: string, body: string) => ipcRenderer.invoke('pipeline:editComment', commentId, body),
  pipelineDeleteComment: (commentId: string) => ipcRenderer.invoke('pipeline:deleteComment', commentId),
```

- [ ] **Step 3: Add desktop helpers + handlers** — in `src/main/index.ts`, immediately after the `pipeline:archivePassed` handler (~line 905). `randomUUID` is already imported (used by `pipeline:addProspect`). `effectiveWorkspace(auth)` returns `{ role }`.

```ts
  const COMMENT_PREFIX = 'comment:'
  // Author identity for a comment, derived server-side (never trust the renderer).
  const commentIdentity = async (): Promise<{ id: string; name: string; isOwner: boolean } | null> => {
    const auth = getOrCreateDiscordAuth()
    const session = auth ? await auth.restoreSession().catch(() => null) : null
    const u = session?.user
    if (!u?.id) return null
    const md = (u.user_metadata ?? {}) as Record<string, unknown>
    const name = String(md.full_name || md.name || md.user_name || md.preferred_username || 'Member')
    const ws = auth ? await effectiveWorkspace(auth).catch(() => null) : null
    return { id: u.id, name, isOwner: ws?.role === 'owner' }
  }
  const commentToDTO = (rec: { memberId: string; notes: string; createdAt: string }): PipelineCommentDTO | null => {
    if (!rec.memberId.startsWith(COMMENT_PREFIX)) return null
    try {
      const p = JSON.parse(rec.notes || '{}')
      if (typeof p?.subjectKey !== 'string' || typeof p?.authorId !== 'string' || typeof p?.body !== 'string') return null
      return {
        id: rec.memberId,
        subjectKey: p.subjectKey,
        authorId: p.authorId,
        authorName: typeof p.authorName === 'string' ? p.authorName : 'Member',
        body: p.body,
        createdAt: rec.createdAt,
        editedAt: typeof p.editedAt === 'string' ? p.editedAt : undefined
      }
    } catch {
      return null
    }
  }

  ipcMain.handle('pipeline:getComments', async (_e, subjectKey: string) => {
    return roster
      .list()
      .filter((a) => a.memberId.startsWith(COMMENT_PREFIX))
      .map((a) => commentToDTO(a))
      .filter((c): c is PipelineCommentDTO => !!c && c.subjectKey === subjectKey)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
  })

  ipcMain.handle('pipeline:addComment', async (_e, subjectKey: string, body: string) => {
    const who = await commentIdentity()
    const text = String(body || '').trim()
    if (!who || !text) return null
    const id = `${COMMENT_PREFIX}${randomUUID()}`
    roster.upsert(id, { notes: JSON.stringify({ subjectKey, authorId: who.id, authorName: who.name, body: text }) })
    await pushRow(id)
    const rec = roster.get(id)
    return rec ? commentToDTO(rec) : null
  })

  ipcMain.handle('pipeline:editComment', async (_e, commentId: string, body: string) => {
    const who = await commentIdentity()
    const text = String(body || '').trim()
    const rec = roster.get(commentId)
    if (!who || !text || !rec) return null
    const dto = commentToDTO(rec)
    if (!dto || dto.authorId !== who.id) return null // only the author may edit
    roster.upsert(commentId, {
      notes: JSON.stringify({ subjectKey: dto.subjectKey, authorId: dto.authorId, authorName: dto.authorName, body: text, editedAt: nowIso() })
    })
    await pushRow(commentId)
    const next = roster.get(commentId)
    return next ? commentToDTO(next) : null
  })

  ipcMain.handle('pipeline:deleteComment', async (_e, commentId: string) => {
    const who = await commentIdentity()
    const rec = roster.get(commentId)
    if (!who || !rec) return
    const dto = commentToDTO(rec)
    if (!dto) return
    if (dto.authorId !== who.id && !who.isOwner) return // author or owner only
    roster.remove(commentId)
    await sync.removeAnnotation(commentId).catch(() => {})
  })
```

- [ ] **Step 4: Add the import for the DTO type** — at the top of `src/main/index.ts`, add `PipelineCommentDTO` to the existing type import from `'../preload/index.d'` (find the line importing `RosterAnnotation`/`AuthStatus` types from the preload contract and append `PipelineCommentDTO`). If no such type-import line exists, add: `import type { PipelineCommentDTO } from '../preload/index.d'`.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck` (or `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json` — use whatever `package.json` defines; check `scripts`).
Expected: no errors.

- [ ] **Step 6: Manual desktop verification** (no main-process unit-test harness exists — voting handlers are likewise manually verified).

Run: `npm run dev`. Open Recruitment. In devtools console:
```js
await window.axiroster.pipelineAddComment('prospect:SOME_KEY', 'first note')
await window.axiroster.pipelineGetComments('prospect:SOME_KEY')   // → array with the comment, authorName populated
```
Expected: the comment round-trips; `authorId` is your session id (not passed in); editing a non-author comment returns null.

- [ ] **Step 7: Commit**

```bash
git add src/preload/index.d.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(pipeline): desktop comment CRUD IPC + client contract"
```

---

### Task 3: Web (Supabase) comment implementation

**Files:**
- Modify: `src/renderer/src/lib/webClient/pipeline.ts`
- Modify: `src/renderer/src/lib/webClient/webClient.ts` (import + register the 4 methods, ~lines 26 and 200)
- Test: `src/renderer/src/lib/webClient/pipeline.test.ts`

**Interfaces:**
- Consumes: existing `activeWorkspaceId`, `getAnn`, `upsertAnn`, `deleteAnn`, `allRows`, `rowToAnn`, `now`; `resolveEffectiveWorkspace` and `discordIdentity` from `./auth`.
- Produces: `webPipelineGetComments`, `webPipelineAddComment`, `webPipelineEditComment`, `webPipelineDeleteComment` with signatures `(sb, settings, ...) => Promise<...>` mirroring the contract.

- [ ] **Step 1: Write failing tests** — append to `src/renderer/src/lib/webClient/pipeline.test.ts`. The `fakeSb` helper at the top of that file already models `roster_annotations` (select/eq/maybeSingle/upsert/delete) and a `workspace_members` row for `activeWorkspaceId`. Comment methods derive identity from `sb.auth.getUser()`, so the fake must answer it — extend the existing fake or add a thin wrapper. Add:

```ts
import { webPipelineAddComment, webPipelineGetComments, webPipelineEditComment, webPipelineDeleteComment } from './pipeline'

// Wrap the file's fakeSb to also answer auth.getUser() and the workspace_members
// role lookup that resolveEffectiveWorkspace performs.
function fakeSbWithUser(userId: string, role: string, initial = {}) {
  const sb = fakeSb(initial) as unknown as Record<string, unknown>
  sb.auth = { getUser: async () => ({ data: { user: { id: userId, user_metadata: { full_name: 'Tester' } } } }) }
  return sb as unknown as SupabaseClient
}

test('web: add then get comment round-trips with server-derived author', async () => {
  const settings = createWebSettings(fakeStorage())
  settings.set('activeGuildId', 'w1')
  const sb = fakeSbWithUser('u1', 'member', { 'wm:u1': { workspace_id: 'w1', role: 'member', user_id: 'u1' } })
  const added = await webPipelineAddComment(sb, settings, 'prospect:1', 'hello')
  expect(added?.authorId).toBe('u1')
  expect(added?.authorName).toBe('Tester')
  const list = await webPipelineGetComments(sb, settings, 'prospect:1')
  expect(list.map((c) => c.body)).toEqual(['hello'])
})

test('web: edit by non-author is rejected', async () => {
  const settings = createWebSettings(fakeStorage())
  settings.set('activeGuildId', 'w1')
  const sb = fakeSbWithUser('u1', 'member', { 'wm:u1': { workspace_id: 'w1', role: 'member', user_id: 'u1' } })
  const added = await webPipelineAddComment(sb, settings, 'prospect:1', 'mine')
  // switch the acting user
  ;(sb as unknown as Record<string, unknown>).auth = { getUser: async () => ({ data: { user: { id: 'u2', user_metadata: {} } } }) }
  const edited = await webPipelineEditComment(sb, settings, added!.id, 'hacked')
  expect(edited).toBeNull()
})

test('web: owner may delete another user comment', async () => {
  const settings = createWebSettings(fakeStorage())
  settings.set('activeGuildId', 'w1')
  const sb = fakeSbWithUser('u1', 'member', { 'wm:u1': { workspace_id: 'w1', role: 'member', user_id: 'u1' } })
  const added = await webPipelineAddComment(sb, settings, 'prospect:1', 'theirs')
  ;(sb as unknown as Record<string, unknown>).auth = { getUser: async () => ({ data: { user: { id: 'owner1', user_metadata: {} } } }) }
  ;(sb as unknown as Record<string, unknown>)._roleForActing = 'owner' // see note below
  await webPipelineDeleteComment(sb, settings, added!.id)
  const list = await webPipelineGetComments(sb, settings, 'prospect:1')
  expect(list).toEqual([])
})
```

> **Note for the implementer:** the existing `fakeSb` resolves workspace role via a `workspace_members` query in `resolveEffectiveWorkspace`. For the owner-delete test, make the fake return a `{ workspace_id: 'w1', role: 'owner', user_id: 'owner1' }` membership for the acting user (adapt the fake's `workspace_members` builder rather than the `_roleForActing` placeholder shown above — that placeholder is illustrative). Keep the real code path (`resolveEffectiveWorkspace`) unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/lib/webClient/pipeline.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — `webPipelineAddComment is not a function`.

- [ ] **Step 3: Implement the four web functions** — append to `src/renderer/src/lib/webClient/pipeline.ts`. Add imports at top: `import { resolveEffectiveWorkspace, discordIdentity } from './auth'`.

```ts
const COMMENT_PREFIX = 'comment:'
interface CommentDTO {
  id: string; subjectKey: string; authorId: string; authorName: string; body: string; createdAt: string; editedAt?: string
}

function commentToDTO(r: Record<string, unknown>): CommentDTO | null {
  const id = String(r.member_id)
  if (!id.startsWith(COMMENT_PREFIX)) return null
  try {
    const p = JSON.parse(typeof r.notes === 'string' ? r.notes : '{}')
    if (typeof p?.subjectKey !== 'string' || typeof p?.authorId !== 'string' || typeof p?.body !== 'string') return null
    return {
      id,
      subjectKey: p.subjectKey,
      authorId: p.authorId,
      authorName: typeof p.authorName === 'string' ? p.authorName : 'Member',
      body: p.body,
      createdAt: typeof r.created_at === 'string' ? r.created_at : now(),
      editedAt: typeof p.editedAt === 'string' ? p.editedAt : undefined
    }
  } catch {
    return null
  }
}

async function actingUser(sb: SupabaseClient, settings: WebSettings, ws: string): Promise<{ id: string; name: string; isOwner: boolean } | null> {
  const { data: { user } } = await sb.auth.getUser()
  if (!user?.id) return null
  const { name } = discordIdentity(user.user_metadata as Record<string, unknown> | undefined)
  const eff = await resolveEffectiveWorkspace(sb, settings, user.id).catch(() => null)
  return { id: user.id, name: name || 'Member', isOwner: eff?.workspaceId === ws && eff?.role === 'owner' }
}

export async function webPipelineGetComments(sb: SupabaseClient, settings: WebSettings, subjectKey: string): Promise<CommentDTO[]> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return []
  const rows = await allRows(sb, ws)
  return rows
    .map(commentToDTO)
    .filter((c): c is CommentDTO => !!c && c.subjectKey === subjectKey)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
}

export async function webPipelineAddComment(sb: SupabaseClient, settings: WebSettings, subjectKey: string, body: string): Promise<CommentDTO | null> {
  const ws = await activeWorkspaceId(sb, settings)
  const text = String(body || '').trim()
  if (!ws || !text) return null
  const who = await actingUser(sb, settings, ws)
  if (!who) return null
  const id = `${COMMENT_PREFIX}${crypto.randomUUID()}`
  await upsertAnn(sb, ws, { memberId: id, notes: JSON.stringify({ subjectKey, authorId: who.id, authorName: who.name, body: text }) })
  const created = await getAnn(sb, ws, id)
  return created ? commentToDTO({ member_id: id, notes: created.notes, created_at: created.createdAt }) : null
}

export async function webPipelineEditComment(sb: SupabaseClient, settings: WebSettings, commentId: string, body: string): Promise<CommentDTO | null> {
  const ws = await activeWorkspaceId(sb, settings)
  const text = String(body || '').trim()
  if (!ws || !text) return null
  const who = await actingUser(sb, settings, ws)
  const existing = await getAnn(sb, ws, commentId)
  if (!who || !existing) return null
  const dto = commentToDTO({ member_id: commentId, notes: existing.notes, created_at: existing.createdAt })
  if (!dto || dto.authorId !== who.id) return null
  await upsertAnn(sb, ws, {
    memberId: commentId,
    notes: JSON.stringify({ subjectKey: dto.subjectKey, authorId: dto.authorId, authorName: dto.authorName, body: text, editedAt: now() })
  })
  return { ...dto, body: text, editedAt: now() }
}

export async function webPipelineDeleteComment(sb: SupabaseClient, settings: WebSettings, commentId: string): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  const who = await actingUser(sb, settings, ws)
  const existing = await getAnn(sb, ws, commentId)
  if (!who || !existing) return
  const dto = commentToDTO({ member_id: commentId, notes: existing.notes, created_at: existing.createdAt })
  if (!dto) return
  if (dto.authorId !== who.id && !who.isOwner) return
  await deleteAnn(sb, ws, commentId)
}
```

- [ ] **Step 4: Register in `webClient.ts`** — add to the import on line 26 (`webPipelineGetComments, webPipelineAddComment, webPipelineEditComment, webPipelineDeleteComment`) and add after `pipelineArchivePassed` (~line 200):

```ts
    pipelineGetComments: async (subjectKey) =>
      deps.supabase ? webPipelineGetComments(deps.supabase, settings, subjectKey) : [],
    pipelineAddComment: async (subjectKey, body) =>
      deps.supabase ? webPipelineAddComment(deps.supabase, settings, subjectKey, body) : null,
    pipelineEditComment: async (commentId, body) =>
      deps.supabase ? webPipelineEditComment(deps.supabase, settings, commentId, body) : null,
    pipelineDeleteComment: async (commentId) => {
      if (deps.supabase) await webPipelineDeleteComment(deps.supabase, settings, commentId)
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/lib/webClient/pipeline.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/lib/webClient/pipeline.ts src/renderer/src/lib/webClient/pipeline.test.ts src/renderer/src/lib/webClient/webClient.ts
git commit -m "feat(pipeline): web comment CRUD via roster_annotations"
```

---

### Task 4: RecruitCardModal — comment thread + composer

**Files:**
- Create: `src/renderer/src/components/RecruitCardModal.tsx`
- Test: manual (no renderer component-test harness in this repo — lib logic is unit-tested in Tasks 1/3).

**Interfaces:**
- Consumes: `client.pipelineGetComments/AddComment/EditComment/DeleteComment`, `PipelineCommentDTO`, `PipelineSubject`, `react-markdown`, `remark-gfm`.
- Produces: `export default function RecruitCardModal(props)` where
  ```ts
  interface RecruitCardModalProps {
    subject: PipelineSubject
    stages: PipelineStage[]
    placement: Record<string, string>
    placedAt: Record<string, string>
    voteRows: Record<string, VoteValue>[]
    myVote: Record<string, VoteValue>
    canEdit: boolean
    myVoterId: string | null
    isOwner: boolean
    currentUserId: string | null
    registry: TagRegistry
    onClose: () => void
    onChanged: () => void   // re-loads board data in the parent
  }
  ```

This task builds the modal shell + the LEFT pane (header + comment thread + composer). The editable side panel is Task 5.

- [ ] **Step 1: Create the component file** with the shell, header, and comment thread:

```tsx
// src/renderer/src/components/RecruitCardModal.tsx
//
// Jira-style detail modal for a recruit card. Left pane: header + comment thread.
// Right pane (Task 5): editable side panel. Comments are server-authored
// (comment:<uuid> rows); author/edit/delete rules enforced in the main/web layer.
import { useCallback, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { X, Pencil, Trash2 } from 'lucide-react'
import type { PipelineCommentDTO } from '../../../preload/index.d'
import type { PipelineStage, PipelineSubject, VoteValue } from '../lib/pipeline'
import type { TagRegistry } from '../lib/tagRegistry'
import { client } from '../lib/client'
import { toast } from '../lib/toast'

export interface RecruitCardModalProps {
  subject: PipelineSubject
  stages: PipelineStage[]
  placement: Record<string, string>
  placedAt: Record<string, string>
  voteRows: Record<string, VoteValue>[]
  myVote: Record<string, VoteValue>
  canEdit: boolean
  myVoterId: string | null
  isOwner: boolean
  currentUserId: string | null
  registry: TagRegistry
  onClose: () => void
  onChanged: () => void
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function RecruitCardModal(props: RecruitCardModalProps): JSX.Element {
  const { subject, canEdit, isOwner, currentUserId, onClose } = props
  const [comments, setComments] = useState<PipelineCommentDTO[]>([])
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setComments(await client.pipelineGetComments(subject.key))
  }, [subject.key])
  useEffect(() => { void reload() }, [reload])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const post = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    await client.pipelineAddComment(subject.key, text)
    setDraft('')
    await reload()
    setBusy(false)
  }
  const saveEdit = async (id: string): Promise<void> => {
    const text = editText.trim()
    if (!text) return
    await client.pipelineEditComment(id, text)
    setEditingId(null)
    await reload()
  }
  const del = async (id: string): Promise<void> => {
    await client.pipelineDeleteComment(id)
    toast('Comment deleted')
    await reload()
  }

  const canModify = (c: PipelineCommentDTO): boolean => !!currentUserId && c.authorId === currentUserId
  const canDelete = (c: PipelineCommentDTO): boolean => canModify(c) || isOwner

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-panel-line bg-panel-raised shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-panel-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-semibold text-ink">{subject.name}</div>
            <div className="truncate text-xs text-ink-faint">{subject.accountName ?? 'Discord only'}</div>
          </div>
          <button onClick={onClose} className="btn px-2 py-1"><X size={16} /></button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* LEFT: comment thread */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Comments · {comments.length}
              </div>
              <div className="space-y-4">
                {comments.length === 0 && <div className="text-sm text-ink-faint">No comments yet.</div>}
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2 text-xs">
                        <span className="font-semibold text-ink">{c.authorName}</span>
                        <span className="text-ink-faint">{timeAgo(c.createdAt)}{c.editedAt ? ' · edited' : ''}</span>
                        {canModify(c) && editingId !== c.id && (
                          <button onClick={() => { setEditingId(c.id); setEditText(c.body) }} className="ml-auto text-ink-faint hover:text-ink"><Pencil size={12} /></button>
                        )}
                        {canDelete(c) && editingId !== c.id && (
                          <button onClick={() => void del(c.id)} className={`${canModify(c) ? '' : 'ml-auto'} text-ink-faint hover:text-rose-300`}><Trash2 size={12} /></button>
                        )}
                      </div>
                      {editingId === c.id ? (
                        <div>
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="field min-h-[60px] w-full text-sm"
                          />
                          <div className="mt-1.5 flex justify-end gap-2">
                            <button onClick={() => setEditingId(null)} className="btn px-2 py-1 text-xs">Cancel</button>
                            <button onClick={() => void saveEdit(c.id)} className="btn px-2 py-1 text-xs font-semibold text-accent">Save</button>
                          </div>
                        </div>
                      ) : (
                        <div className="prose prose-invert max-w-none rounded-lg rounded-tl-sm border border-panel-line bg-panel-sunk px-3 py-2 text-sm text-ink [&_p]:my-0">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.body}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Composer */}
            {canEdit && (
              <div className="border-t border-panel-line px-5 py-3">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void post() }}
                  placeholder="Add a comment…  (markdown supported · ⌘/Ctrl+Enter to post)"
                  className="field min-h-[60px] w-full text-sm"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button onClick={() => setDraft('')} className="btn px-3 py-1 text-xs">Clear</button>
                  <button onClick={() => void post()} disabled={busy || !draft.trim()} className="btn px-3 py-1 text-xs font-semibold text-accent disabled:opacity-50">Comment</button>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: side panel — added in Task 5 */}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (The component is not yet rendered anywhere; that happens in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/RecruitCardModal.tsx
git commit -m "feat(recruitment): RecruitCardModal shell + comment thread"
```

---

### Task 5: RecruitCardModal — editable side panel

**Files:**
- Modify: `src/renderer/src/components/RecruitCardModal.tsx`

**Interfaces:**
- Consumes: `client.pipelineSetPlacement`, `client.pipelineVote`, `client.upsertAnnotation`, `client.setTagRegistry`, existing `TagPicker`, `tallyVotes`, `tagRegistry` helpers.
- Produces: the right-hand `<aside>` inside the modal (stage select, vote tally+buttons, nickname input, aliases input, tags via `TagPicker`, read-only time-in-stage).

- [ ] **Step 1: Add imports + local edit state** — extend the imports and the component body in `RecruitCardModal.tsx`:

Add to imports:
```tsx
import TagPicker from './TagPicker'
import { tallyVotes } from '../lib/pipeline'
import { setTagColor, type TagColorId } from '../lib/tagRegistry'
```

Add inside the component (after the existing `useState` hooks):
```tsx
  const { stages, placement, placedAt, voteRows, myVote, myVoterId, registry, onChanged } = props
  const [nickname, setNickname] = useState(subject.name)
  const [aliasText, setAliasText] = useState(subject.accountName ?? '')
  const [tags, setTags] = useState<string[]>(subject.tags)
  const [reg, setReg] = useState<TagRegistry>(registry)
  useEffect(() => { setReg(registry) }, [registry])

  const stageId = placement[subject.key]
  const reviewStageIds = new Set(stages.filter((s, i) => s.type === 'active' && i > 0).map((s) => s.id))
  const days = (() => {
    const iso = placedAt[subject.key]
    if (!iso) return null
    const t = Date.parse(iso)
    return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86400000))
  })()

  const saveAnn = async (patch: Record<string, unknown>): Promise<void> => {
    if (!canEdit) return
    await client.upsertAnnotation(subject.key, patch)
    onChanged()
  }
  const changeStage = async (next: string): Promise<void> => {
    await client.pipelineSetPlacement(subject.key, next)
    onChanged()
  }
  const castVote = async (value: VoteValue): Promise<void> => {
    const next = myVote[subject.key] === value ? 'clear' : value
    await client.pipelineVote(subject.key, next)
    onChanged()
  }
```

- [ ] **Step 2: Replace the `{/* RIGHT: side panel — added in Task 5 */}` comment** with the panel JSX:

```tsx
          <aside className="w-64 shrink-0 overflow-y-auto border-l border-panel-line bg-panel-sunk px-4 py-4">
            {/* Stage */}
            <div className="mb-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Stage</div>
              <select
                value={stageId ?? ''}
                disabled={!canEdit}
                onChange={(e) => void changeStage(e.target.value)}
                className="field w-full text-sm disabled:opacity-60"
              >
                {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>

            {/* Votes — only meaningful in review-ish stages */}
            {myVoterId && stageId && reviewStageIds.has(stageId) && (() => {
              const t = tallyVotes(voteRows, subject.key)
              const mine = myVote[subject.key]
              return (
                <div className="mb-4">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Votes</div>
                  <div className="flex gap-2">
                    <button onClick={() => void castVote('yes')} disabled={!canEdit} className={`flex-1 rounded border py-1.5 text-sm font-semibold ${mine === 'yes' ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300' : 'border-panel-line text-emerald-300/80'}`}>✓ {t.yes}</button>
                    <button onClick={() => void castVote('no')} disabled={!canEdit} className={`flex-1 rounded border py-1.5 text-sm font-semibold ${mine === 'no' ? 'border-rose-500/50 bg-rose-500/20 text-rose-300' : 'border-panel-line text-rose-300/80'}`}>✕ {t.no}</button>
                    <button onClick={() => void castVote('abstain')} disabled={!canEdit} className={`flex-1 rounded border py-1.5 text-sm ${mine === 'abstain' ? 'border-panel-line2 bg-panel-hover text-ink' : 'border-panel-line text-ink-faint'}`}>– {t.abstain}</button>
                  </div>
                </div>
              )
            })()}

            {/* Nickname */}
            <div className="mb-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Nickname</div>
              <input
                value={nickname}
                disabled={!canEdit}
                onChange={(e) => setNickname(e.target.value)}
                onBlur={() => nickname !== subject.name && void saveAnn({ nickname })}
                className="field w-full text-sm disabled:opacity-60"
              />
            </div>

            {/* Aliases (comma-separated) */}
            <div className="mb-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Aliases / accounts</div>
              <input
                value={aliasText}
                disabled={!canEdit}
                onChange={(e) => setAliasText(e.target.value)}
                onBlur={() => void saveAnn({ aliases: aliasText.split(',').map((a) => a.trim()).filter(Boolean) })}
                placeholder="Account.1234, alt name"
                className="field w-full text-sm disabled:opacity-60"
              />
            </div>

            {/* Tags */}
            <div className="mb-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Tags</div>
              <TagPicker
                tags={tags}
                registry={reg}
                editable={canEdit}
                onAssign={(name) => {
                  if (tags.some((t) => t.toLowerCase() === name.toLowerCase())) return
                  const next = [...tags, name]
                  setTags(next)
                  void saveAnn({ tags: next })
                }}
                onRemove={(name) => {
                  const next = tags.filter((t) => t !== name)
                  setTags(next)
                  void saveAnn({ tags: next })
                }}
                onRecolor={async (name, id: TagColorId) => {
                  const next = setTagColor(reg, name, id)
                  setReg(next)
                  await client.setTagRegistry(next).catch(() => {})
                }}
              />
            </div>

            {/* Time in stage (read-only) */}
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Time in stage</div>
              <div className="text-sm text-ink-dim">{days === null ? '—' : `${days} day${days === 1 ? '' : 's'}`}</div>
            </div>
          </aside>
```

- [ ] **Step 3: Verify `TagPicker` default-export vs named** — open `src/renderer/src/components/TagPicker.tsx` and confirm the import form. If it is a named export, change `import TagPicker from './TagPicker'` to `import { TagPicker } from './TagPicker'`.

Run: `grep -n "export" src/renderer/src/components/TagPicker.tsx`
Expected: shows whether it's `export default` or `export function TagPicker` — match the import accordingly.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/RecruitCardModal.tsx
git commit -m "feat(recruitment): editable side panel in RecruitCardModal"
```

---

### Task 6: Wire the modal into RecruitmentView (open on click, not drag)

**Files:**
- Modify: `src/renderer/src/components/RecruitmentView.tsx`

**Interfaces:**
- Consumes: `RecruitCardModal` (Tasks 4-5), existing board state (`stages`, `placement`, `placedAt`, `voteRows`, `myVote`, `canEdit`, `myVoterId`, `registry`, `load`), `client.authStatus`.
- Produces: card click opens the modal for that subject; modal `onChanged` calls `load()`.

- [ ] **Step 1: Add imports + state** — at the top of `RecruitmentView.tsx`:

```tsx
import RecruitCardModal from './RecruitCardModal'
```

Add state near the other `useState` hooks (after line 33):
```tsx
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  // Track pointer-down position to tell a click from a drag.
  const downPos = useState<{ x: number; y: number } | null>(null)
```

> Replace `downPos` with a `useRef` instead of `useState` to avoid re-renders:
```tsx
  const downPosRef = useRef<{ x: number; y: number } | null>(null)
```
Add `useRef` to the React import on line 7: `import { useCallback, useEffect, useMemo, useRef, useState } from 'react'`.

- [ ] **Step 2: Capture owner + user id in `load()`** — inside `load`, after `setMyVoterId(auth.userId ?? null)` (line 58):

```tsx
    setIsOwner(auth.role === 'owner')
    setCurrentUserId(auth.userId ?? null)
```

- [ ] **Step 3: Make cards open the modal on a non-drag click** — modify the card `<div>` (lines 394-400). Add `onMouseDown`/`onClick` handlers and a pointer cursor. The existing inner controls (vote buttons, link button/select) already `stopPropagation`, so they won't trigger open:

```tsx
                <div
                  key={subj.key}
                  draggable={canEdit}
                  onDragStart={() => setDragKey(subj.key)}
                  onDragEnd={() => setDragKey(null)}
                  onMouseDown={(e) => { downPosRef.current = { x: e.clientX, y: e.clientY } }}
                  onClick={(e) => {
                    const d = downPosRef.current
                    // Treat as a click only if the pointer barely moved (not a drag).
                    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) setOpenKey(subj.key)
                  }}
                  className="mb-2 cursor-pointer rounded-lg border border-panel-line bg-panel-raised p-2.5 hover:border-panel-line2"
                >
```

- [ ] **Step 4: Render the modal** — just before the final closing `</div>` of the component (before line 511 `</div>` that closes the root, i.e. after the board `</div>` on line 510), add:

```tsx
      {openKey && (() => {
        const subj = subjects.find((s) => s.key === openKey)
        if (!subj) return null
        return (
          <RecruitCardModal
            subject={subj}
            stages={stages}
            placement={placement}
            placedAt={placedAt}
            voteRows={voteRows}
            myVote={myVote}
            canEdit={canEdit}
            myVoterId={myVoterId}
            isOwner={isOwner}
            currentUserId={currentUserId}
            registry={registry}
            onClose={() => setOpenKey(null)}
            onChanged={() => { void load() }}
          />
        )
      })()}
```

- [ ] **Step 5: Typecheck + run the full lib test suite**

Run: `npm run typecheck && npx vitest run --pool=forks --poolOptions.forks.maxForks=2`
Expected: typecheck clean; all tests pass.

- [ ] **Step 6: Manual end-to-end verification**

Run: `npm run dev`. Open Recruitment.
- Click a card → modal opens. Drag a card across columns → it restages and does NOT open the modal.
- Post a comment; it appears with your name and renders markdown (`**bold**`, `- list`).
- Edit your own comment → shows "· edited". Confirm the edit/delete icons are absent on others' comments unless you are owner.
- In the side panel: change stage (card moves on the board after close/refresh), cast a vote, edit nickname/aliases/tags → reflected on the board.
- Confirm no `comment:` row ever appears in the main Roster list.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/RecruitmentView.tsx
git commit -m "feat(recruitment): open RecruitCardModal from kanban cards"
```

---

## Self-Review

**Spec coverage:**
- Two-pane full-detail modal → Tasks 4-6. ✓
- Comments as `comment:<uuid>` rows, server-side author, no clobber → Tasks 1-3. ✓
- Markdown render, edit/delete own + owner-delete-any → Task 4 (UI) + Tasks 2-3 (enforcement). ✓
- Editable side panel (stage/votes/nickname/aliases/tags) reusing existing methods → Task 5. ✓
- `isReservedAnnotationKey` excludes `comment:` → Task 1. ✓
- Lazy-load comments on open (not in `pipeline:get`) → Task 4 `reload()`. ✓
- Click-vs-drag disambiguation → Task 6. ✓
- Non-goals (no replies/reactions/@mentions/activity-log/rich-text/notifications) → none added. ✓

**Placeholder scan:** the only intentional "illustrative" marker is the `_roleForActing` note in Task 3 Step 1, explicitly called out with implementer guidance to adapt the existing `fakeSb` `workspace_members` builder instead. No TBD/TODO/"handle edge cases" left.

**Type consistency:** `PipelineComment` (renderer lib) and `PipelineCommentDTO` (preload contract) are structurally identical; the client returns DTOs and the modal imports `PipelineCommentDTO`. Method names match across contract/bridge/desktop/web: `pipelineGetComments`, `pipelineAddComment`, `pipelineEditComment`, `pipelineDeleteComment`. `TagPicker` prop names (`tags`, `registry`, `editable`, `onAssign`, `onRemove`, `onRecolor`) copied verbatim from `MemberDetail.tsx`.

**Note for executor:** confirm `npm run typecheck` exists in `package.json` scripts; if not, substitute the project's actual typecheck command. Confirm `TagPicker`'s export style in Task 5 Step 3 before relying on the default import.
