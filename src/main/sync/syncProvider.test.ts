// src/main/sync/syncProvider.test.ts
import { test, expect } from 'vitest'
import { LocalSyncProvider } from './syncProvider'
import type { SyncEvent } from './syncProvider'

test('member:upsert is a valid SyncEvent shape', () => {
  const e: SyncEvent = { kind: 'member:upsert', record: { memberId: 'A.1', payload: {} } }
  expect(e.kind).toBe('member:upsert')
})

test('LocalSyncProvider stays a no-op', async () => {
  const p = new LocalSyncProvider()
  await p.start()
  expect(p.status).toBe('disabled')
})
