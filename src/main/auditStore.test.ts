import { test, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AuditStore, MAX_EVENTS } from './auditStore'
import type { AuditEvent } from './auditNormalize'

const dirs: string[] = []
function tmpFile(): string {
  const d = mkdtempSync(join(tmpdir(), 'audit-'))
  dirs.push(d)
  return join(d, 'sub', 'log.json') // nested dir must be created on flush
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function ev(uid: string, time: string, over: Partial<AuditEvent> = {}): AuditEvent {
  return { uid, source: 'gw2', id: uid, time, type: 'joined', summary: uid, raw: {}, ...over }
}

test('merge dedupes by uid and sorts newest-first', () => {
  const s = new AuditStore(tmpFile())
  expect(s.merge([ev('a', '2026-01-01T00:00:00Z'), ev('b', '2026-01-03T00:00:00Z')])).toBe(2)
  expect(s.merge([ev('b', '2026-01-03T00:00:00Z'), ev('c', '2026-01-02T00:00:00Z')])).toBe(1)
  expect(s.list().map((e) => e.uid)).toEqual(['b', 'c', 'a'])
})

test('list filters by source, type and search', () => {
  const s = new AuditStore(tmpFile())
  s.merge([
    ev('a', '2026-01-03T00:00:00Z', { source: 'gw2', summary: 'Bob joined' }),
    ev('b', '2026-01-02T00:00:00Z', { source: 'discord', type: 'member_kick', summary: 'Bob kicked' }),
    ev('c', '2026-01-01T00:00:00Z', { source: 'discord', type: 'member_join', summary: 'Sue joined' })
  ])
  expect(s.list({ source: 'discord' }).map((e) => e.uid)).toEqual(['b', 'c'])
  expect(s.list({ type: 'member_join' }).map((e) => e.uid)).toEqual(['c'])
  expect(s.list({ search: 'bob' }).map((e) => e.uid)).toEqual(['a', 'b'])
  expect(s.list({ limit: 1 }).map((e) => e.uid)).toEqual(['a'])
})

test('merge enforces the 50k rolling cap, keeping newest', () => {
  const s = new AuditStore(tmpFile())
  const many: AuditEvent[] = []
  for (let i = 0; i < MAX_EVENTS + 10; i++) {
    many.push(ev(`e${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()))
  }
  s.merge(many)
  const all = s.list({ limit: MAX_EVENTS + 100 })
  expect(all.length).toBe(MAX_EVENTS)
  expect(all[0].uid).toBe(`e${MAX_EVENTS + 9}`) // newest survived
})

test('cursors round-trip and persist across reloads', () => {
  const path = tmpFile()
  const s = new AuditStore(path)
  s.setCursors({ gw2LastLogId: 99 })
  s.setCursors({ discordLastId: '123' })
  s.flush()
  expect(new AuditStore(path).getCursors()).toEqual({ gw2LastLogId: 99, discordLastId: '123' })
})

test('a corrupt file is treated as empty, never throws', () => {
  const d = mkdtempSync(join(tmpdir(), 'audit-'))
  dirs.push(d)
  const path = join(d, 'log.json')
  writeFileSync(path, '{ this is not json')
  const s = new AuditStore(path)
  expect(s.list()).toEqual([])
  expect(s.getCursors()).toEqual({})
})
