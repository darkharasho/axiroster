// supabase/functions/_shared/crypto.test.ts
import { test, expect } from 'vitest'
import { encryptKey, decryptKey } from './crypto'
import { webcrypto } from 'node:crypto'
// @ts-expect-error expose WebCrypto for the module under test in Node
globalThis.crypto ??= webcrypto

test('round-trips a key', async () => {
  const secret = Buffer.from(new Uint8Array(32).fill(7)).toString('base64')
  const enc = await encryptKey('SECRET-GW2-KEY', secret)
  expect(enc).not.toContain('SECRET')
  expect(await decryptKey(enc, secret)).toBe('SECRET-GW2-KEY')
})
