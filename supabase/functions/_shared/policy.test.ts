import { test, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { webcrypto, createHash } from 'node:crypto'
import {
  hashIdentity, isBlocked, normalizeIdentity, policyHashes, policyLookup, unavailableResponse, UNAVAILABLE
} from './policy'
// @ts-expect-error expose WebCrypto for the module under test in Node
globalThis.crypto ??= webcrypto

const VECTORS = JSON.parse(readFileSync(new URL('./policy.vectors.json', import.meta.url), 'utf8')) as {
  valid: { kind: any; input: string; normalized: string; hash: string }[]
  invalid: { kind: any; input: string }[]
}
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

test('reproduces every valid vector', async () => {
  for (const v of VECTORS.valid) {
    expect(normalizeIdentity(v.kind, v.input)).toBe(v.normalized)
    expect(await hashIdentity(v.kind, v.input)).toBe(v.hash)
    expect(normalizeIdentity(v.kind, v.normalized)).toBe(v.normalized)
  }
})

test('invalid vectors normalize to null', async () => {
  for (const v of VECTORS.invalid) {
    expect(normalizeIdentity(v.kind, v.input)).toBeNull()
    expect(await hashIdentity(v.kind, v.input)).toBeNull()
  }
})

test('policyHashes skips missing and invalid values and de-duplicates', async () => {
  const hashes = await policyHashes([
    { kind: 'discord_user', value: '123456789012345678' },
    { kind: 'discord_user', value: ' 123456789012345678 ' },
    { kind: 'discord_user', value: null },
    { kind: 'gw2_guild', value: undefined },
    { kind: 'gw2_account', value: 'no number' }
  ])
  expect(hashes).toEqual([sha('discord_user:123456789012345678')])
})

test('isBlocked asks the lookup only when there is something to look up', async () => {
  const lookup = vi.fn(async () => [])
  expect(await isBlocked(lookup, [{ kind: 'discord_user', value: null }])).toBe(false)
  expect(lookup).not.toHaveBeenCalled()
})

test('isBlocked is true when any hash is listed', async () => {
  const listed = sha('gw2_guild:4bbb52aa-d768-4fc6-8ede-c299f2822f0f')
  const lookup = vi.fn(async (hashes: string[]) => hashes.filter((h) => h === listed))
  expect(await isBlocked(lookup, [
    { kind: 'discord_user', value: '123456789012345678' },
    { kind: 'gw2_guild', value: '4BBB52AA-D768-4FC6-8EDE-C299F2822F0F' }
  ])).toBe(true)
  expect(await isBlocked(lookup, [{ kind: 'discord_user', value: '123456789012345678' }])).toBe(false)
})

test('isBlocked fails open on a lookup error and logs it', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await isBlocked(async () => { throw new Error('db down') }, [{ kind: 'discord_user', value: '123456789012345678' }])).toBe(false)
  expect(err).toHaveBeenCalled()
  err.mockRestore()
})

test('policyLookup queries policy_blocks with the hashes', async () => {
  const inFn = vi.fn(async () => ({ data: [{ hash: 'h1' }], error: null }))
  const select = vi.fn(() => ({ in: inFn }))
  const from = vi.fn(() => ({ select }))
  expect(await policyLookup({ from })(['h1', 'h2'])).toEqual(['h1'])
  expect(from).toHaveBeenCalledWith('policy_blocks')
  expect(select).toHaveBeenCalledWith('hash')
  expect(inFn).toHaveBeenCalledWith('hash', ['h1', 'h2'])
})

test('policyLookup surfaces query errors to isBlocked', async () => {
  const from = () => ({ select: () => ({ in: async () => ({ data: null, error: new Error('nope') }) }) })
  await expect(policyLookup({ from })(['h'])).rejects.toThrow('nope')
})

test('unavailableResponse is a neutral 403 with the caller CORS headers', async () => {
  const r = unavailableResponse({ 'Access-Control-Allow-Origin': '*' })
  expect(r.status).toBe(403)
  expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*')
  expect(r.headers.get('Content-Type')).toBe('application/json')
  expect(await r.json()).toEqual(UNAVAILABLE)
  expect(UNAVAILABLE).toEqual({ error: 'unavailable', message: 'Access unavailable for this account.' })
})
