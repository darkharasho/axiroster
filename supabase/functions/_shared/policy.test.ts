import { test, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { webcrypto, createHash } from 'node:crypto'
import {
  hashIdentity, isBlocked, normalizeIdentity, policyHashes, policyLookup, rlsMember, unavailableResponse,
  workspaceDiscordServer, UNAVAILABLE
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

test('isBlocked fails open when hashing throws and logs it', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  const digest = vi.spyOn(globalThis.crypto.subtle, 'digest').mockRejectedValueOnce(new Error('no digest'))
  const lookup = vi.fn(async () => ['x'])
  expect(await isBlocked(lookup, [{ kind: 'discord_user', value: '123456789012345678' }])).toBe(false)
  expect(lookup).not.toHaveBeenCalled()
  expect(err).toHaveBeenCalled()
  digest.mockRestore()
  err.mockRestore()
})

test('normalizeIdentity rejects kinds that are only inherited object keys', () => {
  expect(normalizeIdentity('toString' as any, 'x')).toBeNull()
  expect(normalizeIdentity('constructor' as any, 'x')).toBeNull()
})

test('rlsMember asks is_member as the caller and passes its answer through', async () => {
  const rpc = vi.fn(async () => ({ data: false, error: null }))
  expect(await rlsMember({ rpc })('ws1')).toBe(false)
  expect(rpc).toHaveBeenCalledWith('is_member', { ws: 'ws1' })
  rpc.mockResolvedValueOnce({ data: true, error: null })
  expect(await rlsMember({ rpc })('ws1')).toBe(true)
})

test('rlsMember fails open on an RPC error or throw and logs it', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await rlsMember({ rpc: async () => ({ data: null, error: new Error('rpc down') }) })('ws1')).toBe(true)
  expect(await rlsMember({ rpc: async () => { throw new Error('network') } })('ws1')).toBe(true)
  expect(err).toHaveBeenCalledTimes(2)
  err.mockRestore()
})

function workspacesStub(result: { data: unknown; error: unknown } | Error) {
  const maybeSingle = vi.fn(async () => { if (result instanceof Error) throw result; return result })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { from, select, eq }
}

test('workspaceDiscordServer reads the stored discord_guild_id', async () => {
  const db = workspacesStub({ data: { discord_guild_id: '1100000000000000001' }, error: null })
  expect(await workspaceDiscordServer(db)('ws1')).toBe('1100000000000000001')
  expect(db.from).toHaveBeenCalledWith('workspaces')
  expect(db.select).toHaveBeenCalledWith('discord_guild_id')
  expect(db.eq).toHaveBeenCalledWith('workspace_id', 'ws1')
  expect(await workspaceDiscordServer(workspacesStub({ data: null, error: null }))('ws1')).toBeNull()
})

test('workspaceDiscordServer yields null on a read error and logs it', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await workspaceDiscordServer(workspacesStub({ data: null, error: new Error('x') }))('ws1')).toBeNull()
  expect(await workspaceDiscordServer(workspacesStub(new Error('y')))('ws1')).toBeNull()
  expect(err).toHaveBeenCalledTimes(2)
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
