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
    }),
    counts: () => ({
      gw2: merged.filter((e) => e.source === 'gw2').length,
      discord: merged.filter((e) => e.source === 'discord').length
    }),
    lastUpdated: () => ''
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

test('pullDiscord pages until a short page is received', async () => {
  // Build two pages: first has 200 rows (ids 1..200), second has 1 row (id 201).
  const page1 = Array.from({ length: 200 }, (_, i) => ({
    id: i + 1,
    created_at: 't',
    event_type: 'member_join',
    target_name: `User${i + 1}`
  }))
  const page2 = [{ id: 201, created_at: 't', event_type: 'member_join', target_name: 'User201' }]

  const auditDiscord = vi.fn()
    .mockResolvedValueOnce(page1)
    .mockResolvedValueOnce(page2)

  const { deps, store } = makeDeps({
    gw2GuildId: () => null,
    axitools: () => ({ auditDiscord }) as never
  })
  const sync = new AuditSync(deps)
  const added = await sync.refresh()

  // Called twice (paged)
  expect(auditDiscord).toHaveBeenCalledTimes(2)
  // All 201 rows were merged
  expect(added).toBe(201)
  expect(store.merged).toHaveLength(201)
  // Final cursor is the max id across both pages
  expect(store.getCursors().discordLastId).toBe('201')
  // No errors
  expect(deps.onError).not.toHaveBeenCalled()
})

test('emits per-source status: skipped, ok, and error', async () => {
  const statuses: import('./auditSync').AuditStatus[] = []
  // GW2 skipped (no guild id), Discord errors.
  const { deps } = makeDeps({
    gw2GuildId: () => null,
    axitools: () => ({ auditDiscord: vi.fn(async () => { throw new Error('bot down') }) }) as never,
    onStatus: (s) => statuses.push(s)
  })
  const sync = new AuditSync(deps)
  await sync.refresh()

  const final = sync.getStatus()
  expect(final.gw2.state).toBe('skipped')
  expect(final.discord.state).toBe('error')
  expect(final.discord.error).toBe('bot down')
  expect(final.running).toBe(false)
  // onStatus fired during the pass (at least running-true, then per-source updates).
  expect(statuses.length).toBeGreaterThan(0)
  expect(statuses.some((s) => s.running)).toBe(true)
})

test('status counts reflect merged events per source', async () => {
  const { deps } = makeDeps()
  const sync = new AuditSync(deps)
  await sync.refresh()
  const s = sync.getStatus()
  expect(s.gw2).toMatchObject({ state: 'ok', count: 1 })
  expect(s.discord).toMatchObject({ state: 'ok', count: 1 })
})
