import { test, expect, vi } from 'vitest'
import { migrateAuditToSupabase, migrateRetentionToSupabase } from './migrateLocalToSupabase'
import type { AuditEvent } from './auditNormalize'

function ev(uid: string): AuditEvent {
  return { uid, source: 'gw2', id: uid.split(':')[1], time: '2026-06-20T00:00:00Z', type: 't', summary: uid, raw: null }
}

test('audit backfill pushes local events once, then is a no-op', async () => {
  const target = { mergeConfirmed: vi.fn().mockResolvedValue(true) }
  const local = { list: () => [ev('gw2:1'), ev('gw2:2')] }
  const settings = new Map<string, string>()
  const deps = {
    workspaceId: 'WS1', target: target as never, local: local as never,
    getSetting: (k: string) => settings.get(k) ?? null,
    setSetting: (k: string, v: string) => void settings.set(k, v)
  }
  expect(await migrateAuditToSupabase(deps)).toBe(2)
  expect(target.mergeConfirmed).toHaveBeenCalledTimes(1)
  expect(await migrateAuditToSupabase(deps)).toBe(0) // marker set -> skipped
  expect(target.mergeConfirmed).toHaveBeenCalledTimes(1)
})

test('audit backfill ignores v1 markers — v1 may have pushed the wrong guild', async () => {
  // Before the workspace/guild containment guard, the v1 migrate could run while
  // a DIFFERENT guild was active and push that guild's file into this workspace.
  // The v2 marker restarts everyone once under the guard; upserts dedupe repeats.
  const target = { mergeConfirmed: vi.fn().mockResolvedValue(true) }
  const local = { list: () => [ev('gw2:1')] }
  const settings = new Map<string, string>([['migratedAudit:WS1', '2026-06-29T00:00:00Z']])
  const deps = {
    workspaceId: 'WS1', target: target as never, local: local as never,
    getSetting: (k: string) => settings.get(k) ?? null,
    setSetting: (k: string, v: string) => void settings.set(k, v)
  }
  expect(await migrateAuditToSupabase(deps)).toBe(1)
  expect(target.mergeConfirmed).toHaveBeenCalledTimes(1)
  expect([...settings.keys()].some((k) => k.startsWith('migratedAudit2:'))).toBe(true)
})

test('audit backfill leaves the marker unset when the cloud push fails', async () => {
  // The one-shot marker must only be burned by a CONFIRMED push — a swallowed
  // upsert failure would otherwise block the history from ever migrating.
  const target = { mergeConfirmed: vi.fn().mockResolvedValue(false) }
  const local = { list: () => [ev('gw2:1')] }
  const settings = new Map<string, string>()
  const deps = {
    workspaceId: 'WS1', target: target as never, local: local as never,
    getSetting: (k: string) => settings.get(k) ?? null,
    setSetting: (k: string, v: string) => void settings.set(k, v)
  }
  expect(await migrateAuditToSupabase(deps)).toBe(0)
  expect(settings.size).toBe(0) // marker not set -> next workspace connect retries
  target.mergeConfirmed.mockResolvedValue(true)
  expect(await migrateAuditToSupabase(deps)).toBe(1)
  expect([...settings.keys()]).toEqual(['migratedAudit2:WS1'])
})

test('retention backfill leaves the marker unset when the cloud push fails', async () => {
  const target = { appendConfirmed: vi.fn().mockResolvedValue(false) }
  const local = { list: () => [{ date: '2026-06-20', memberKey: 'A', score: 0.5, tier: 't' }] }
  const settings = new Map<string, string>()
  const deps = {
    workspaceId: 'WS1', target: target as never, local: local as never,
    getSetting: (k: string) => settings.get(k) ?? null,
    setSetting: (k: string, v: string) => void settings.set(k, v)
  }
  expect(await migrateRetentionToSupabase(deps)).toBe(0)
  expect(settings.size).toBe(0)
})

test('retention backfill pushes local rows once, then is a no-op', async () => {
  const target = { appendConfirmed: vi.fn().mockResolvedValue(true) }
  const local = { list: () => [{ date: '2026-06-20', memberKey: 'A', score: 0.5, tier: 't' }] }
  const settings = new Map<string, string>()
  const deps = {
    workspaceId: 'WS1', target: target as never, local: local as never,
    getSetting: (k: string) => settings.get(k) ?? null,
    setSetting: (k: string, v: string) => void settings.set(k, v)
  }
  expect(await migrateRetentionToSupabase(deps)).toBe(1)
  expect(await migrateRetentionToSupabase(deps)).toBe(0)
  expect(target.appendConfirmed).toHaveBeenCalledTimes(1)
})
