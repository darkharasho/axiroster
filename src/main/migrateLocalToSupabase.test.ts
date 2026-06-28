import { test, expect, vi } from 'vitest'
import { migrateAuditToSupabase, migrateRetentionToSupabase } from './migrateLocalToSupabase'
import type { AuditEvent } from './auditNormalize'

function ev(uid: string): AuditEvent {
  return { uid, source: 'gw2', id: uid.split(':')[1], time: '2026-06-20T00:00:00Z', type: 't', summary: uid, raw: null }
}

test('audit backfill pushes local events once, then is a no-op', async () => {
  const target = { merge: vi.fn().mockReturnValue(1) }
  const local = { list: () => [ev('gw2:1'), ev('gw2:2')] }
  const settings = new Map<string, string>()
  const deps = {
    workspaceId: 'WS1', target: target as never, local: local as never,
    getSetting: (k: string) => settings.get(k) ?? null,
    setSetting: (k: string, v: string) => void settings.set(k, v)
  }
  expect(await migrateAuditToSupabase(deps)).toBe(2)
  expect(target.merge).toHaveBeenCalledTimes(1)
  expect(await migrateAuditToSupabase(deps)).toBe(0) // marker set -> skipped
  expect(target.merge).toHaveBeenCalledTimes(1)
})

test('retention backfill pushes local rows once, then is a no-op', async () => {
  const target = { append: vi.fn() }
  const local = { list: () => [{ date: '2026-06-20', memberKey: 'A', score: 0.5, tier: 't' }] }
  const settings = new Map<string, string>()
  const deps = {
    workspaceId: 'WS1', target: target as never, local: local as never,
    getSetting: (k: string) => settings.get(k) ?? null,
    setSetting: (k: string, v: string) => void settings.set(k, v)
  }
  expect(await migrateRetentionToSupabase(deps)).toBe(1)
  expect(await migrateRetentionToSupabase(deps)).toBe(0)
  expect(target.append).toHaveBeenCalledTimes(1)
})
