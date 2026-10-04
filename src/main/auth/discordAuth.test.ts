import { test, expect, vi, beforeEach } from 'vitest'
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'

// Capture the onAuthStateChange handler so tests can fire auth events.
let authCallback: ((event: string, session: unknown) => void) | null = null
// Per-test behaviour for the session calls restoreSession makes.
const authMock = {
  getSession: vi.fn(async () => ({ data: { session: null as unknown }, error: null as unknown })),
  setSession: vi.fn(async (_t: unknown) => ({ data: { session: null as unknown }, error: null as unknown })),
  signOut: vi.fn(async () => ({ error: null }))
}
vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@supabase/supabase-js')>()
  return {
    ...real,
    createClient: () => ({
      auth: {
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          authCallback = cb
          return { data: { subscription: { unsubscribe: () => {} } } }
        },
        getSession: () => authMock.getSession(),
        setSession: (t: unknown) => authMock.setSession(t),
        signOut: () => authMock.signOut()
      }
    })
  }
})

import { buildAuthUrl, exchangeCode, DiscordAuth } from './discordAuth'
import type { SettingsStore } from '../secrets'

function memoryStore(): SettingsStore {
  const secrets: Record<string, string> = {}
  return {
    setSecret: (k: string, v: string) => {
      secrets[k] = v
    },
    getSecret: (k: string) => secrets[k] ?? null
  } as unknown as SettingsStore
}

test('buildAuthUrl targets Discord provider with PKCE + redirect', () => {
  const { url, verifier } = buildAuthUrl('https://proj.supabase.co', 'axiroster://auth-callback')
  expect(url).toContain('/auth/v1/authorize')
  expect(url).toContain('provider=discord')
  expect(url).toContain('code_challenge=')
  expect(url).toContain('code_challenge_method=S256')
  expect(url).toContain(encodeURIComponent('axiroster://auth-callback'))
  expect(verifier.length).toBeGreaterThanOrEqual(43)
})

test('exchangeCode posts auth_code + code_verifier to the token endpoint and returns tokens', async () => {
  let captured: { url: string; body: unknown } | null = null
  const fakeFetch = (async (url: string, init: { body: string }) => {
    captured = { url, body: JSON.parse(init.body) }
    return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt' }), { status: 200 })
  }) as unknown as typeof fetch
  const tokens = await exchangeCode('https://proj.supabase.co', 'anonkey', 'thecode', 'theverifier', fakeFetch)
  expect(captured!.url).toContain('/auth/v1/token?grant_type=pkce')
  expect(captured!.body).toEqual({ auth_code: 'thecode', code_verifier: 'theverifier' })
  expect(tokens.access_token).toBe('at')
  expect(tokens.refresh_token).toBe('rt')
})

test('exchangeCode throws on a non-ok token response', async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ error_description: 'invalid grant' }), { status: 400 })) as unknown as typeof fetch
  await expect(exchangeCode('https://p.supabase.co', 'a', 'c', 'v', fakeFetch)).rejects.toThrow('invalid grant')
})

test('persists the rotated session when the client refreshes its token', () => {
  authCallback = null
  const store = memoryStore()
  new DiscordAuth('https://proj.supabase.co', 'anonkey', store)
  expect(authCallback).toBeTypeOf('function')

  const fresh = { access_token: 'new-at', refresh_token: 'new-rt' }
  authCallback!('TOKEN_REFRESHED', fresh)

  expect(JSON.parse(store.getSecret('discordSession')!)).toEqual(fresh)
})

test('does not overwrite the stored session on a null-session event', () => {
  authCallback = null
  const store = memoryStore()
  store.setSecret('discordSession', JSON.stringify({ access_token: 'keep' }))
  new DiscordAuth('https://proj.supabase.co', 'anonkey', store)

  authCallback!('SIGNED_OUT', null)

  expect(JSON.parse(store.getSecret('discordSession')!)).toEqual({ access_token: 'keep' })
})

beforeEach(() => {
  authMock.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null })
  authMock.setSession.mockReset().mockResolvedValue({ data: { session: null }, error: null })
  authMock.signOut.mockReset().mockResolvedValue({ error: null })
})

const storedSession = JSON.stringify({ access_token: 'old-at', refresh_token: 'old-rt' })

test('restoreSession returns the live session without re-sending stored tokens', async () => {
  const store = memoryStore()
  store.setSecret('discordSession', storedSession)
  const live = { access_token: 'live-at', refresh_token: 'live-rt' }
  authMock.getSession.mockResolvedValue({ data: { session: live }, error: null })
  const auth = new DiscordAuth('https://proj.supabase.co', 'anonkey', store)
  expect(await auth.restoreSession()).toBe(live)
  expect(authMock.setSession).not.toHaveBeenCalled()
})

test('restoreSession keeps the stored session when Supabase is unreachable', async () => {
  const store = memoryStore()
  store.setSecret('discordSession', storedSession)
  authMock.setSession.mockResolvedValue({
    data: { session: null },
    error: new AuthRetryableFetchError('fetch failed', 0)
  })
  const auth = new DiscordAuth('https://proj.supabase.co', 'anonkey', store)
  expect(await auth.restoreSession()).toBeNull()
  expect(auth.unreachable).toBe(true)
  expect(store.getSecret('discordSession')).toBe(storedSession)
  expect(authMock.signOut).not.toHaveBeenCalled()
})

test('restoreSession keeps the stored session when the refresh call throws', async () => {
  const store = memoryStore()
  store.setSecret('discordSession', storedSession)
  authMock.setSession.mockRejectedValue(new TypeError('fetch failed'))
  const auth = new DiscordAuth('https://proj.supabase.co', 'anonkey', store)
  expect(await auth.restoreSession()).toBeNull()
  expect(store.getSecret('discordSession')).toBe(storedSession)
})

test('restoreSession signs out when Supabase rejects the session', async () => {
  const store = memoryStore()
  store.setSecret('discordSession', storedSession)
  authMock.setSession.mockResolvedValue({
    data: { session: null },
    error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found')
  })
  const auth = new DiscordAuth('https://proj.supabase.co', 'anonkey', store)
  expect(await auth.restoreSession()).toBeNull()
  expect(auth.unreachable).toBe(false)
  expect(store.getSecret('discordSession')).toBe('')
})

test('a rate limit is not treated as a rejected session', async () => {
  const store = memoryStore()
  store.setSecret('discordSession', storedSession)
  authMock.setSession.mockResolvedValue({
    data: { session: null },
    error: new AuthApiError('Too many requests', 429, 'over_request_rate_limit')
  })
  const auth = new DiscordAuth('https://proj.supabase.co', 'anonkey', store)
  await auth.restoreSession()
  expect(store.getSecret('discordSession')).toBe(storedSession)
})

test('restoreSession persists the refreshed session on success', async () => {
  const store = memoryStore()
  store.setSecret('discordSession', storedSession)
  const fresh = { access_token: 'new-at', refresh_token: 'new-rt' }
  authMock.setSession.mockResolvedValue({ data: { session: fresh }, error: null })
  const auth = new DiscordAuth('https://proj.supabase.co', 'anonkey', store)
  expect(await auth.restoreSession()).toEqual(fresh)
  expect(JSON.parse(store.getSecret('discordSession')!)).toEqual(fresh)
})
