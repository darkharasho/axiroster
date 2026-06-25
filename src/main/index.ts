import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'

import { SettingsStore, electronCipher, type SettingKey } from './secrets'
import { GuildStore, type GuildProfileInput } from './guildStore'
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
let guilds: GuildStore
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

/** Build a GW2 client from an explicit key (add-new validation) or the active guild. */
function gw2(explicitKey?: string): Gw2Client {
  const key = explicitKey || guilds.active()?.gw2ApiKey
  if (!key) throw new Gw2Error('No GW2 API key configured — add one in Settings.')
  return new Gw2Client(key)
}

/** Build an AxiTools client from an explicit key or the active guild. */
function axitools(explicitKey?: string): AxitoolsClient {
  const key = explicitKey || guilds.active()?.axitoolsKey
  if (!key) throw new AxitoolsError('No AxiTools key configured — add one in Settings.')
  const parsed = parseAxitoolsKey(key)
  if (!parsed) throw new AxitoolsError('The AxiTools key is malformed — regenerate it in Discord.')
  return new AxitoolsClient(parsed.baseUrl, parsed.token)
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
  /** Hex color (e.g. "#5865f2") when the role has one, else null. */
  color: string | null
  /** A unicode emoji or a CDN url for a custom role icon, else null. */
  icon: string | null
}

function asDiscordRoles(overview: unknown): DiscordRole[] {
  const root = overview as Record<string, unknown> | null
  const roles = root && Array.isArray(root.roles) ? root.roles : []
  return (roles as Record<string, unknown>[])
    .filter((r) => r && typeof r === 'object' && r.id !== undefined)
    .map((r) => {
      const id = String(r.id)
      const colorRaw = r.color ?? r.colour
      let color: string | null = null
      if (typeof colorRaw === 'number' && colorRaw > 0) {
        color = `#${colorRaw.toString(16).padStart(6, '0')}`
      } else if (typeof colorRaw === 'string' && /^#?[0-9a-f]{6}$/i.test(colorRaw)) {
        color = colorRaw.startsWith('#') ? colorRaw : `#${colorRaw}`
      }
      // Discord color 0 / #000000 means "no color" (default role) — not black.
      if (color && /^#0{6}$/i.test(color)) color = null
      let icon: string | null =
        typeof r.unicode_emoji === 'string' && r.unicode_emoji ? r.unicode_emoji : null
      if (!icon && typeof r.icon === 'string' && r.icon) {
        icon = `https://cdn.discordapp.com/role-icons/${id}/${r.icon}.png`
      }
      return { id, name: typeof r.name === 'string' ? r.name : id, color, icon }
    })
}

// AxiTools maps each Discord server to its GW2 guild(s) via the guild-roles
// config (gw2 guild id -> member role id). Pull the bound GW2 guild ids so the
// app can keep the GW2 guild and Discord server as one 1:1 connection.
function parseBoundGw2Guilds(raw: unknown): string[] {
  const ids = new Set<string>()
  const looksGw2 = (s: string): boolean => /^[0-9A-F]{8}-/i.test(s)
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (r && typeof r === 'object') {
        const v = (r as Record<string, unknown>).gw2_guild_id ?? (r as Record<string, unknown>).guild_id
        if (typeof v === 'string') ids.add(v)
      } else if (typeof r === 'string' && looksGw2(r)) ids.add(r)
    }
  } else if (raw && typeof raw === 'object') {
    // map shape: { "<gw2GuildId>": "<roleId>", ... } or { roles: {...} }
    const obj = (raw as Record<string, unknown>).roles ?? (raw as Record<string, unknown>).guild_roles ?? raw
    if (obj && typeof obj === 'object') {
      for (const k of Object.keys(obj as Record<string, unknown>)) if (looksGw2(k)) ids.add(k)
    }
  }
  return [...ids]
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
      roles: parseRoleIds(m.roles ?? m.role_ids ?? m.roleIds),
      bot: isBot(m)
    }))
    .filter((m) => m.id)
}

/** Bots come back differently across bot builds — flag any of the known shapes. */
function isBot(m: Record<string, unknown>): boolean {
  const user = m.user as Record<string, unknown> | undefined
  return (
    m.bot === true ||
    m.is_bot === true ||
    m.isBot === true ||
    (user ? user.bot === true : false)
  )
}

/** Member roles come back as ['id', …] or [{id}, …] depending on the bot build. */
function parseRoleIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((r) =>
      typeof r === 'string' || typeof r === 'number'
        ? String(r)
        : r && typeof r === 'object' && (r as Record<string, unknown>).id !== undefined
          ? String((r as Record<string, unknown>).id)
          : ''
    )
    .filter(Boolean)
}

// ---- roster reconciliation -------------------------------------------------

interface SourceStatus {
  /** Whether the API key/credential for this source is present. */
  hasKey: boolean
  /** hasKey AND a guild/server is selected (i.e. we attempted a fetch). */
  configured: boolean
  loaded: boolean
  count: number
  guildId: string | null
  guildName: string | null
  error: string | null
}

/** A Discord user the link typeahead can match against (whole server, sans bots). */
interface DiscordCandidate {
  id: string
  name: string
  displayName: string
}

interface RosterPayload {
  members: ReconciledMember[]
  metrics: Record<string, BridgePlayerMetrics>
  discordGuildId: string | null
  discordRoles: DiscordRole[]
  /** Full Discord member list for the link picker (not the roster rows). */
  discordCandidates: DiscordCandidate[]
  memberRoleId: string | null
  sources: { gw2: SourceStatus; discord: SourceStatus; bridge: SourceStatus }
  warnings: string[]
}

async function buildRoster(): Promise<RosterPayload> {
  const warnings: string[] = []
  const guild = guilds.active()
  const discordGuildId = guild?.discordGuildId || null
  const gw2GuildId = guild?.gw2GuildId || null

  const hasAxitoolsKey = Boolean(guild?.axitoolsKey)
  const hasGw2Key = Boolean(guild?.gw2ApiKey)
  const discordSource: SourceStatus = {
    hasKey: hasAxitoolsKey,
    configured: Boolean(discordGuildId && hasAxitoolsKey),
    loaded: false,
    count: 0,
    guildId: discordGuildId,
    guildName: guild?.discordGuildName || null,
    error: !guild
      ? 'No guild added'
      : !hasAxitoolsKey
        ? 'No AxiTools key'
        : !discordGuildId
          ? 'No Discord server selected'
          : null
  }
  const gw2Source: SourceStatus = {
    hasKey: hasGw2Key,
    configured: Boolean(gw2GuildId && hasGw2Key),
    loaded: false,
    count: 0,
    guildId: gw2GuildId,
    guildName: guild?.gw2GuildName || null,
    error: !guild
      ? 'No guild added'
      : !hasGw2Key
        ? 'No GW2 API key'
        : !gw2GuildId
          ? 'No GW2 guild selected'
          : null
  }

  let linked: LinkedMemberRaw[] = []
  let discordMembers: DiscordMemberRaw[] = []
  let discordRoles: DiscordRole[] = []
  if (discordSource.configured) {
    const at = axitools()
    try {
      linked = asLinkedMembers(await at.membersLinked(discordGuildId as string))
    } catch (e) {
      warnings.push(`Discord links unavailable: ${(e as Error).message}`)
    }
    try {
      const overview = await at.discordOverview(discordGuildId as string, true)
      discordMembers = asDiscordMembers(overview)
      discordRoles = asDiscordRoles(overview)
      discordSource.loaded = true
      discordSource.count = discordMembers.length
    } catch (e) {
      discordSource.error = (e as Error).message
      warnings.push(`Discord roster unavailable: ${(e as Error).message}`)
    }
  }

  let inGameRoster: InGameMemberRaw[] = []
  let haveInGame = false
  if (gw2Source.configured) {
    try {
      inGameRoster = await gw2().guildMembers(gw2GuildId as string)
      haveInGame = true
      gw2Source.loaded = true
      gw2Source.count = inGameRoster.length
    } catch (e) {
      // /guild/:id/members is leader-only — make that the headline on a 403.
      const raw = (e as Error).message
      const msg = /restrict|leader|403|permission/i.test(raw)
        ? `${raw} — GW2 only returns the guild roster to the guild leader's API key.`
        : raw
      gw2Source.error = msg
      warnings.push(`GW2 in-game roster unavailable: ${msg}`)
    }
  }

  const memberRole = guild?.memberRoleId || null
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
  const repos: RepoRef[] = guild?.bridgeRepos ?? []
  const bridgeSource: SourceStatus = {
    hasKey: repos.length > 0,
    configured: repos.length > 0,
    loaded: false,
    count: 0,
    guildId: null,
    guildName: repos.map((r) => `${r.owner}/${r.repo}`).join(', ') || null,
    error: repos.length > 0 ? null : 'No report repos configured'
  }
  if (repos.length) {
    try {
      const m = await new AxibridgeClient(repos).playerMetrics()
      metrics = Object.fromEntries(m)
      bridgeSource.loaded = true
      bridgeSource.count = m.size
    } catch (e) {
      bridgeSource.error = (e as Error).message
      warnings.push(`AxiBridge metrics unavailable: ${(e as Error).message}`)
    }
  }

  // Candidate pool for the link typeahead/matcher. Union the Discord overview
  // members with the linked-members list (member_name) so a user the overview
  // didn't return is still matchable. Overview entries win (richer fields).
  const candidateMap = new Map<string, DiscordCandidate>()
  for (const l of linked) {
    if (!l.member_id || candidateMap.has(l.member_id)) continue
    candidateMap.set(l.member_id, {
      id: l.member_id,
      name: l.member_name ?? '',
      displayName: l.member_name ?? l.member_id
    })
  }
  for (const d of discordMembers) {
    if (d.bot) continue
    candidateMap.set(d.id, {
      id: d.id,
      name: d.name ?? '',
      displayName: d.display_name ?? d.name ?? d.id
    })
  }
  const discordCandidates = [...candidateMap.values()]

  return {
    members,
    metrics,
    discordGuildId,
    discordRoles,
    discordCandidates,
    memberRoleId: memberRole,
    sources: { gw2: gw2Source, discord: discordSource, bridge: bridgeSource },
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
  // settings (sync config + window only — guild credentials live in GuildStore)
  ipcMain.handle('settings:get', (_e, key: SettingKey) => store.getSetting(key))
  ipcMain.handle('settings:set', (_e, key: SettingKey, value: string) => store.setSetting(key, value))

  // Guild profiles
  ipcMain.handle('guilds:list', () => guilds.summaries())
  ipcMain.handle('guilds:get', (_e, id: string) => guilds.get(id))
  ipcMain.handle('guilds:upsert', (_e, input: GuildProfileInput) => {
    const rec = guilds.upsert(input)
    return guilds.summaries().find((g) => g.id === rec.id) ?? null
  })
  ipcMain.handle('guilds:remove', (_e, id: string) => guilds.remove(id))
  ipcMain.handle('guilds:setActive', (_e, id: string) => {
    guilds.setActive(id)
    mainWindow?.webContents.send('sync:changed') // nudge the roster to rebuild
  })

  // GW2 — validate an explicit key (add-new flow) or use the active guild's.
  ipcMain.handle('gw2:accountInfo', async (_e, apiKey?: string) => {
    try {
      return ok(await gw2(apiKey).accountInfo())
    } catch (e) {
      return fail(e)
    }
  })

  // AxiTools / Discord — explicit key optional for the add-new flow.
  ipcMain.handle('axitools:listGuilds', async (_e, key?: string) => {
    try {
      return ok(await axitools(key).listGuilds())
    } catch (e) {
      return fail(e)
    }
  })
  ipcMain.handle('axitools:guildRoles', async (_e, guildId: string, key?: string) => {
    try {
      return ok(await axitools(key).guildRolesGet(guildId))
    } catch (e) {
      return fail(e)
    }
  })
  // The GW2 guild id(s) AxiTools binds to this Discord server (for the 1:1 link).
  ipcMain.handle('connection:boundGw2Guilds', async (_e, discordGuildId: string, key?: string) => {
    try {
      return ok(parseBoundGw2Guilds(await axitools(key).guildRolesGet(discordGuildId)))
    } catch (e) {
      return fail(e)
    }
  })
  ipcMain.handle(
    'axitools:discordOverview',
    async (_e, guildId: string, includeMembers: boolean, key?: string) => {
      try {
        return ok(await axitools(key).discordOverview(guildId, includeMembers))
      } catch (e) {
        return fail(e)
      }
    }
  )
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
  guilds = new GuildStore(store)
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
