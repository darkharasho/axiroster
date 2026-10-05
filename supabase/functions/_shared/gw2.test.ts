// supabase/functions/_shared/gw2.test.ts
import { test, expect, vi } from 'vitest'
import { verifyLeaderKey, fetchAccountName } from './gw2'

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
}

test('200 with member list => isLeader true', async () => {
  const r = await verifyLeaderKey(fakeFetch(200, [{ name: 'A.1', rank: 'Leader', joined: null }]), 'k', 'g')
  expect(r.isLeader).toBe(true)
  expect(r.members).toHaveLength(1)
})

test('403 => isLeader false', async () => {
  const r = await verifyLeaderKey(fakeFetch(403, { text: 'access restricted' }), 'k', 'g')
  expect(r.isLeader).toBe(false)
})

test('fetchAccountName returns /v2/account name with the key as Bearer', async () => {
  const fetchFn = vi.fn(async () => new Response(JSON.stringify({ name: 'Name.1234', guilds: [] }), { status: 200 }))
  expect(await fetchAccountName(fetchFn as any, 'KEY')).toBe('Name.1234')
  expect(fetchFn).toHaveBeenCalledWith('https://api.guildwars2.com/v2/account', { headers: { Authorization: 'Bearer KEY' } })
})

test('fetchAccountName returns null on errors instead of throwing', async () => {
  expect(await fetchAccountName((async () => new Response('{}', { status: 401 })) as any, 'KEY')).toBeNull()
  expect(await fetchAccountName((async () => { throw new Error('net') }) as any, 'KEY')).toBeNull()
  expect(await fetchAccountName((async () => new Response('[]', { status: 200 })) as any, 'KEY')).toBeNull()
})
