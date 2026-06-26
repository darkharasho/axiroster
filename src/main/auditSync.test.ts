import { test, expect, vi } from 'vitest'
import { AuditSync, type AuditSyncDeps } from './auditSync'
import type { AuditEvent } from './auditNormalize'

function fakeStore() {
  const merged: AuditEvent[] = []
  let cursors: { gw2LastLogId?: number; discordLastId?: string } = {}
  return {
    merged,
    getCursors: () => cursors,
    setCursors: (p: typeof cursors) => {
      cursors = { ...cursors, ...p }
    },
    merge: vi.fn((evs: AuditEvent[]) => {
      merged.push(...evs)
      return evs.length
    })
  }
}

function makeDeps(over: Partial<AuditSyncDeps> = {}): { deps: AuditSyncDeps; store: ReturnType<typeof fakeStore> } {
  const store = fakeStore()
  const deps: AuditSyncDeps = {
    store: store as unknown as AuditSyncDeps['store'],
    gw2: () => ({ guildLog: vi.fn(async () => [{ id: 5, time: 't', type: 'joined', user: 'A.1' }]) }) as never,
    axitools: () =>
      ({ auditDiscord: vi.fn(async () => [{ id: 9, created_at: 't', event_type: 'member_join', target_name: 'B' }]) }) as never,
    gw2GuildId: () => 'gw2-guild',
    discordGuildId: () => 'discord-guild',
    onUpdated: vi.fn(),
    onError: vi.fn(),
    ...over
  }
  return { deps, store }
}

test('refresh pulls both sources, merges, advances cursors, and notifies', async () => {
  const { deps, store } = makeDeps()
  const sync = new AuditSync(deps)
  const added = await sync.refresh()
  expect(added).toBe(2)
  expect(store.merged.map((e) => e.uid).sort()).toEqual(['discord:9', 'gw2:5'])
  expect(store.getCursors()).toEqual({ gw2LastLogId: 5, discordLastId: '9' })
  expect(deps.onUpdated).toHaveBeenCalledOnce()
})

test('a GW2 failure does not block the Discord pull', async () => {
  const { deps, store } = makeDeps({
    gw2: () => ({ guildLog: vi.fn(async () => { throw new Error('GW2 down') }) }) as never
  })
  const sync = new AuditSync(deps)
  const added = await sync.refresh()
  expect(added).toBe(1)
  expect(store.merged.map((e) => e.uid)).toEqual(['discord:9'])
  expect(deps.onError).toHaveBeenCalledWith('GW2 down')
})

test('a source with no guild id is skipped silently', async () => {
  const { deps, store } = makeDeps({ gw2GuildId: () => null })
  const sync = new AuditSync(deps)
  await sync.refresh()
  expect(store.merged.map((e) => e.uid)).toEqual(['discord:9'])
  expect(deps.onError).not.toHaveBeenCalled()
})
