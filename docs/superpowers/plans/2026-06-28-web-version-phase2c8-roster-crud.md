# Web Version — Phase 2c-8: Web Roster CRUD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `getTagRegistry`/`setTagRegistry`/`upsertAnnotation`/`removeAnnotation`/`setLink`/`removeLink` as direct Supabase `roster_annotations`/`roster_links` table ops — fixing the RosterView mount crash (`getTagRegistry`) and making the roster editable. Replaces the `notImplemented` stubs.

**Architecture:** A new `crud.ts` module (merge/prune mirroring `rosterStore.upsert`) + wiring in `webClient.ts`. No Edge Functions (direct table → unaffected by the CORS issue).

**Tech Stack:** TypeScript, React renderer, Vitest, `@supabase/supabase-js`. No new dependencies.

## Global Constraints

- Confined to `src/renderer/src/lib/webClient/` (one new module + tests + edits to `webClient.ts`/`webClient.test.ts`). Do NOT touch `src/main`/`src/shared`/`src/preload`/other-renderer/contract.
- `createWebClient` stays a conformant `AxiClient`; only the six named methods change from `ni(...)`.
- Returns desktop shapes DIRECTLY: `Record<string,string>`/`void`/`RosterAnnotation|null`/`void`/`RosterLink`/`void`. `getTagRegistry` NEVER throws (catch→`{}`). No-supabase wiring returns the empty value / no-ops.
- Renderer→preload import via `../../../../preload/index.d`; reuse `activeWorkspaceId` from `./discordGw2`.
- Run vitest `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` green.

---

### Task 1: `crud.ts` (tags/annotations/links) + wiring

**Files:**
- Create: `src/renderer/src/lib/webClient/crud.ts`, `.../crud.test.ts`
- Modify: `src/renderer/src/lib/webClient/webClient.ts` (+ `webClient.test.ts`)

**Interfaces:**
- Consumes: `SupabaseClient`; `RosterAnnotation`/`RosterAnnotationPatch`/`RosterLink` (`../../../../preload/index.d`); `WebSettings` (`./settings`); `activeWorkspaceId` (`./discordGw2`).
- Produces: `webGetTagRegistry`, `webSetTagRegistry`, `webUpsertAnnotation`, `webRemoveAnnotation`, `webSetLink`, `webRemoveLink`.

- [ ] **Step 1: Write the failing test**

`src/renderer/src/lib/webClient/crud.test.ts`:
```ts
import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  webGetTagRegistry,
  webSetTagRegistry,
  webUpsertAnnotation,
  webRemoveAnnotation,
  webSetLink,
  webRemoveLink
} from './crud'
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

// One chainable builder per table. `.eq()` is chainable AND thenable (for the
// `await …eq()` array reads like workspace_members); `.maybeSingle()` resolves
// `single`; `.upsert`/`.delete` are spies. delete() returns the builder so
// `.delete().eq().eq()` awaits to {error:null}.
function builder(cfg: { single?: unknown; rows?: unknown }) {
  const upsert = vi.fn(async () => ({ error: null }))
  const del = vi.fn(() => b)
  const b: Record<string, unknown> = {}
  Object.assign(b, {
    select: () => b,
    eq: () => b,
    maybeSingle: async () => ({ data: cfg.single ?? null }),
    upsert,
    delete: del,
    then: (res: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: cfg.rows ?? [], error: null }).then(res)
  })
  return b as Record<string, unknown> & { upsert: typeof upsert; delete: typeof del }
}

function fakeSb(builders: Record<string, ReturnType<typeof builder>>): SupabaseClient {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => builders[t]
  } as unknown as SupabaseClient
}

// workspace_members builder for activeWorkspaceId (resolves a membership)
const members = () => builder({ rows: [{ workspace_id: 'w1', role: 'owner' }] })

test('getTagRegistry parses the meta:tags notes JSON', async () => {
  const ann = builder({ single: { notes: '{"core":"#10b981"}' } })
  const r = await webGetTagRegistry(fakeSb({ workspace_members: members(), roster_annotations: ann }), createWebSettings(fakeStorage()))
  expect(r).toEqual({ core: '#10b981' })
})

test('getTagRegistry returns {} on missing/invalid', async () => {
  const ann = builder({ single: null })
  expect(await webGetTagRegistry(fakeSb({ workspace_members: members(), roster_annotations: ann }), createWebSettings(fakeStorage()))).toEqual({})
})

test('setTagRegistry upserts meta:tags with serialized notes', async () => {
  const ann = builder({})
  await webSetTagRegistry(fakeSb({ workspace_members: members(), roster_annotations: ann }), createWebSettings(fakeStorage()), { core: '#10b981' })
  expect(ann.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ member_id: 'meta:tags', notes: JSON.stringify({ core: '#10b981' }) }),
    { onConflict: 'workspace_id,member_id' }
  )
})

test('upsertAnnotation merges a patch and upserts; cleans tags/aliases', async () => {
  const ann = builder({ single: null })
  const r = await webUpsertAnnotation(
    fakeSb({ workspace_members: members(), roster_annotations: ann }),
    createWebSettings(fakeStorage()),
    'm1',
    { notes: 'hi', tags: ['core', 'core', ' trial '] }
  )
  expect(r).toMatchObject({ memberId: 'm1', notes: 'hi', tags: ['core', 'trial'] })
  expect(ann.upsert).toHaveBeenCalled()
})

test('upsertAnnotation that ends up empty deletes the row and returns null', async () => {
  const ann = builder({ single: { member_id: 'm1', notes: 'old' } })
  const r = await webUpsertAnnotation(
    fakeSb({ workspace_members: members(), roster_annotations: ann }),
    createWebSettings(fakeStorage()),
    'm1',
    { notes: '' }
  )
  expect(r).toBeNull()
  expect(ann.delete).toHaveBeenCalled()
})

test('removeAnnotation deletes the row', async () => {
  const ann = builder({})
  await webRemoveAnnotation(fakeSb({ workspace_members: members(), roster_annotations: ann }), createWebSettings(fakeStorage()), 'm1')
  expect(ann.delete).toHaveBeenCalled()
})

test('setLink upserts and returns a RosterLink', async () => {
  const link = builder({})
  const r = await webSetLink(fakeSb({ workspace_members: members(), roster_links: link }), createWebSettings(fakeStorage()), 'Alice.1', 'm1')
  expect(r).toMatchObject({ accountName: 'Alice.1', memberId: 'm1' })
  expect(link.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ account_name: 'Alice.1', member_id: 'm1' }),
    { onConflict: 'workspace_id,account_name' }
  )
})

test('removeLink deletes the row', async () => {
  const link = builder({})
  await webRemoveLink(fakeSb({ workspace_members: members(), roster_links: link }), createWebSettings(fakeStorage()), 'Alice.1')
  expect(link.delete).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run — expect FAIL (missing module)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/crud.test.ts`
Expected: FAIL — cannot find `./crud`.

- [ ] **Step 3: Implement `crud.ts`**

```ts
// src/renderer/src/lib/webClient/crud.ts
// Direct Supabase CRUD for the roster: the tag registry (a reserved meta:tags
// annotation row), member annotations (notes/tags/nickname/etc., with the
// desktop's merge+prune), and account links. No Edge Functions — direct tables.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RosterAnnotation, RosterAnnotationPatch, RosterLink } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { activeWorkspaceId } from './discordGw2'

const ANN = 'roster_annotations'
const LINK = 'roster_links'
const TAGS_KEY = 'meta:tags'
const now = (): string => new Date().toISOString()

function cleanList(xs: unknown): string[] {
  if (!Array.isArray(xs)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs) {
    const s = String(x).trim()
    if (s && !seen.has(s)) {
      seen.add(s)
      out.push(s)
    }
  }
  return out
}

function isEmpty(a: RosterAnnotation): boolean {
  return (
    !a.nickname.trim() &&
    a.aliases.length === 0 &&
    !a.notes.trim() &&
    a.tags.length === 0 &&
    !a.mainAccount.trim()
  )
}

function annRowToAnnotation(r: Record<string, unknown> | null, memberId: string): RosterAnnotation {
  return {
    memberId,
    nickname: typeof r?.nickname === 'string' ? r.nickname : '',
    aliases: Array.isArray(r?.aliases) ? (r!.aliases as string[]) : [],
    notes: typeof r?.notes === 'string' ? r.notes : '',
    tags: Array.isArray(r?.tags) ? (r!.tags as string[]) : [],
    mainAccount: typeof r?.main_account === 'string' ? r.main_account : '',
    createdAt: typeof r?.created_at === 'string' ? r.created_at : now(),
    updatedAt: typeof r?.updated_at === 'string' ? r.updated_at : now()
  }
}

function annotationToRow(ws: string, a: RosterAnnotation): Record<string, unknown> {
  return {
    workspace_id: ws,
    member_id: a.memberId,
    nickname: a.nickname,
    aliases: a.aliases,
    notes: a.notes,
    tags: a.tags,
    main_account: a.mainAccount,
    created_at: a.createdAt,
    updated_at: a.updatedAt
  }
}

export async function webGetTagRegistry(
  sb: SupabaseClient,
  settings: WebSettings
): Promise<Record<string, string>> {
  try {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) return {}
    const { data } = await sb
      .from(ANN)
      .select('notes')
      .eq('workspace_id', ws)
      .eq('member_id', TAGS_KEY)
      .maybeSingle()
    const notes = (data as { notes?: unknown } | null)?.notes
    if (typeof notes !== 'string') return {}
    const m = JSON.parse(notes)
    return m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export async function webSetTagRegistry(
  sb: SupabaseClient,
  settings: WebSettings,
  map: Record<string, string>
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  await sb.from(ANN).upsert(
    { workspace_id: ws, member_id: TAGS_KEY, notes: JSON.stringify(map ?? {}), updated_at: now() },
    { onConflict: 'workspace_id,member_id' }
  )
}

export async function webUpsertAnnotation(
  sb: SupabaseClient,
  settings: WebSettings,
  memberId: string,
  patch: RosterAnnotationPatch
): Promise<RosterAnnotation | null> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return null
  const { data } = await sb.from(ANN).select('*').eq('workspace_id', ws).eq('member_id', memberId).maybeSingle()
  const rec = annRowToAnnotation((data ?? null) as Record<string, unknown> | null, memberId)
  if (patch.nickname !== undefined) rec.nickname = patch.nickname.trim()
  if (patch.aliases !== undefined) rec.aliases = cleanList(patch.aliases)
  if (patch.notes !== undefined) rec.notes = patch.notes
  if (patch.tags !== undefined) rec.tags = cleanList(patch.tags)
  if (patch.mainAccount !== undefined) rec.mainAccount = patch.mainAccount.trim()
  rec.updatedAt = now()
  if (isEmpty(rec)) {
    await sb.from(ANN).delete().eq('workspace_id', ws).eq('member_id', memberId)
    return null
  }
  await sb.from(ANN).upsert(annotationToRow(ws, rec), { onConflict: 'workspace_id,member_id' })
  return rec
}

export async function webRemoveAnnotation(
  sb: SupabaseClient,
  settings: WebSettings,
  memberId: string
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  await sb.from(ANN).delete().eq('workspace_id', ws).eq('member_id', memberId)
}

export async function webSetLink(
  sb: SupabaseClient,
  settings: WebSettings,
  accountName: string,
  memberId: string
): Promise<RosterLink> {
  const createdAt = now()
  const ws = await activeWorkspaceId(sb, settings)
  if (ws) {
    await sb.from(LINK).upsert(
      { workspace_id: ws, account_name: accountName, member_id: memberId, created_at: createdAt },
      { onConflict: 'workspace_id,account_name' }
    )
  }
  return { accountName, memberId, createdAt }
}

export async function webRemoveLink(
  sb: SupabaseClient,
  settings: WebSettings,
  accountName: string
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  await sb.from(LINK).delete().eq('workspace_id', ws).eq('account_name', accountName)
}
```

- [ ] **Step 4: Run — expect PASS (8 tests)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/crud.test.ts`
Expected: PASS. (If the chainable `builder` mock needs a tweak for a specific chain, adjust the mock — NOT the module semantics.)

- [ ] **Step 5: Wire the six methods in `webClient.ts`**

1. Add import: `import { webGetTagRegistry, webSetTagRegistry, webUpsertAnnotation, webRemoveAnnotation, webSetLink, webRemoveLink } from './crud'`.
2. Replace the six `ni(...)` stubs:
   ```ts
   getTagRegistry: async () => (deps.supabase ? webGetTagRegistry(deps.supabase, settings) : {}),
   setTagRegistry: async (map) => {
     if (deps.supabase) await webSetTagRegistry(deps.supabase, settings, map)
   },
   upsertAnnotation: async (memberId, patch) =>
     deps.supabase ? webUpsertAnnotation(deps.supabase, settings, memberId, patch) : null,
   removeAnnotation: async (memberId) => {
     if (deps.supabase) await webRemoveAnnotation(deps.supabase, settings, memberId)
   },
   setLink: async (accountName, memberId) =>
     deps.supabase
       ? webSetLink(deps.supabase, settings, accountName, memberId)
       : { accountName, memberId, createdAt: new Date().toISOString() },
   removeLink: async (accountName) => {
     if (deps.supabase) await webRemoveLink(deps.supabase, settings, accountName)
   },
   ```
   Leave every other `ni(...)` method unchanged.

- [ ] **Step 6: Add `webClient.test.ts` smoke**

```ts
test('roster CRUD reads no-op safely without supabase', async () => {
  const c = createWebClient({ storage: fakeStorage() })
  expect(await c.getTagRegistry()).toEqual({})
  expect(await c.upsertAnnotation('m1', { notes: 'x' })).toBeNull()
  await expect(c.removeAnnotation('m1')).resolves.toBeUndefined()
})
```

- [ ] **Step 7: Run web-client suite + full suite + typecheck**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/`
Expected: PASS.

Run: `npm test` → all pass. Run: `npm run typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/lib/webClient
git commit -m "feat(web): roster CRUD — tag registry + annotations + links"
```

---

## Self-Review Notes

- **Spec coverage:** tag registry read/write via the `meta:tags` row (Step 3); annotation merge/prune mirroring `rosterStore.upsert` (`cleanList`/`isEmpty`/patch-apply/delete-when-empty); link upsert/delete; all via `activeWorkspaceId`; wired in `webClient.ts` with no-supabase guards (Step 5); tests for parse/{}, serialize, merge+clean, empty→delete→null, removes, link upsert (Step 1). Other methods stay `ni(...)`; `src/main`/`src/shared`/`src/preload` untouched.
- **Fixes the crash:** `getTagRegistry` resolves a `Promise<{}>` (never throws) — RosterView's `client.getTagRegistry().then(...)` no longer hits a synchronous `notImplemented` throw.
- **Type consistency:** returns match `AxiRosterApi` (`Record<string,string>`/`void`/`RosterAnnotation|null`/`void`/`RosterLink`/`void`). Row mapping matches the desktop `annToRow`/`rowToAnn` (`main_account` column).
- **Direct-table (no CORS):** these never call an Edge Function, so they work in the browser independent of the separate Edge-Function CORS fix.
