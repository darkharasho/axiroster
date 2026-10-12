// src/main/sync/supabaseSync.test.ts
import { test, expect } from 'vitest'
import { rowToMember, SupabaseSyncProvider } from './supabaseSync'

test('rowToMember maps payload + member_id', () => {
  const m = rowToMember({ member_id: 'A.1', payload: { rank: 'Member' } })
  expect(m).toEqual({ memberId: 'A.1', payload: { rank: 'Member' } })
})

test('a stopped provider is inert: no events out, no writes in', async () => {
  const events: unknown[] = []
  const p = new SupabaseSyncProvider(
    { url: 'http://127.0.0.1:1', anonKey: 'anon', workspaceId: 'ws-old' },
    (e) => events.push(e)
  )
  await p.stop()
  // A late backfill/realtime row for the old workspace must not reach the stores.
  ;(p as unknown as { emit: (e: unknown) => void }).emit({ kind: 'annotation:remove', memberId: 'meta:pipeline' })
  expect(events).toEqual([])
  // Writes resolve without touching the network (the URL above is unreachable).
  const ann = { memberId: 'meta:pipeline', nickname: '', aliases: [], notes: '{}', tags: [], mainAccount: '', createdAt: '', updatedAt: '' }
  await expect(p.pushAnnotation(ann)).resolves.toBeUndefined()
  await expect(p.removeAnnotation('meta:pipeline')).resolves.toBeUndefined()
})

function withFakeClient(from: (t: string) => unknown): SupabaseSyncProvider {
  const p = new SupabaseSyncProvider({ url: 'http://127.0.0.1:1', anonKey: 'anon', workspaceId: 'ws1' }, () => {})
  ;(p as unknown as { client: unknown }).client = { from }
  return p
}
const ann = { memberId: 'departure:a.1', nickname: '', aliases: [], notes: '{}', tags: [], mainAccount: '', createdAt: '', updatedAt: '' }

test('pushAnnotation throws when the server rejects the upsert', async () => {
  const p = withFakeClient(() => ({ upsert: async () => ({ error: { message: 'permission denied' } }) }))
  await expect(p.pushAnnotation(ann)).rejects.toThrow('permission denied')
})

test('listAnnotationsLike pages an ordered prefix read', async () => {
  const pages = [Array.from({ length: 1000 }, (_, i) => ({ member_id: `departure:x${i}` })), [{ member_id: 'departure:z' }]]
  const calls: unknown[][] = []
  const b: Record<string, unknown> = {}
  Object.assign(b, {
    select: () => b,
    eq: () => b,
    like: (...a: unknown[]) => { calls.push(['like', ...a]); return b },
    order: (...a: unknown[]) => { calls.push(['order', ...a]); return b },
    range: async (from: number, to: number) => {
      calls.push(['range', from, to])
      return { data: pages[from / 1000] ?? [], error: null }
    }
  })
  const rows = await withFakeClient(() => b).listAnnotationsLike('departure:')
  expect(rows).toHaveLength(1001)
  expect(calls).toContainEqual(['like', 'member_id', 'departure:%'])
  expect(calls).toContainEqual(['order', 'member_id', { ascending: true }])
  expect(calls).toContainEqual(['range', 1000, 1999])
})

test('listAnnotationsLike throws on a failed read so callers fall back', async () => {
  const b: Record<string, unknown> = {}
  Object.assign(b, { select: () => b, eq: () => b, like: () => b, order: () => b, range: async () => ({ data: null, error: { message: 'down' } }) })
  await expect(withFakeClient(() => b).listAnnotationsLike('departure:')).rejects.toThrow('down')
})
