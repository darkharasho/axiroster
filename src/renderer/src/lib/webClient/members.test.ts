import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { webListMembers, webSetMemberRole, webRevokeMember, webDiscordMembers } from './members'
import { createWebSettings } from './settings'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size
    }
  } as Storage
}

// chainable builder: select/eq chain (+ thenable {data}); update/delete are spies
// returning a chainable whose terminal .eq resolves. `single` for maybeSingle.
function builder(cfg: { rows?: unknown; single?: unknown }) {
  const update = vi.fn(() => b)
  const del = vi.fn(() => b)
  const b: Record<string, unknown> = {}
  Object.assign(b, {
    select: () => b,
    eq: () => b,
    update,
    delete: del,
    maybeSingle: async () => ({ data: cfg.single ?? null }),
    then: (res: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: cfg.rows ?? [], error: null }).then(res)
  })
  return b as Record<string, unknown> & { update: typeof update; delete: typeof del }
}

function fakeSb(builders: Record<string, ReturnType<typeof builder>>, invoke?: ReturnType<typeof vi.fn>): SupabaseClient {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => builders[t],
    functions: { invoke: invoke ?? vi.fn(async () => ({ data: { data: {} }, error: null })) }
  } as unknown as SupabaseClient
}

const members = () => builder({ rows: [{ workspace_id: 'w1', role: 'owner' }] })

test('webListMembers maps workspace_members rows', async () => {
  const wm = builder({
    rows: [{ user_id: 'u2', discord_id: 'd2', discord_username: 'bob', discord_global_name: 'Bob', role: 'owner' }]
  })
  // workspace_members is used by BOTH activeWorkspaceId and the listing; give it the membership rows
  const wmForActive = builder({ rows: [{ workspace_id: 'w1', role: 'owner' }] })
  // route: first from('workspace_members') call (activeWorkspaceId) -> wmForActive; but our fake returns one builder per table.
  // Simplify: make workspace_members return the LISTING rows AND include workspace_id so activeWorkspaceId picks w1.
  const wm2 = builder({
    rows: [
      { workspace_id: 'w1', role: 'owner', user_id: 'u2', discord_id: 'd2', discord_username: 'bob', discord_global_name: 'Bob' }
    ]
  })
  const r = await webListMembers(fakeSb({ workspace_members: wm2 }), createWebSettings(fakeStorage()))
  expect(r).toEqual([
    { userId: 'u2', discordId: 'd2', discordName: 'bob', discordGlobalName: 'Bob', role: 'owner' }
  ])
})

test('webSetMemberRole updates only for write/read; ignores other roles', async () => {
  const wm = members()
  await webSetMemberRole(fakeSb({ workspace_members: wm }), createWebSettings(fakeStorage()), 'u2', 'write')
  expect(wm.update).toHaveBeenCalledWith({ role: 'write' })
  const wm2 = members()
  await webSetMemberRole(fakeSb({ workspace_members: wm2 }), createWebSettings(fakeStorage()), 'u2', 'owner')
  expect(wm2.update).not.toHaveBeenCalled()
})

test('webRevokeMember deletes the membership', async () => {
  const wm = members()
  await webRevokeMember(fakeSb({ workspace_members: wm }), createWebSettings(fakeStorage()), 'u2')
  expect(wm.delete).toHaveBeenCalled()
})

test('webDiscordMembers returns non-bot mapped members', async () => {
  const invoke = vi.fn(async () => ({
    data: { data: { members: [{ id: 'm1', name: 'a', display_name: 'A' }, { id: 'b1', name: 'bot', bot: true }] } },
    error: null
  }))
  const sb = fakeSb(
    { workspace_members: members(), workspaces: builder({ single: { discord_guild_id: 'd1' } }) },
    invoke
  )
  const r = await webDiscordMembers(sb, createWebSettings(fakeStorage()))
  expect(r).toEqual([{ id: 'm1', name: 'a', displayName: 'A' }])
})

test('webDiscordMembers with no discord guild returns []', async () => {
  const sb = fakeSb({ workspace_members: members(), workspaces: builder({ single: { discord_guild_id: '' } }) })
  expect(await webDiscordMembers(sb, createWebSettings(fakeStorage()))).toEqual([])
})
