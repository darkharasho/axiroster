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
