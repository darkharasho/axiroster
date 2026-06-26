import { test, expect } from 'vitest'
import { buildAuthUrl, exchangeCode } from './discordAuth'

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
