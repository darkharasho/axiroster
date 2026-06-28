import { test, expect } from 'vitest'
import { createBrowserSupabase } from './supabaseClient'

test('constructs a client exposing auth + from (no network)', () => {
  const sb = createBrowserSupabase('https://x.supabase.co', 'anon-key')
  expect(typeof sb.auth.getSession).toBe('function')
  expect(typeof sb.from).toBe('function')
})
