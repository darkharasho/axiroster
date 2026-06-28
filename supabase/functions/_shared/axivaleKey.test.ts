// supabase/functions/_shared/axivaleKey.test.ts
import { test, expect } from 'vitest'
import { parseAxitoolsKey } from './axivaleKey'

// base64url (no padding) of a URL, the way the AxiTools bot mints keys.
function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const KEY = `axt1.${b64url('https://bot.example.com')}.s3cr3t`

test('parses a valid axt1 key into baseUrl + full-key token', () => {
  expect(parseAxitoolsKey(KEY)).toEqual({ baseUrl: 'https://bot.example.com', token: KEY })
})

test('trims trailing slashes from baseUrl', () => {
  const k = `axt1.${b64url('https://bot.example.com/')}.s`
  expect(parseAxitoolsKey(k)?.baseUrl).toBe('https://bot.example.com')
})

test('rejects wrong prefix, wrong part count, and empty secret', () => {
  expect(parseAxitoolsKey(`axv1.${b64url('https://b')}.s`)).toBeNull()
  expect(parseAxitoolsKey(`axt1.${b64url('https://b')}`)).toBeNull()
  expect(parseAxitoolsKey(`axt1.${b64url('https://b')}.`)).toBeNull()
})

test('rejects bad base64 and non-http(s) URLs', () => {
  expect(parseAxitoolsKey('axt1.@@@@.s')).toBeNull()
  expect(parseAxitoolsKey(`axt1.${b64url('ftp://x.com')}.s`)).toBeNull()
})
