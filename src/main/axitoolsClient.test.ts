import { test, expect, vi, beforeEach } from 'vitest'

const calls: { url: string }[] = []
vi.mock('./net/resilientFetch', () => ({
  FetchTimeoutError: class extends Error {},
  resilientFetch: vi.fn(async (url: string) => {
    calls.push({ url })
    return { status: 200, ok: true, json: async () => [] } as unknown as Response
  })
}))

import { AxitoolsClient } from './axitoolsClient'

beforeEach(() => {
  calls.length = 0
})

test('auditDiscord builds the URL with limit and since_id', async () => {
  const c = new AxitoolsClient('https://bot.example', 'tok')
  await c.auditDiscord('123', { sinceId: '50', limit: 200 })
  expect(calls[0].url).toBe('https://bot.example/guilds/123/audit/discord?since_id=50&limit=200')
})

test('auditDiscord omits since_id when not given and defaults limit to 200', async () => {
  const c = new AxitoolsClient('https://bot.example', 'tok')
  await c.auditDiscord('123')
  expect(calls[0].url).toBe('https://bot.example/guilds/123/audit/discord?limit=200')
})
