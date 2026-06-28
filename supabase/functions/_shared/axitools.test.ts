// supabase/functions/_shared/axitools.test.ts
import { test, expect, vi } from 'vitest'
import { AxitoolsClient, AxitoolsError } from './axitools'

function res(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response
}

test('listGuilds GETs /guilds with the bearer token', async () => {
  const fetchFn = vi.fn(async () => res(200, [{ id: '1', name: 'G' }]))
  const c = new AxitoolsClient(fetchFn as unknown as typeof fetch, 'https://b', 'axt1.x.y')
  await expect(c.listGuilds()).resolves.toEqual([{ id: '1', name: 'G' }])
  expect(fetchFn).toHaveBeenCalledWith(
    'https://b/guilds',
    expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer axt1.x.y' })
    })
  )
})

test('discordOverview adds ?include=members only when requested', async () => {
  const fetchFn = vi.fn(async () => res(200, {}))
  const c = new AxitoolsClient(fetchFn as unknown as typeof fetch, 'https://b', 't')
  await c.discordOverview('g', true)
  await c.discordOverview('g', false)
  expect(fetchFn.mock.calls[0][0]).toBe('https://b/guilds/g/discord?include=members')
  expect(fetchFn.mock.calls[1][0]).toBe('https://b/guilds/g/discord')
})

test('guildRoles and membersLinked hit their paths', async () => {
  const fetchFn = vi.fn(async () => res(200, {}))
  const c = new AxitoolsClient(fetchFn as unknown as typeof fetch, 'https://b', 't')
  await c.guildRoles('g')
  await c.membersLinked('g')
  expect(fetchFn.mock.calls[0][0]).toBe('https://b/guilds/g/guild-roles')
  expect(fetchFn.mock.calls[1][0]).toBe('https://b/guilds/g/members-linked')
})

test('discordAction POSTs {action, params}', async () => {
  const fetchFn = vi.fn(async () => res(200, { ok: true }))
  const c = new AxitoolsClient(fetchFn as unknown as typeof fetch, 'https://b', 't')
  await c.discordAction('g', 'role_assign', { roleId: 'r' })
  expect(fetchFn).toHaveBeenCalledWith(
    'https://b/guilds/g/discord/actions',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'role_assign', params: { roleId: 'r' } })
    })
  )
})

test('204 resolves to undefined', async () => {
  const c = new AxitoolsClient((async () => res(204, null)) as unknown as typeof fetch, 'https://b', 't')
  await expect(c.membersLinked('g')).resolves.toBeUndefined()
})

test('401/403 throws AxitoolsError (key rejected)', async () => {
  const c = new AxitoolsClient((async () => res(403, {})) as unknown as typeof fetch, 'https://b', 't')
  await expect(c.guildRoles('g')).rejects.toBeInstanceOf(AxitoolsError)
})

test('non-OK throws AxitoolsError', async () => {
  const c = new AxitoolsClient((async () => res(500, {})) as unknown as typeof fetch, 'https://b', 't')
  await expect(c.listGuilds()).rejects.toBeInstanceOf(AxitoolsError)
})

test('fetch rejection throws AxitoolsError (unreachable)', async () => {
  const c = new AxitoolsClient(
    (async () => {
      throw new Error('net')
    }) as unknown as typeof fetch,
    'https://b',
    't'
  )
  await expect(c.listGuilds()).rejects.toBeInstanceOf(AxitoolsError)
})
