// src/main/roster/assembleRoster.test.ts
import { test, expect, vi } from 'vitest'
import { assembleRoster, type RosterAssemblyDeps, type GuildMeta } from './assembleRoster'

const GUILD: GuildMeta = {
  discordGuildId: 'd1',
  discordGuildName: 'Disc',
  gw2GuildId: 'g1',
  gw2GuildName: 'GW2',
  hasAxitoolsKey: true,
  hasGw2Key: true,
  memberRoleId: 'role1',
  bridgeRepos: [],
  retentionEnabled: false
}

function deps(over: Partial<RosterAssemblyDeps> = {}, guild: GuildMeta | null = GUILD): RosterAssemblyDeps {
  return {
    activeGuild: () => guild,
    membersLinked: vi.fn(async () => []),
    discordOverview: vi.fn(async () => ({ members: [{ id: 'm1', name: 'Alice' }], roles: [] })),
    inGameMembers: vi.fn(async () => [{ name: 'Alice.1', rank: 'Member', joined: null }]),
    guildRanks: vi.fn(async () => [{ id: 'Member', order: 1 }]),
    syncedMembers: () => [],
    manualLinks: () => [],
    annotations: () => [],
    bridgeMetrics: vi.fn(async () => new Map()),
    attendance: vi.fn(async () => []),
    ...over
  }
}

test('live path: configured Discord + GW2 leader key produces loaded sources, no warnings', async () => {
  const p = await assembleRoster(deps())
  expect(p.sources.gw2.loaded).toBe(true)
  expect(p.sources.gw2.count).toBe(1)
  expect(p.sources.discord.loaded).toBe(true)
  expect(p.warnings).toEqual([])
  expect(p.rankOrder).toEqual({ Member: 1 })
  expect(Array.isArray(p.members)).toBe(true)
})

test('synced path: no leader key builds in-game roster from synced members', async () => {
  const d = deps(
    {
      syncedMembers: () => [{ name: 'Bob.2', rank: 'Member', joined: null }],
      inGameMembers: vi.fn(async () => {
        throw new Error('should not be called')
      })
    },
    { ...GUILD, hasGw2Key: false, gw2GuildId: 'g1' }
  )
  const p = await assembleRoster(d)
  expect(p.sources.gw2.count).toBe(1)
  expect(d.inGameMembers).not.toHaveBeenCalled()
})

test('Discord failure folds into a single warning and sets discord error', async () => {
  const d = deps({
    membersLinked: vi.fn(async () => {
      throw new Error('bot down')
    }),
    discordOverview: vi.fn(async () => {
      throw new Error('bot down')
    })
  })
  const p = await assembleRoster(d)
  expect(p.warnings.filter((w) => w.startsWith('Discord unavailable')).length).toBe(1)
  expect(p.sources.discord.error).toBeTruthy()
})

test('GW2 leader-only 403 appends the leader headline; rank failure is swallowed', async () => {
  const d = deps({
    inGameMembers: vi.fn(async () => {
      throw new Error('403 restricted')
    }),
    guildRanks: vi.fn(async () => {
      throw new Error('ranks fail')
    })
  })
  const p = await assembleRoster(d)
  expect(p.sources.gw2.error).toMatch(/leader/i)
  expect(p.warnings.some((w) => w.startsWith('GW2 in-game roster unavailable'))).toBe(true)
})

test('AxiBridge metrics failure is best-effort; attendance is fetched regardless of retentionEnabled', async () => {
  const d = deps(
    {
      bridgeMetrics: vi.fn(async () => {
        throw new Error('bridge down')
      }),
      attendance: vi.fn(async () => [{ id: 'r1', date: '2026-08-01', attendees: [] }])
    },
    { ...GUILD, bridgeRepos: [{ owner: 'o', repo: 'r' }], retentionEnabled: false }
  )
  const p = await assembleRoster(d)
  expect(p.warnings.some((w) => w.startsWith('AxiBridge metrics unavailable'))).toBe(true)
  expect(d.attendance).toHaveBeenCalled()
  expect(p.attendance).toHaveLength(1)
})

test('attendance fetch is skipped when the guild has no bridge repos', async () => {
  const d = deps({ attendance: vi.fn(async () => []) }, { ...GUILD, bridgeRepos: [] })
  await assembleRoster(d)
  expect(d.attendance).not.toHaveBeenCalled()
})

test('attendance failure warns only for retention-enabled guilds', async () => {
  const boom = (): RosterAssemblyDeps['attendance'] =>
    vi.fn(async () => {
      throw new Error('404')
    })
  const quiet = await assembleRoster(
    deps({ attendance: boom() }, { ...GUILD, bridgeRepos: [{ owner: 'o', repo: 'r' }], retentionEnabled: false })
  )
  expect(quiet.attendance).toEqual([])
  expect(quiet.warnings.some((w) => w.startsWith('Attendance data unavailable'))).toBe(false)

  const loud = await assembleRoster(
    deps({ attendance: boom() }, { ...GUILD, bridgeRepos: [{ owner: 'o', repo: 'r' }], retentionEnabled: true })
  )
  expect(loud.attendance).toEqual([])
  expect(loud.warnings.some((w) => w.startsWith('Attendance data unavailable'))).toBe(true)
})

test('no active guild yields the "No guild added" source errors and empty members', async () => {
  const p = await assembleRoster(deps({}, null))
  expect(p.members).toEqual([])
  expect(p.sources.gw2.error).toMatch(/No guild added/)
  expect(p.sources.discord.error).toMatch(/No guild added/)
})
