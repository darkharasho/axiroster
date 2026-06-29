import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createWebClient } from './webClient'

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

test('platform() maps the user agent', async () => {
  expect(await createWebClient({ userAgent: 'Mozilla Mac OS X' }).platform()).toBe('darwin')
  expect(await createWebClient({ userAgent: 'Windows NT 10' }).platform()).toBe('win32')
  expect(await createWebClient({ userAgent: 'X11; Linux x86_64' }).platform()).toBe('linux')
})

test('appVersion() uses the injected version or the default', async () => {
  expect(await createWebClient({ appVersion: '1.2.3' }).appVersion()).toBe('1.2.3')
  expect(await createWebClient({ appVersion: undefined }).appVersion()).toBe('0.0.0-web')
})

test('openExternal opens a noopener tab', async () => {
  const open = vi.fn()
  await createWebClient({ open }).openExternal('https://x.test')
  expect(open).toHaveBeenCalledWith('https://x.test', '_blank', 'noopener,noreferrer')
})

test('settings round-trip through the injected storage', async () => {
  const c = createWebClient({ storage: fakeStorage() })
  expect(await c.getSetting('k')).toBeNull()
  await c.setSetting('k', 'v')
  expect(await c.getSetting('k')).toBe('v')
})

test('window/update/sync/audit stubs resolve sensibly', async () => {
  const c = createWebClient({ storage: fakeStorage() })
  await expect(c.windowMaximizeToggle()).resolves.toBe(false)
  await expect(c.windowIsMaximized()).resolves.toBe(false)
  await expect(c.checkForUpdate()).resolves.toEqual({ ok: true })
  await expect(c.syncStatus()).resolves.toBe('disabled')
  await expect(c.reinitSync()).resolves.toBe('disabled')
  await expect(c.auditStatus()).resolves.toBeNull()
  await expect(c.getWhatsNew()).resolves.toMatchObject({ releaseNotes: null })
})

test('event subscriptions return a callable no-op unsubscribe', () => {
  const c = createWebClient({ storage: fakeStorage() })
  const unsub = c.onWorkspaceChanged(() => {})
  expect(typeof unsub).toBe('function')
  expect(() => unsub()).not.toThrow()
})

test('admin write methods return safe values without supabase', async () => {
  const c = createWebClient({ storage: fakeStorage() })
  expect(await c.createInvite({ role: 'write' })).toEqual({})
  expect(await c.pendingSentInvites()).toEqual([])
  expect(await c.upsertGuild({} as never)).toBeNull()
  expect((await c.claimGuild()).ok).toBe(false)
})

test('workspace read methods return empty (no throw) without supabase', async () => {
  const c = createWebClient({ storage: fakeStorage() })
  expect(await c.listGuilds()).toEqual([])
  expect(await c.listWorkspaceRoles()).toEqual({})
  expect(await c.listInvites()).toEqual([])
  expect(await c.getGuild('w1')).toBeNull()
})

function fakeSupabase(): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1' }, access_token: 'tok' } } }),
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
      signInWithOAuth: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    },
    realtime: { setAuth: () => {} },
    from: () => ({ select: () => ({ eq: async () => ({ data: [{ workspace_id: 'w1', role: 'owner' }] }) }) }),
    channel: (name: string) => ({
      name,
      on: function() { return this },
      subscribe: function(cb?: (st: string) => void) { cb?.('SUBSCRIBED'); return this }
    }),
    removeChannel: async () => {}
  } as unknown as SupabaseClient
}

test('authStatus with an injected supabase reports signed-in', async () => {
  const c = createWebClient({ storage: fakeStorage(), supabase: fakeSupabase() })
  expect(await c.authStatus()).toMatchObject({ signedIn: true, workspaceId: 'w1', role: 'owner' })
})

test('authStatus with no supabase reports signed-out (no throw)', async () => {
  expect(await createWebClient({ storage: fakeStorage() }).authStatus()).toEqual({ signedIn: false })
})

test('authSignIn/authSignOut without supabase throw "not configured"', async () => {
  const c = createWebClient({ storage: fakeStorage() })
  await expect(c.authSignIn()).rejects.toThrow(/not configured/)
  await expect(c.authSignOut()).rejects.toThrow(/not configured/)
})

function realtimeStubs() {
  return {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: { access_token: 'tok' } } })
    },
    realtime: { setAuth: () => {} },
    channel: (name: string) => ({
      name,
      on: function() { return this },
      subscribe: function(cb?: (st: string) => void) { cb?.('SUBSCRIBED'); return this }
    }),
    removeChannel: async () => {}
  }
}

test('wired discord/gw2 methods return Results via an injected supabase', async () => {
  const sb = {
    ...realtimeStubs(),
    auth: { ...realtimeStubs().auth, getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({ select: () => ({ eq: async () => ({ data: [{ workspace_id: 'w1', role: 'owner' }] }) }) }),
    functions: { invoke: async () => ({ data: { data: [] }, error: null }) }
  } as unknown as import('@supabase/supabase-js').SupabaseClient
  const c = createWebClient({ storage: fakeStorage(), supabase: sb })
  expect((await c.axitoolsListGuilds()).ok).toBe(true)
  expect((await c.discordOverview('g', true)).ok).toBe(true)
})

test('stored discord method without supabase returns a failed Result (no throw)', async () => {
  const r = await createWebClient({ storage: fakeStorage() }).axitoolsGuildRoles('g')
  expect(r).toEqual({ ok: false, error: 'Supabase client not configured' })
})

test('buildRoster returns a Result via an injected supabase', async () => {
  const sb = {
    ...realtimeStubs(),
    auth: { ...realtimeStubs().auth, getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => ({
      select: () => ({
        eq: () => {
          const data = t === 'workspace_members' ? [{ workspace_id: 'w1', role: 'owner' }]
            : t === 'workspaces' ? { workspace_id: 'w1', bridge_repos: [] }
            : []
          const p = Promise.resolve({ data }) as Promise<{ data: unknown }> & { maybeSingle: () => Promise<{ data: unknown }> }
          p.maybeSingle = () => Promise.resolve({ data })
          return p
        }
      })
    }),
    functions: { invoke: async () => ({ data: { data: { members: [], roles: [] } }, error: null }) }
  } as unknown as import('@supabase/supabase-js').SupabaseClient
  expect((await createWebClient({ storage: fakeStorage(), supabase: sb }).buildRoster()).ok).toBe(true)
})

test('buildRoster without supabase returns a failed Result', async () => {
  expect((await createWebClient({ storage: fakeStorage() }).buildRoster()).ok).toBe(false)
})

test('auditList without supabase returns empty (no throw)', async () => {
  expect(await createWebClient({ storage: fakeStorage() }).auditList()).toEqual({ events: [], updatedAt: '' })
})

test('members methods are empty/no-op without supabase', async () => {
  const c = createWebClient({ storage: fakeStorage() })
  expect(await c.listMembers()).toEqual([])
  expect(await c.discordMembers()).toEqual([])
  await expect(c.revokeMember('u2')).resolves.toBeUndefined()
})

test('roster CRUD reads no-op safely without supabase', async () => {
  const c = createWebClient({ storage: fakeStorage() })
  expect(await c.getTagRegistry()).toEqual({})
  expect(await c.upsertAnnotation('m1', { notes: 'x' })).toBeNull()
  await expect(c.removeAnnotation('m1')).resolves.toBeUndefined()
})

test('pipelineGet returns an empty doc without supabase', async () => {
  expect(await createWebClient({ storage: fakeStorage() }).pipelineGet()).toEqual({
    stages: undefined,
    placement: {},
    placedAt: {},
    prospects: [],
    votes: []
  })
})

test('event subscriptions are safe no-ops without supabase', () => {
  const c = createWebClient({ storage: fakeStorage() })
  expect(typeof c.onSyncChanged(() => {})).toBe('function')
  expect(typeof c.onWorkspaceChanged(() => {})).toBe('function')
  expect(typeof c.onAuditUpdated(() => {})).toBe('function')
  expect(typeof c.onSyncStatus(() => {})).toBe('function')
  // calling the returned unsubscribe must not throw
  c.onSyncChanged(() => {})()
})
