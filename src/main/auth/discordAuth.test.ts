import { test, expect } from 'vitest'
import { buildAuthUrl } from './discordAuth'

test('buildAuthUrl targets Discord provider with PKCE + redirect', () => {
  const { url, verifier } = buildAuthUrl('https://proj.supabase.co', 'axiroster://auth-callback')
  expect(url).toContain('/auth/v1/authorize')
  expect(url).toContain('provider=discord')
  expect(url).toContain('code_challenge=')
  expect(url).toContain('code_challenge_method=S256')
  expect(url).toContain(encodeURIComponent('axiroster://auth-callback'))
  expect(verifier.length).toBeGreaterThanOrEqual(43)
})
