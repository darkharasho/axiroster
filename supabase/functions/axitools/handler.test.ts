// supabase/functions/axitools/handler.test.ts
import { test, expect, vi } from 'vitest'
import { handleAxitools } from './handler'

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const VALID_KEY = `axt1.${b64url('https://bot')}.tok`

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    listGuilds: vi.fn(async () => [{ id: '1', name: 'G' }]),
    guildRoles: vi.fn(async () => ({ roles: [] })),
    discordOverview: vi.fn(async () => ({ members: [] })),
    membersLinked: vi.fn(async () => []),
    discordAction: vi.fn(async () => ({ ok: true })),
    ...overrides
  }
}

// role: undefined => 'owner' (member, write-capable); pass null for non-member,
//   or a string like 'read' for a non-write member.
// secret: undefined => 'enc' present; pass null for no shared key.
function deps(opts: { role?: string | null; secret?: string | null; client?: ReturnType<typeof fakeClient> } = {}) {
  const client = opts.client ?? fakeClient()
  const d = {
    decrypt: vi.fn(async () => VALID_KEY),
    keySecret: 's',
    client: vi.fn(() => client),
    db: {
      role: vi.fn(async () => (opts.role === undefined ? 'owner' : opts.role)),
      getAxitoolsSecret: vi.fn(async () => (opts.secret === undefined ? 'enc' : opts.secret))
    }
  }
  return { d, client }
}

test('unknown op => 400', async () => {
  const { d } = deps()
  expect((await handleAxitools(d as never, { userId: 'u', op: 'nope', workspaceId: 'w' })).status).toBe(400)
})

test('stored read by a member returns { data } passthrough', async () => {
  const { d, client } = deps({ role: 'read' })
  const r = await handleAxitools(d as never, { userId: 'u', op: 'listGuilds', workspaceId: 'w' })
  expect(r.status).toBe(200)
  expect(r.body).toEqual({ data: [{ id: '1', name: 'G' }] })
  expect(client.listGuilds).toHaveBeenCalled()
})

test('stored mode, non-member => 403 not_member', async () => {
  const { d } = deps({ role: null })
  const r = await handleAxitools(d as never, { userId: 'u', op: 'guildRoles', workspaceId: 'w', guildId: 'g' })
  expect(r).toEqual({ status: 403, body: { error: 'not_member' } })
})

test('stored mode, no shared key => 409 no_key', async () => {
  const { d } = deps({ secret: null })
  const r = await handleAxitools(d as never, { userId: 'u', op: 'listGuilds', workspaceId: 'w' })
  expect(r.status).toBe(409)
})

test('discordAction by a non-write member => 403 not_authorized', async () => {
  const { d } = deps({ role: 'read' })
  const r = await handleAxitools(d as never, {
    userId: 'u', op: 'discordAction', workspaceId: 'w', guildId: 'g', action: 'member_kick', params: {}
  })
  expect(r).toEqual({ status: 403, body: { error: 'not_authorized' } })
})

test('discordAction by an owner calls the client and returns data', async () => {
  const { d, client } = deps({ role: 'owner' })
  const r = await handleAxitools(d as never, {
    userId: 'u', op: 'discordAction', workspaceId: 'w', guildId: 'g', action: 'role_assign', params: { roleId: 'r' }
  })
  expect(r.status).toBe(200)
  expect(client.discordAction).toHaveBeenCalledWith('g', 'role_assign', { roleId: 'r' })
})

test('a "write" role may discordAction', async () => {
  const { d } = deps({ role: 'write' })
  const r = await handleAxitools(d as never, {
    userId: 'u', op: 'discordAction', workspaceId: 'w', guildId: 'g', action: 'role_assign', params: {}
  })
  expect(r.status).toBe(200)
})

test('validation mode (key supplied) skips membership entirely', async () => {
  const { d, client } = deps()
  const r = await handleAxitools(d as never, { userId: 'u', op: 'listGuilds', key: VALID_KEY })
  expect(r.status).toBe(200)
  expect(d.db.role).not.toHaveBeenCalled()
  expect(d.db.getAxitoolsSecret).not.toHaveBeenCalled()
  expect(client.listGuilds).toHaveBeenCalled()
})

test('validation mode with a malformed key => 400', async () => {
  const { d } = deps()
  const r = await handleAxitools(d as never, { userId: 'u', op: 'listGuilds', key: 'not-a-key' })
  expect(r.status).toBe(400)
})

test('discordAction in validation mode => 400 (stored-only)', async () => {
  const { d } = deps()
  const r = await handleAxitools(d as never, {
    userId: 'u', op: 'discordAction', guildId: 'g', action: 'member_kick', params: {}, key: VALID_KEY
  })
  expect(r.status).toBe(400)
})

test('stored mode with a corrupt stored key => 400', async () => {
  const { d } = deps()
  d.decrypt = vi.fn(async () => 'garbage') as never
  const r = await handleAxitools(d as never, { userId: 'u', op: 'listGuilds', workspaceId: 'w' })
  expect(r.status).toBe(400)
})

test('guildRoles without guildId => 400', async () => {
  const { d } = deps()
  const r = await handleAxitools(d as never, { userId: 'u', op: 'guildRoles', workspaceId: 'w' })
  expect(r.status).toBe(400)
})

test('discordAction without action => 400', async () => {
  const { d } = deps({ role: 'owner' })
  const r = await handleAxitools(d as never, { userId: 'u', op: 'discordAction', workspaceId: 'w', guildId: 'g', params: {} })
  expect(r.status).toBe(400)
})

test('upstream failure => 502 carrying the message', async () => {
  const client = fakeClient({ listGuilds: vi.fn(async () => { throw new Error('bot down') }) })
  const { d } = deps({ client })
  const r = await handleAxitools(d as never, { userId: 'u', op: 'listGuilds', workspaceId: 'w' })
  expect(r.status).toBe(502)
  expect((r.body as { error: string; message: string }).error).toBe('upstream_error')
  expect((r.body as { message: string }).message).toBe('bot down')
})
