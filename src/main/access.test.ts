import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConfig, hashIdentity, type AxiConfig, type IdentityKind } from '@axiapps/axi-config'
import { resetBlockScreenForTests } from '@axiapps/axi-config/electron'
import { startAccess, discordUserId, type AccessDeps } from './access'

const DISCORD_ID = '123456789012345678'
const GUILD_ID = '0a1b2c3d-1111-2222-3333-444455556666'
const ACCOUNT = 'Test Person.1234'

let dir: string
const configs: AxiConfig[] = []
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'axiroster-access-'))
  resetBlockScreenForTests()
})
afterEach(async () => {
  // Let any in-flight cache write settle before removing the directory.
  for (const c of configs.splice(0)) {
    await c.refresh()
    c.close()
  }
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

function manifestFetch(denylist: string[]): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ version: 1, flags: {}, minVersion: null, notice: null, denylist }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })) as unknown as typeof fetch
}

async function makeConfig(denylist: string[] | 'offline'): Promise<AxiConfig> {
  const config = createConfig({
    appId: 'axiroster',
    cacheDir: dir,
    refreshMs: 1e9,
    logger: { warn() {} },
    fetch: denylist === 'offline' ? ((async () => { throw new Error('offline') }) as unknown as typeof fetch) : manifestFetch(denylist)
  })
  await config.ready()
  await config.refresh()
  configs.push(config)
  return config
}

function fakeElectron() {
  const windows: unknown[] = []
  class FakeWindow {
    webContents = { setWindowOpenHandler() {}, on() {} }
    constructor() { windows.push(this) }
    isDestroyed() { return false }
    destroy() {}
    removeMenu() {}
    async loadURL() {}
    on() {}
    static getAllWindows() { return [] as never[] }
  }
  return {
    windows,
    electron: {
      app: { quit: vi.fn(), on: vi.fn(), relaunch: vi.fn(), exit: vi.fn(), getPath: () => dir },
      BrowserWindow: FakeWindow,
      shell: { openExternal: vi.fn(async () => {}) }
    } as unknown as AccessDeps['electron']
  }
}

const guild = (over: Record<string, unknown> = {}) => ({
  gw2ApiKey: '',
  gw2GuildId: '',
  gw2AccountName: '',
  ...over
})

function deps(config: AxiConfig, over: Partial<AccessDeps> = {}) {
  const onBlocked = vi.fn()
  const { electron } = fakeElectron()
  const d: AccessDeps = {
    electron,
    config,
    onBlocked,
    readGuilds: () => [],
    getSession: async () => null,
    ...over
  }
  return { d, onBlocked }
}

describe('discordUserId', () => {
  test('reads provider_id', () => {
    expect(discordUserId({ user_metadata: { provider_id: DISCORD_ID } })).toBe(DISCORD_ID)
  })
  test('falls back to sub', () => {
    expect(discordUserId({ user_metadata: { sub: DISCORD_ID } })).toBe(DISCORD_ID)
  })
  test('falls back to the discord identities entry', () => {
    expect(
      discordUserId({
        identities: [
          { provider: 'github', id: '999999999999999999' },
          { provider: 'discord', id: DISCORD_ID }
        ]
      })
    ).toBe(DISCORD_ID)
  })
  test('a UUID-only user gives none', () => {
    expect(discordUserId({ id: '3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f', user_metadata: {} })).toBeNull()
  })
  test('a malformed id gives none', () => {
    expect(discordUserId({ user_metadata: { provider_id: '12ab' } })).toBeNull()
    expect(discordUserId({ user_metadata: { provider_id: '1'.repeat(40) } })).toBeNull()
    expect(discordUserId(null)).toBeNull()
  })
})

async function h(kind: IdentityKind, value: string) {
  return hashIdentity(kind, value)
}

describe('access', () => {
  test('a listed GW2 guild blocks at runtime, once', async () => {
    const config = await makeConfig([await h('gw2_guild', GUILD_ID)])
    const { d, onBlocked } = deps(config, { readGuilds: () => [guild({ gw2GuildId: GUILD_ID })] })
    const boot = await startAccess(d)
    expect(boot.blocked).toBe(false)
    if (boot.blocked) return
    await boot.gate.recheck()
    await boot.gate.recheck()
    expect(onBlocked).toHaveBeenCalledTimes(1)
    expect(onBlocked).toHaveBeenCalledWith({ persisted: true })
  })

  test('a listed cached GW2 account name blocks', async () => {
    const config = await makeConfig([await h('gw2_account', ACCOUNT)])
    const { d, onBlocked } = deps(config, { readGuilds: () => [guild({ gw2AccountName: ACCOUNT })] })
    const boot = await startAccess(d)
    if (boot.blocked) throw new Error('unexpected')
    await boot.gate.recheck()
    expect(onBlocked).toHaveBeenCalledTimes(1)
  })

  test('a listed Discord user blocks', async () => {
    const config = await makeConfig([await h('discord_user', DISCORD_ID)])
    const { d, onBlocked } = deps(config, {
      getSession: async () => ({ user: { user_metadata: { provider_id: DISCORD_ID } } })
    })
    const boot = await startAccess(d)
    if (boot.blocked) throw new Error('unexpected')
    await boot.gate.recheck()
    expect(onBlocked).toHaveBeenCalledTimes(1)
  })

  test('a malformed cached account name is skipped and does not hide a listed guild', async () => {
    const config = await makeConfig([await h('gw2_guild', GUILD_ID)])
    const { d, onBlocked } = deps(config, {
      readGuilds: () => [guild({ gw2AccountName: 'not an account' }), guild({ gw2GuildId: GUILD_ID })],
      getSession: async () => ({ user: { user_metadata: { provider_id: 'zzz' } } })
    })
    const boot = await startAccess(d)
    if (boot.blocked) throw new Error('unexpected')
    await boot.gate.recheck()
    expect(onBlocked).toHaveBeenCalledTimes(1)
  })

  test('clean identities never block', async () => {
    const config = await makeConfig([await h('gw2_guild', '99999999-1111-2222-3333-444455556666')])
    const { d, onBlocked } = deps(config, {
      readGuilds: () => [guild({ gw2GuildId: GUILD_ID, gw2AccountName: ACCOUNT })],
      getSession: async () => ({ user: { user_metadata: { provider_id: DISCORD_ID } } })
    })
    const boot = await startAccess(d)
    if (boot.blocked) throw new Error('unexpected')
    await boot.gate.recheck()
    expect(onBlocked).not.toHaveBeenCalled()
  })

  test('boot with the sticky trip shows the block screen', async () => {
    const denylist = [await h('gw2_guild', GUILD_ID)]
    const first = await makeConfig(denylist)
    const a = deps(first, { readGuilds: () => [guild({ gw2GuildId: GUILD_ID })] })
    const bootA = await startAccess(a.d)
    if (bootA.blocked) throw new Error('unexpected')
    await bootA.gate.recheck()
    expect(a.onBlocked).toHaveBeenCalledWith({ persisted: true })
    first.close()

    const second = await makeConfig(denylist)
    const { electron, windows } = fakeElectron()
    const boot = await startAccess({ electron, config: second, readGuilds: () => [], getSession: async () => null })
    expect(boot).toEqual({ blocked: true })
    expect(windows).toHaveLength(1)
    second.close()
  })

  test('fails open when offline with no cache', async () => {
    const config = await makeConfig('offline')
    const { d, onBlocked } = deps(config, {
      readGuilds: () => [guild({ gw2GuildId: GUILD_ID, gw2AccountName: ACCOUNT })],
      getSession: async () => ({ user: { user_metadata: { provider_id: DISCORD_ID } } })
    })
    const boot = await startAccess(d)
    if (boot.blocked) throw new Error('unexpected')
    await boot.gate.recheck()
    expect(onBlocked).not.toHaveBeenCalled()
  })

  test('a throwing source does not throw into startup', async () => {
    const config = await makeConfig([])
    const { d } = deps(config, {
      readGuilds: () => { throw new Error('boom') },
      getSession: async () => { throw new Error('boom') }
    })
    const boot = await startAccess(d)
    if (boot.blocked) throw new Error('unexpected')
    await expect(boot.gate.recheck()).resolves.toBe(false)
  })

  test('a session that appears after an offline boot is checked on the next recheck', async () => {
    const config = await makeConfig([await h('discord_user', DISCORD_ID)])
    let session: { user: { user_metadata: { provider_id: string } } } | null = null
    const { d, onBlocked } = deps(config, { getSession: async () => session })
    const boot = await startAccess(d)
    if (boot.blocked) throw new Error('unexpected')
    await boot.gate.recheck()
    expect(onBlocked).not.toHaveBeenCalled()
    session = { user: { user_metadata: { provider_id: DISCORD_ID } } }
    void boot.gate.recheck()
    await boot.gate.recheck()
    expect(onBlocked).toHaveBeenCalledTimes(1)
  })
})
