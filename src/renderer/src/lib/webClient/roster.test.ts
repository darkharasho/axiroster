import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { webBuildRoster, webRefreshRoster } from './roster'
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

// A thenable that also exposes maybeSingle(), covering both `await eq(...)` and
// `eq(...).maybeSingle()` chains.
function tableResult(data: unknown): Promise<{ data: unknown }> & { maybeSingle: () => Promise<{ data: unknown }> } {
  const p = Promise.resolve({ data }) as Promise<{ data: unknown }> & {
    maybeSingle: () => Promise<{ data: unknown }>
  }
  p.maybeSingle = () => Promise.resolve({ data })
  return p
}

function fakeSb(
  tables: Record<string, unknown>,
  invoke: ReturnType<typeof vi.fn>,
  userId: string | null = 'u1'
): SupabaseClient {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: (t: string) => ({
      select: () => ({
        eq: () =>
          t === 'workspace_members'
            ? tableResult([{ workspace_id: 'w1', role: 'owner' }])
            : tableResult(tables[t])
      })
    }),
    functions: { invoke }
  } as unknown as SupabaseClient
}

test('webBuildRoster reconciles synced members + annotations into a payload', async () => {
  const tables = {
    workspaces: {
      workspace_id: 'w1',
      guild_name: 'My Guild',
      discord_guild_id: 'd1',
      member_role_id: 'role1',
      bridge_repos: []
    },
    roster_members: [{ member_id: 'Alice.1', payload: { name: 'Alice.1', rank: 'Member', joined: null } }],
    roster_links: [],
    roster_annotations: [
      { member_id: 'acct:Alice.1', nickname: 'Ally', aliases: [], notes: '', tags: ['core'], main_account: '' }
    ]
  }
  const invoke = vi.fn(async (fn: string, opts: { body: { op?: string } }) => {
    if (fn === 'axitools' && opts.body.op === 'discordOverview')
      return { data: { data: { members: [], roles: [] } }, error: null }
    return { data: { data: [] }, error: null }
  })
  const r = await webBuildRoster(fakeSb(tables, invoke), createWebSettings(fakeStorage()))
  expect(r.ok).toBe(true)
  if (r.ok) {
    expect(r.data.members.length).toBeGreaterThan(0)
    expect(r.data.sources.gw2.count).toBe(1)
  }
})

test('a Discord invoke failure still returns the roster with a warning', async () => {
  const tables = {
    workspaces: { workspace_id: 'w1', discord_guild_id: 'd1', guild_name: 'G', bridge_repos: [] },
    roster_members: [{ member_id: 'A.1', payload: { name: 'A.1' } }],
    roster_links: [],
    roster_annotations: []
  }
  const invoke = vi.fn(async (fn: string) =>
    fn === 'axitools' ? { data: null, error: { message: 'bot down' } } : { data: { count: 0 }, error: null }
  )
  const r = await webBuildRoster(fakeSb(tables, invoke), createWebSettings(fakeStorage()))
  expect(r.ok).toBe(true)
  if (r.ok) expect(r.data.warnings.some((w) => /Discord/i.test(w))).toBe(true)
})

test('webBuildRoster with no active workspace fails', async () => {
  const r = await webBuildRoster(fakeSb({}, vi.fn(), null), createWebSettings(fakeStorage()))
  expect(r.ok).toBe(false)
})

test('webRefreshRoster invokes refresh-roster and returns count', async () => {
  const invoke = vi.fn(async () => ({ data: { count: 7 }, error: null }))
  const r = await webRefreshRoster(fakeSb({}, invoke), createWebSettings(fakeStorage()))
  expect(r).toEqual({ count: 7 })
  expect(invoke).toHaveBeenCalledWith('refresh-roster', { body: { guildId: 'w1' } })
})

test('webRefreshRoster without active workspace throws', async () => {
  await expect(
    webRefreshRoster(fakeSb({}, vi.fn(), null), createWebSettings(fakeStorage()))
  ).rejects.toThrow(/active workspace/i)
})
