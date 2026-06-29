import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { webAuthStatus, webSignIn, webSignOut, discordIdentity } from './auth'
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

// Minimal Supabase fake. `memberships` drives from().select().eq().
function fakeSb(opts: {
  session?: unknown
  userId?: string | null
  memberships?: { workspace_id: string; role: string }[]
  membersThrows?: boolean
  meta?: Record<string, unknown>
}): SupabaseClient {
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: opts.session ?? null } })),
      getUser: vi.fn(async () => ({ data: { user: opts.userId ? { id: opts.userId, user_metadata: opts.meta } : null } })),
      signInWithOAuth: vi.fn(async () => ({ data: { provider: 'discord', url: 'u' }, error: null })),
      signOut: vi.fn(async () => ({ error: null }))
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(async () => {
          if (opts.membersThrows) throw new Error('rls')
          return { data: opts.memberships ?? [] }
        })
      }))
    }))
  } as unknown as SupabaseClient
}

test('webAuthStatus: no session => signed out', async () => {
  expect(await webAuthStatus(fakeSb({ session: null }), createWebSettings(fakeStorage()))).toEqual({
    signedIn: false
  })
})

test('webAuthStatus: session + one membership => resolved', async () => {
  const sb = fakeSb({
    session: { user: { id: 'u1' } },
    userId: 'u1',
    memberships: [{ workspace_id: 'w1', role: 'owner' }]
  })
  expect(await webAuthStatus(sb, createWebSettings(fakeStorage()))).toMatchObject({
    signedIn: true,
    role: 'owner',
    workspaceId: 'w1',
    userId: 'u1'
  })
})

test('webAuthStatus: picks the membership matching activeGuildId, else first', async () => {
  const settings = createWebSettings(fakeStorage())
  settings.set('activeGuildId', 'w2')
  const sb = fakeSb({
    session: { user: { id: 'u1' } },
    userId: 'u1',
    memberships: [
      { workspace_id: 'w1', role: 'write' },
      { workspace_id: 'w2', role: 'owner' }
    ]
  })
  expect((await webAuthStatus(sb, settings)).workspaceId).toBe('w2')
})

test('webAuthStatus: a membership-query throw degrades to signed-out workspace (still signedIn)', async () => {
  const sb = fakeSb({ session: { user: { id: 'u1' } }, userId: 'u1', membersThrows: true })
  const r = await webAuthStatus(sb, createWebSettings(fakeStorage()))
  expect(r.signedIn).toBe(true)
  expect(r.workspaceId).toBeUndefined()
})

test('webSignIn: discord OAuth with redirectTo, resolves null', async () => {
  const sb = fakeSb({})
  await expect(webSignIn(sb, 'https://roster.axi.link')).resolves.toBeNull()
  expect(sb.auth.signInWithOAuth).toHaveBeenCalledWith({
    provider: 'discord',
    options: { redirectTo: 'https://roster.axi.link' }
  })
})

test('webSignOut: calls supabase signOut', async () => {
  const sb = fakeSb({})
  await webSignOut(sb)
  expect(sb.auth.signOut).toHaveBeenCalled()
})

test('discordIdentity: prefers full_name then falls back, maps avatar', () => {
  expect(discordIdentity({ full_name: 'Rasho', name: 'x', avatar_url: 'http://a/p.png' })).toEqual({
    name: 'Rasho',
    avatarUrl: 'http://a/p.png'
  })
  expect(discordIdentity({ user_name: 'rasho_gw2', picture: 'http://a/q.png' })).toEqual({
    name: 'rasho_gw2',
    avatarUrl: 'http://a/q.png'
  })
  expect(discordIdentity(undefined)).toEqual({ name: 'Discord user', avatarUrl: '' })
})

test('webAuthStatus: surfaces Discord name + avatar from user_metadata', async () => {
  const sb = fakeSb({
    session: {},
    userId: 'u1',
    memberships: [{ workspace_id: 'w1', role: 'owner' }],
    meta: { full_name: 'Rasho', avatar_url: 'http://a/p.png' }
  })
  const r = await webAuthStatus(sb, createWebSettings(fakeStorage()))
  expect(r).toMatchObject({ signedIn: true, role: 'owner', name: 'Rasho', avatarUrl: 'http://a/p.png' })
})
