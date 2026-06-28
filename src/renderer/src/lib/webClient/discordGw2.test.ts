import { test, expect, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  invokeAxitools,
  webAxitoolsListGuilds,
  webBoundGw2Guilds,
  webDiscordAction,
  webGw2AccountInfo
} from './discordGw2'
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

function sbWith(opts: {
  invoke?: ReturnType<typeof vi.fn>
  userId?: string | null
  memberships?: { workspace_id: string; role: string }[]
}): SupabaseClient {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } }))
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(async () => ({ data: opts.memberships ?? [] })) }))
    })),
    functions: { invoke: opts.invoke ?? vi.fn(async () => ({ data: { data: [] }, error: null })) }
  } as unknown as SupabaseClient
}

afterEach(() => vi.unstubAllGlobals())

test('invokeAxitools maps success {data:{data:X}} to ok(X)', async () => {
  const invoke = vi.fn(async () => ({ data: { data: [{ id: '1', name: 'G' }] }, error: null }))
  const r = await invokeAxitools(sbWith({ invoke }), { op: 'listGuilds', key: 'k' })
  expect(r).toEqual({ ok: true, data: [{ id: '1', name: 'G' }] })
})

test('invokeAxitools maps an error (with context.json) to fail(code)', async () => {
  const invoke = vi.fn(async () => ({
    data: null,
    error: { message: 'non-2xx', context: { json: async () => ({ error: 'no_key' }) } }
  }))
  const r = await invokeAxitools(sbWith({ invoke }), { op: 'listGuilds', workspaceId: 'w1' })
  expect(r).toEqual({ ok: false, error: 'no_key' })
})

test('invokeAxitools falls back to error.message without context', async () => {
  const invoke = vi.fn(async () => ({ data: null, error: { message: 'boom' } }))
  const r = await invokeAxitools(sbWith({ invoke }), { op: 'listGuilds', workspaceId: 'w1' })
  expect(r).toEqual({ ok: false, error: 'boom' })
})

test('axitoolsListGuilds validation mode sends key, no workspaceId', async () => {
  const invoke = vi.fn(async () => ({ data: { data: [] }, error: null }))
  await webAxitoolsListGuilds(sbWith({ invoke }), createWebSettings(fakeStorage()), 'mykey')
  expect(invoke).toHaveBeenCalledWith('axitools', { body: { op: 'listGuilds', key: 'mykey' } })
})

test('axitoolsListGuilds stored mode resolves the active workspace', async () => {
  const invoke = vi.fn(async () => ({ data: { data: [] }, error: null }))
  const sb = sbWith({ invoke, userId: 'u1', memberships: [{ workspace_id: 'w9', role: 'owner' }] })
  await webAxitoolsListGuilds(sb, createWebSettings(fakeStorage()))
  expect(invoke).toHaveBeenCalledWith('axitools', { body: { op: 'listGuilds', workspaceId: 'w9' } })
})

test('boundGw2Guilds parses the guild-roles map via the shared adapter', async () => {
  const GUID = 'ABCDEF01-2345-6789-ABCD-EF0123456789'
  const invoke = vi.fn(async () => ({ data: { data: { [GUID]: 'role1' } }, error: null }))
  const r = await webBoundGw2Guilds(sbWith({ invoke }), createWebSettings(fakeStorage()), 'd1', 'k')
  expect(r).toEqual({ ok: true, data: [GUID] })
})

test('discordAction needs an active workspace', async () => {
  const sb = sbWith({ userId: null }) // no user -> no workspace
  const r = await webDiscordAction(sb, createWebSettings(fakeStorage()), 'g', 'kick', {})
  expect(r.ok).toBe(false)
})

test('gw2AccountInfo browser-direct returns ok on a valid key', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    const body = /tokeninfo/.test(url)
      ? { permissions: ['account'] }
      : /\/account$/.test(url)
        ? { name: 'Alice.1234', guilds: [], guild_leader: [] }
        : {}
    return { ok: true, status: 200, json: async () => body } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  const r = await webGw2AccountInfo('a-key')
  expect(r.ok).toBe(true)
  if (r.ok) expect(r.data.accountName).toBe('Alice.1234')
})

test('gw2AccountInfo with no key fails', async () => {
  expect((await webGw2AccountInfo()).ok).toBe(false)
})
