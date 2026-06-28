import { test, expect, vi } from 'vitest'

// Capture the onAuthStateChange handler so tests can fire auth events.
let authCallback: ((event: string, session: unknown) => void) | null = null
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        authCallback = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      }
    }
  })
}))

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
