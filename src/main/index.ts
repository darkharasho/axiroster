import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'

import { SettingsStore, electronCipher, type KeyService, type SettingKey } from './secrets'
import { RosterStore, type RosterAnnotationPatch } from './rosterStore'
import { LinkStore } from './linkStore'
import { Gw2Client, Gw2Error } from './gw2Client'
import { AxitoolsClient, AxitoolsError } from './axitoolsClient'
import { parseAxitoolsKey } from './axivaleKey'
import { AxibridgeClient, type RepoRef, type BridgePlayerMetrics } from './axibridgeClient'
import {
  reconcileRoster,
  type DiscordMemberRaw,
  type LinkedMemberRaw,
  type InGameMemberRaw,
  type ReconciledMember
} from './rosterReconcile'
import type { SyncProvider, SyncEvent } from './sync/syncProvider'
import { LocalSyncProvider } from './sync/syncProvider'
import { SupabaseSyncProvider } from './sync/supabaseSync'

let store: SettingsStore
let roster: RosterStore
let links: LinkStore
let sync: SyncProvider = new LocalSyncProvider()
let mainWindow: BrowserWindow | null = null

// ---- helpers ---------------------------------------------------------------

function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data }
}
function fail(error: unknown): { ok: false; error: string } {
  const msg =
    error instanceof Gw2Error || error instanceof AxitoolsError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error)
  return { ok: false, error: msg }
}

function gw2(): Gw2Client {
  const key = store.getActiveKey('gw2')
  if (!key) throw new Gw2Error('No GW2 API key configured — add one in Settings.')
  return new Gw2Client(key)
}

function axitools(): AxitoolsClient {
  const key = store.getActiveKey('axitools')
  if (!key) throw new AxitoolsError('No AxiTools key configured — add one in Settings.')
  const parsed = parseAxitoolsKey(key)
  if (!parsed) throw new AxitoolsError('The AxiTools key is malformed — regenerate it in Discord.')
  return new AxitoolsClient(parsed.baseUrl, parsed.token)
}

function memberRoleId(discordGuildId: string | null): string | null {
  const raw = store.getSetting('discordMemberRoleByGuild')
  if (!raw || !discordGuildId) return null
  try {
    const map = JSON.parse(raw) as Record<string, string>
    return map[discordGuildId] ?? null
  } catch {
    return null
  }
}

function bridgeRepos(): RepoRef[] {
  const raw = store.getSetting('axibridgeRepos')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as RepoRef[]
    return Array.isArray(parsed) ? parsed.filter((r) => r?.owner && r?.repo) : []
  } catch {
    return []
  }
}

// AxiTools' /members-linked and /discord shapes are loosely typed upstream; coerce
// them into the reconcile input types defensively.
function asLinkedMembers(raw: unknown): LinkedMemberRaw[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
    .map((m) => ({
      member_id: String(m.member_id ?? ''),
      member_name: typeof m.member_name === 'string' ? m.member_name : undefined,
      accounts: Array.isArray(m.accounts)
        ? (m.accounts as Record<string, unknown>[]).map((a) => ({
            account_name: typeof a.account_name === 'string' ? a.account_name : undefined,
            characters: Array.isArray(a.characters) ? (a.characters as string[]) : undefined,
            guild_labels:
              a.guild_labels && typeof a.guild_labels === 'object'
                ? (a.guild_labels as Record<string, string>)
                : undefined
          }))
        : []
    }))
    .filter((m) => m.member_id)
}

interface DiscordRole {
  id: string
  name: string
}

function asDiscordRoles(overview: unknown): DiscordRole[] {
  const root = overview as Record<string, unknown> | null
  const roles = root && Array.isArray(root.roles) ? root.roles : []
  return (roles as Record<string, unknown>[])
    .filter((r) => r && typeof r === 'object' && r.id !== undefined)
    .map((r) => ({ id: String(r.id), name: typeof r.name === 'string' ? r.name : String(r.id) }))
}

function asDiscordMembers(overview: unknown): DiscordMemberRaw[] {
  const root = overview as Record<string, unknown> | null
  const members = root && Array.isArray(root.members) ? root.members : []
  return (members as Record<string, unknown>[])
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      id: String(m.id ?? ''),
      name: typeof m.name === 'string' ? m.name : undefined,
      display_name: typeof m.display_name === 'string' ? m.display_name : undefined,
      roles: Array.isArray(m.roles) ? (m.roles as string[]).map(String) : []
    }))
    .filter((m) => m.id)
}

// ---- roster reconciliation -------------------------------------------------

interface RosterPayload {
  members: ReconciledMember[]
  metrics: Record<string, BridgePlayerMetrics>
  discordGuildId: string | null
  discordRoles: DiscordRole[]
  memberRoleId: string | null
  warnings: string[]
}

async function buildRoster(): Promise<RosterPayload> {
  const warnings: string[] = []
  const discordGuildId = store.getSetting('discordGuildId')
  const gw2GuildId = store.getSetting('gw2GuildId')

  let linked: LinkedMemberRaw[] = []
  let discordMembers: DiscordMemberRaw[] = []
  let discordRoles: DiscordRole[] = []
  if (discordGuildId && store.getActiveKey('axitools')) {
    const at = axitools()
    try {
      linked = asLinkedMembers(await at.membersLinked(discordGuildId))
    } catch (e) {
      warnings.push(`Discord links unavailable: ${(e as Error).message}`)
    }
    try {
      const overview = await at.discordOverview(discordGuildId, true)
      discordMembers = asDiscordMembers(overview)
      discordRoles = asDiscordRoles(overview)
    } catch (e) {
      warnings.push(`Discord roster unavailable: ${(e as Error).message}`)
    }
  }

  let inGameRoster: InGameMemberRaw[] = []
  let haveInGame = false
  if (gw2GuildId && store.getActiveKey('gw2')) {
    try {
      inGameRoster = await gw2().guildMembers(gw2GuildId)
      haveInGame = true
    } catch (e) {
      warnings.push(`GW2 in-game roster unavailable: ${(e as Error).message}`)
    }
  }

  const memberRole = memberRoleId(discordGuildId)
  const members = reconcileRoster({
    discordMembers,
    linked,
    inGameRoster,
    manualLinks: links.list().map((l) => ({ accountName: l.accountName, memberId: l.memberId })),
    annotations: roster.list(),
    memberRoleId: memberRole,
    haveInGame
  })

  // Bridge metrics are best-effort and keyed by lc(account); fold into a plain map.
  let metrics: Record<string, BridgePlayerMetrics> = {}
  const repos = bridgeRepos()
  if (repos.length) {
    try {
      const m = await new AxibridgeClient(repos).playerMetrics()
      metrics = Object.fromEntries(m)
    } catch (e) {
      warnings.push(`AxiBridge metrics unavailable: ${(e as Error).message}`)
    }
  }

  return {
    members,
    metrics,
    discordGuildId,
    discordRoles,
    memberRoleId: memberRole,
    warnings
  }
}

// ---- sync wiring -----------------------------------------------------------

function applySyncEvent(e: SyncEvent): void {
  if (e.kind === 'annotation:upsert') roster.applyRemote(e.record)
  else if (e.kind === 'annotation:remove') roster.remove(e.memberId)
  else if (e.kind === 'link:set') links.set(e.record.accountName, e.record.memberId)
  else if (e.kind === 'link:remove') links.remove(e.accountName)
  mainWindow?.webContents.send('sync:changed')
}

async function initSync(): Promise<void> {
  await sync.stop().catch(() => {})
  const enabled = store.getSetting('syncEnabled') === 'true'
  const url = store.getSetting('syncUrl')
  const anonKey = store.getSetting('syncAnonKey')
  const workspaceId = store.getSetting('syncWorkspaceId')
  if (enabled && url && anonKey && workspaceId) {
    sync = new SupabaseSyncProvider({ url, anonKey, workspaceId }, applySyncEvent)
    await sync.start().catch(() => {})
  } else {
    sync = new LocalSyncProvider()
  }
  mainWindow?.webContents.send('sync:status', sync.status)
}

// ---- IPC -------------------------------------------------------------------

function registerIpc(): void {
  // settings + keyrings
  ipcMain.handle('settings:get', (_e, key: SettingKey) => store.getSetting(key))
  ipcMain.handle('settings:set', (_e, key: SettingKey, value: string) => store.setSetting(key, value))
  ipcMain.handle('keys:list', (_e, service: KeyService) => store.listKeyLabels(service))
  ipcMain.handle('keys:add', (_e, service: KeyService, label: string, key: string) => {
    store.addKey(service, label, key)
    store.setActiveKey(service, label)
  })
  ipcMain.handle('keys:remove', (_e, service: KeyService, label: string) =>
    store.removeKey(service, label)
  )
  ipcMain.handle('keys:setActive', (_e, service: KeyService, label: string) =>
    store.setActiveKey(service, label)
  )

  // GW2
  ipcMain.handle('gw2:accountInfo', async () => {
    try {
      return ok(await gw2().accountInfo())
    } catch (e) {
      return fail(e)
    }
  })

  // AxiTools / Discord
  ipcMain.handle('axitools:listGuilds', async () => {
    try {
      return ok(await axitools().listGuilds())
    } catch (e) {
      return fail(e)
    }
  })
  ipcMain.handle('axitools:guildRoles', async (_e, guildId: string) => {
    try {
      return ok(await axitools().guildRolesGet(guildId))
    } catch (e) {
      return fail(e)
    }
  })
  ipcMain.handle('axitools:discordOverview', async (_e, guildId: string, includeMembers: boolean) => {
    try {
      return ok(await axitools().discordOverview(guildId, includeMembers))
    } catch (e) {
      return fail(e)
    }
  })
  ipcMain.handle(
    'discord:action',
    async (_e, guildId: string, action: string, params: Record<string, unknown>) => {
      try {
        return ok(await axitools().discordAction(guildId, action, params))
      } catch (e) {
        return fail(e)
      }
    }
  )

  // Roster
  ipcMain.handle('roster:build', async () => {
    try {
      return ok(await buildRoster())
    } catch (e) {
      return fail(e)
    }
  })
  ipcMain.handle('roster:annotation:upsert', async (_e, memberId: string, patch: RosterAnnotationPatch) => {
    const rec = roster.upsert(memberId, patch)
    if (rec) await sync.pushAnnotation(rec).catch(() => {})
    else await sync.removeAnnotation(memberId).catch(() => {})
    return rec
  })
  ipcMain.handle('roster:annotation:remove', async (_e, memberId: string) => {
    roster.remove(memberId)
    await sync.removeAnnotation(memberId).catch(() => {})
  })
  ipcMain.handle('roster:link:set', async (_e, accountName: string, memberId: string) => {
    const rec = links.set(accountName, memberId)
    await sync.pushLink(rec).catch(() => {})
    return rec
  })
  ipcMain.handle('roster:link:remove', async (_e, accountName: string) => {
    links.remove(accountName)
    await sync.removeLink(accountName).catch(() => {})
  })

  // Sync
  ipcMain.handle('sync:status', () => sync.status)
  ipcMain.handle('sync:reinit', async () => {
    await initSync()
    return sync.status
  })
}

// ---- window ----------------------------------------------------------------

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#1c1917',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) mainWindow.loadURL(devUrl)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  const cipher = await electronCipher()
  const userData = app.getPath('userData')
  store = new SettingsStore(join(userData, 'settings.json'), cipher)
  roster = new RosterStore(join(userData, 'rosterAnnotations.json'))
  links = new LinkStore(join(userData, 'rosterLinks.json'))

  registerIpc()
  createWindow()
  await initSync()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  roster.flush()
  links.flush()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  roster.flush()
  links.flush()
})
