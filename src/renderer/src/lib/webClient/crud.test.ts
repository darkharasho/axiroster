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
