import { test, expect, vi } from 'vitest'
import { SupabaseAuditRepo } from './supabaseAuditRepo'
import type { AuditEvent } from '../auditNormalize'

function ev(uid: string, source: 'gw2' | 'discord', time: string, extra: Partial<AuditEvent> = {}): AuditEvent {
  return { uid, source, id: uid.split(':')[1], time, type: 't', summary: `s-${uid}`, raw: null, ...extra }
}

// Minimal fake just for the synchronous cache paths; network calls are stubbed.
function repo(): SupabaseAuditRepo {
  const client = { from: () => ({ upsert: vi.fn().mockResolvedValue({ error: null }) }) } as never
  return new SupabaseAuditRepo({ url: 'u', anonKey: 'a', workspaceId: 'WS1' }, client)
}

test('merge dedupes by uid and serves newest-first from cache', () => {
  const r = repo()
  expect(r.merge([ev('gw2:1', 'gw2', '2026-06-20T00:00:00Z'), ev('gw2:2', 'gw2', '2026-06-22T00:00:00Z')])).toBe(2)
  expect(r.merge([ev('gw2:2', 'gw2', '2026-06-22T00:00:00Z')])).toBe(0)
  expect(r.list().map((e) => e.uid)).toEqual(['gw2:2', 'gw2:1'])
})

test('list filters by source, type, search, and limit', () => {
  const r = repo()
  r.merge([
    ev('gw2:1', 'gw2', '2026-06-20T00:00:00Z', { actor: 'Alice', type: 'joined' }),
    ev('discord:9', 'discord', '2026-06-21T00:00:00Z', { actor: 'Bob', type: 'kick', summary: 'Bob kicked' })
  ])
  expect(r.list({ source: 'discord' }).map((e) => e.uid)).toEqual(['discord:9'])
  expect(r.list({ type: 'joined' }).map((e) => e.uid)).toEqual(['gw2:1'])
  expect(r.list({ search: 'bob' }).map((e) => e.uid)).toEqual(['discord:9'])
  expect(r.list({ limit: 1 }).length).toBe(1)
})

test('cursors are read/written through the cache', () => {
  const r = repo()
  r.setCursors({ gw2LastLogId: 7 })
  r.setCursors({ discordLastId: '5' })
  expect(r.getCursors()).toEqual({ gw2LastLogId: 7, discordLastId: '5' })
})

test('counts splits by source', () => {
  const r = repo()
  r.merge([ev('gw2:1', 'gw2', '2026-06-20T00:00:00Z'), ev('discord:9', 'discord', '2026-06-21T00:00:00Z')])
  expect(r.counts()).toEqual({ gw2: 1, discord: 1 })
})
