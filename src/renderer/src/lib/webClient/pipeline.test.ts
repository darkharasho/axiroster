import { test, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  webPipelineGet,
  webPipelineSetPlacement,
  webPipelineAddProspect,
  webPipelineVote,
  webPipelineRemoveProspect,
  webPipelineLinkProspect,
  webPipelineSetStages,
  webPipelineArchivePassed,
  webPipelineAddComment,
  webPipelineGetComments,
  webPipelineEditComment,
  webPipelineDeleteComment
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

// In-memory roster_annotations keyed by member_id, plus workspace_members rows
// keyed as 'wm:<userId>' in the initial map. Supports select/eq/maybeSingle/upsert/delete.
// workspace_members rows have shape { workspace_id, role, user_id }.
function fakeSb(initial: Record<string, Record<string, unknown>> = {}) {
  // Separate wm: entries (workspace_members) from ann entries (roster_annotations)
  const wmRows = new Map<string, Record<string, unknown>>()
  const annInitial: [string, Record<string, unknown>][] = []
  for (const [k, v] of Object.entries(initial)) {
    if (k.startsWith('wm:')) wmRows.set(k.slice(3), v)
    else annInitial.push([k, v])
  }
  // Default workspace_members entry for u1 as owner if none specified
  if (!wmRows.has('u1')) wmRows.set('u1', { workspace_id: 'w1', role: 'owner', user_id: 'u1' })
  const ann = new Map<string, Record<string, unknown>>(annInitial)
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
      delete: () => {
        let pendingMid: string | null = null
        const doDelete = () => {
          if (pendingMid !== null) {
            deletes.push(pendingMid)
            ann.delete(pendingMid)
          }
          return { error: null }
        }
        const eqChain: Record<string, unknown> = {}
        Object.assign(eqChain, {
          eq: (col: string, val: unknown) => {
            if (col === 'member_id') pendingMid = String(val)
            return Object.assign({
              eq: (col2: string, val2: unknown) => {
                if (col2 === 'member_id') pendingMid = String(val2)
                return { then: (r: (v: unknown) => unknown) => Promise.resolve(doDelete()).then(r) }
              },
              then: (r: (v: unknown) => unknown) => Promise.resolve(doDelete()).then(r)
            })
          }
        })
        return eqChain
      },
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
              eq: (_col: string, userId: unknown) => {
                const row = wmRows.get(String(userId))
                return Promise.resolve({ data: row ? [row] : [] })
              }
            })
          }
        : annBuilder()
  } as unknown as SupabaseClient
  return { sb, ann, upserts, deletes, wmRows }
}

// Wrap fakeSb so tests can control the acting user (id + user_metadata) and
// ensure a workspace_members row exists for them (for resolveEffectiveWorkspace).
function fakeSbWithUser(
  userId: string,
  role: string,
  initial: Record<string, Record<string, unknown>> = {}
) {
  // Ensure a workspace_members row for this user is in the initial map
  const withMember = {
    ...initial,
    [`wm:${userId}`]: { workspace_id: 'w1', role, user_id: userId }
  }
  const result = fakeSb(withMember)
  // Override auth.getUser to return the specified user with user_metadata
  ;(result.sb as unknown as Record<string, unknown>).auth = {
    getUser: async () => ({
      data: { user: { id: userId, user_metadata: { full_name: 'Tester' } } }
    })
  }
  return result.sb
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

test('setStages writes new stages and keeps placement', async () => {
  const { sb, ann } = fakeSb({
    'meta:pipeline': { member_id: 'meta:pipeline', notes: JSON.stringify({ stages: [{ id: 'old' }], placement: { x: 'old' }, placedAt: {} }) }
  })
  await webPipelineSetStages(sb, settings(), [{ id: 'applied', label: 'Applied' }])
  const doc = JSON.parse(String(ann.get('meta:pipeline')!.notes))
  expect(doc.stages).toEqual([{ id: 'applied', label: 'Applied' }])
  expect(doc.placement).toEqual({ x: 'old' })
})

test('archivePassed removes declined-stage placements and purges votes', async () => {
  const { sb, ann } = fakeSb({
    'meta:pipeline': {
      member_id: 'meta:pipeline',
      notes: JSON.stringify({
        stages: [{ id: 'applied', type: 'active' }, { id: 'rejected', type: 'declined' }],
        placement: { 'prospect:p1': 'rejected', 'prospect:p2': 'applied' },
        placedAt: { 'prospect:p1': 't', 'prospect:p2': 't' }
      })
    },
    'vote:u1': { member_id: 'vote:u1', notes: JSON.stringify({ 'prospect:p1': 'no', 'prospect:p2': 'yes' }) }
  })
  await webPipelineArchivePassed(sb, settings())
  const doc = JSON.parse(String(ann.get('meta:pipeline')!.notes))
  expect(doc.placement).toEqual({ 'prospect:p2': 'applied' })
  expect(JSON.parse(String(ann.get('vote:u1')!.notes))).toEqual({ 'prospect:p2': 'yes' })
})

test('web: add then get comment round-trips with server-derived author', async () => {
  const s = createWebSettings(fakeStorage())
  s.set('activeGuildId', 'w1')
  const sb = fakeSbWithUser('u1', 'member')
  const added = await webPipelineAddComment(sb, s, 'prospect:1', 'hello')
  expect(added?.authorId).toBe('u1')
  expect(added?.authorName).toBe('Tester')
  const list = await webPipelineGetComments(sb, s, 'prospect:1')
  expect(list.map((c) => c.body)).toEqual(['hello'])
})

test('web: edit by non-author is rejected', async () => {
  const s = createWebSettings(fakeStorage())
  s.set('activeGuildId', 'w1')
  const sb = fakeSbWithUser('u1', 'member')
  const added = await webPipelineAddComment(sb, s, 'prospect:1', 'mine')
  // switch the acting user to u2 (member, no membership row — no workspace found → isOwner=false)
  ;(sb as unknown as Record<string, unknown>).auth = {
    getUser: async () => ({ data: { user: { id: 'u2', user_metadata: {} } } })
  }
  const edited = await webPipelineEditComment(sb, s, added!.id, 'hacked')
  expect(edited).toBeNull()
})

test('web: owner may delete another user comment', async () => {
  const s = createWebSettings(fakeStorage())
  s.set('activeGuildId', 'w1')
  // Pre-populate wmRows for both u1 (member, comment author) and owner1 (owner, deleter)
  const { sb, wmRows } = fakeSb({ 'wm:u1': { workspace_id: 'w1', role: 'member', user_id: 'u1' } })
  wmRows.set('owner1', { workspace_id: 'w1', role: 'owner', user_id: 'owner1' })
  // Start as u1 to add the comment
  ;(sb as unknown as Record<string, unknown>).auth = {
    getUser: async () => ({ data: { user: { id: 'u1', user_metadata: { full_name: 'Tester' } } } })
  }
  const added = await webPipelineAddComment(sb, s, 'prospect:1', 'theirs')
  // Switch to owner1 to delete
  ;(sb as unknown as Record<string, unknown>).auth = {
    getUser: async () => ({ data: { user: { id: 'owner1', user_metadata: {} } } })
  }
  await webPipelineDeleteComment(sb, s, added!.id)
  const list = await webPipelineGetComments(sb, s, 'prospect:1')
  expect(list).toEqual([])
})
