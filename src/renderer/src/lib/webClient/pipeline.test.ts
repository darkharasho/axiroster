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
