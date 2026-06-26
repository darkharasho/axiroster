// supabase/functions/_shared/gw2.test.ts
import { test, expect } from 'vitest'
import { verifyLeaderKey } from './gw2'

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
