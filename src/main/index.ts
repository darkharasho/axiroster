import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { randomBytes } from 'crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { SettingsStore, electronCipher, type SettingKey } from './secrets'
import { DiscordAuth } from './auth/discordAuth'
import type { Session } from '@supabase/supabase-js'
import { codeFromCallback } from './auth/authFlows'
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
import { setupAutoUpdates } from './updater'
import WebSocketImpl from 'ws'

// Electron's main process is Node 20, which has no global WebSocket. supabase-js
// eagerly builds a RealtimeClient inside createClient(), which throws without one.
// Provide the `ws` implementation so every Supabase client (auth + sync) works.
;(globalThis as { WebSocket?: unknown }).WebSocket ??= WebSocketImpl as unknown

function generateInviteCode(): string {
  return randomBytes(9).toString('base64url').toUpperCase()
}

// Desktop OAuth via a localhost loopback redirect. Custom URL schemes
// (axiroster://) are unreliable on Linux, so we open an ephemeral
// http://127.0.0.1:<port> server, use it as the Supabase redirect, and read the
// PKCE `code` straight off the browser's request — no OS protocol handler.
function signInViaLoopback(auth: DiscordAuth): Promise<Session> {
  return new Promise<Session>((resolve, reject) => {
    let verifier = ''
    let settled = false
    const server = http.createServer()
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      server.close()
      fn()
    }
    const timer = setTimeout(() => finish(() => reject(new Error('sign-in timed out'))), 300_000)
    server.on('error', (err) => {
      clearTimeout(timer)
      finish(() => reject(err))
    })
    server.on('request', (req, res) => {
      const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
      const code = reqUrl.searchParams.get('code')
      const authErr =
        reqUrl.searchParams.get('error_description') ?? reqUrl.searchParams.get('error')
      res.writeHead(authErr ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><meta charset=utf-8><body style="font:16px system-ui;padding:3rem;text-align:center">${
          authErr ? 'AxiRoster sign-in failed: ' + authErr : 'AxiRoster sign-in complete — you can close this tab.'
        }</body>`
      )
      if (code) {
        clearTimeout(timer)
        auth
          .completeSignIn(code, verifier)
          .then((s) => finish(() => resolve(s)))
          .catch((e: Error) => finish(() => reject(e)))
      } else if (authErr) {
        clearTimeout(timer)
        finish(() => reject(new Error(authErr)))
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      const started = auth.startSignIn(`http://127.0.0.1:${port}`)
      verifier = started.verifier
      void shell.openExternal(started.url)
    })
  })
}

let store: SettingsStore
let guilds: GuildStore
let roster: RosterStore
let links: LinkStore
let sync: SyncProvider = new LocalSyncProvider()
let mainWindow: BrowserWindow | null = null

let discordAuth: DiscordAuth | null = null
// Legacy custom-scheme callback bridge (kept as a harmless fallback; the active
// sign-in path is the localhost loopback in signInViaLoopback).
let resolveAuth: ((code: string) => void) | null = null

// In-memory store for synced roster members (populated via member:upsert/remove events).
const syncedMembers = new Map<string, Record<string, unknown>>()

// ---- roster source selection ------------------------------------------------

/** Pure helper: when a leader key is present use the live GW2 pull, otherwise
 *  fall back to the synced roster_members table streamed via SyncEvents. */
export function rosterSourceFor(ctx: { hasLeaderKey: boolean }): 'live' | 'synced' {
  return ctx.hasLeaderKey ? 'live' : 'synced'
}

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

// Raw role fields straight from the overview. Color/icon *presentation* (hex,
// black-as-default, CDN url) is done in the renderer (src/lib/roleStyle) so it
// hot-reloads — keep this a pass-through.
interface DiscordRole {
  id: string
  name: string
  /** Raw Discord color: an int, a hex string, or null. */
  colorRaw: number | string | null
  /** Custom role icon hash (turned into a CDN url renderer-side), or null. */
  iconHash: string | null
  /** Role's unicode emoji, or null. */
  emoji: string | null
}

function asDiscordRoles(overview: unknown): DiscordRole[] {
  const root = overview as Record<string, unknown> | null
  const roles = root && Array.isArray(root.roles) ? root.roles : []
  return (roles as Record<string, unknown>[])
    .filter((r) => r && typeof r === 'object' && r.id !== undefined)
    .map((r) => {
      const raw = r.color ?? r.colour
      return {
        id: String(r.id),
        name: typeof r.name === 'string' ? r.name : String(r.id),
        colorRaw: typeof raw === 'number' || typeof raw === 'string' ? raw : null,
        iconHash: typeof r.icon === 'string' && r.icon ? r.icon : null,
        emoji: typeof r.unicode_emoji === 'string' && r.unicode_emoji ? r.unicode_emoji : null
      }
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
  /** GW2 rank name -> hierarchy order (lower = higher rank), for sorting. */
  rankOrder: Record<string, number>
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
  const rankOrder: Record<string, number> = {}

  const rosterSource = rosterSourceFor({ hasLeaderKey: gw2Source.configured })

  if (rosterSource === 'live' && gw2Source.configured) {
    try {
      inGameRoster = await gw2().guildMembers(gw2GuildId as string)
      haveInGame = true
      gw2Source.loaded = true
      gw2Source.count = inGameRoster.length
      // Rank hierarchy is best-effort; if it fails the renderer falls back to
      // alphabetical rank sorting. Don't let it break the roster.
      try {
        for (const r of await gw2().guildRanks(gw2GuildId as string)) rankOrder[r.id] = r.order
      } catch {
        // ignore — alphabetical fallback in the renderer
      }
    } catch (e) {
      // /guild/:id/members is leader-only — make that the headline on a 403.
      const raw = (e as Error).message
      const msg = /restrict|leader|403|permission/i.test(raw)
        ? `${raw} — GW2 only returns the guild roster to the guild leader's API key.`
        : raw
      gw2Source.error = msg
      warnings.push(`GW2 in-game roster unavailable: ${msg}`)
    }
  } else if (rosterSource === 'synced' && syncedMembers.size > 0) {
    // No leader key — build the in-game roster from the synced roster_members
    // table instead of a live GW2 pull. The payload shape mirrors InGameMemberRaw.
    for (const payload of syncedMembers.values()) {
      const name = typeof payload.name === 'string' ? payload.name : undefined
      if (!name) continue
      inGameRoster.push({
        name,
        rank: typeof payload.rank === 'string' ? payload.rank : undefined,
        joined: typeof payload.joined === 'string' ? payload.joined : undefined
      })
    }
    if (inGameRoster.length > 0) {
      haveInGame = true
      gw2Source.loaded = true
      gw2Source.count = inGameRoster.length
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
    rankOrder,
    sources: { gw2: gw2Source, discord: discordSource, bridge: bridgeSource },
    warnings
  }
}

// ---- Supabase / auth config ------------------------------------------------

function supabaseConfig(): { url: string; anonKey: string } {
  // electron-vite inlines VITE_-prefixed vars into import.meta.env at build time
  // (this is what survives into a packaged app); process.env is only a dev
  // fallback for when .env is sourced into the launching shell.
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
  return {
    url: env.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '',
    anonKey: env.VITE_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
  }
}

function getOrCreateDiscordAuth(): DiscordAuth | null {
  const { url, anonKey } = supabaseConfig()
  if (!url || !anonKey) return null
  if (!discordAuth) {
    discordAuth = new DiscordAuth(url, anonKey, store)
  }
  return discordAuth
}

function handleAuthCallback(url: string): void {
  const code = codeFromCallback(url)
  if (code && resolveAuth) resolveAuth(code)
}

// The workspace is ALWAYS the active guild's GW2 guild id — owning multiple
// guilds means multiple independent workspaces, switched via the active-guild
// selector. (No global "claimed guild" setting.)
function activeWorkspaceId(): string | null {
  return guilds.active()?.gw2GuildId || null
}

// The signed-in user's role in a specific workspace, or null if not a member.
// RLS (is_member) lets a member read workspace_members for that workspace.
async function roleInWorkspace(auth: DiscordAuth, workspaceId: string): Promise<string | null> {
  try {
    const client = auth.authedClient()
    const {
      data: { user }
    } = await client.auth.getUser()
    if (!user) return null
    const { data } = await client
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle()
    return (data as { role?: string } | null)?.role ?? null
  } catch {
    return null
  }
}

// ---- sync wiring -----------------------------------------------------------

function applySyncEvent(e: SyncEvent): void {
  if (e.kind === 'annotation:upsert') roster.applyRemote(e.record)
  else if (e.kind === 'annotation:remove') roster.remove(e.memberId)
  else if (e.kind === 'link:set') links.set(e.record.accountName, e.record.memberId)
  else if (e.kind === 'link:remove') links.remove(e.accountName)
  else if (e.kind === 'member:upsert') syncedMembers.set(e.record.memberId, e.record.payload)
  else if (e.kind === 'member:remove') syncedMembers.delete(e.memberId)
  mainWindow?.webContents.send('sync:changed')
}

async function initSync(): Promise<void> {
  await sync.stop().catch(() => {})

  const { url, anonKey } = supabaseConfig()
  const auth = getOrCreateDiscordAuth()
  const workspaceId = activeWorkspaceId()

  if (url && anonKey && auth && workspaceId) {
    const session = await auth.restoreSession().catch(() => null)
    // Only sync the active guild's workspace if the user is actually a member of it.
    const role = session ? await roleInWorkspace(auth, workspaceId) : null
    if (session && role) {
      sync = new SupabaseSyncProvider(
        {
          url,
          anonKey,
          workspaceId,
          accessToken: session.access_token,
          refreshToken: session.refresh_token
        },
        applySyncEvent
      )
      await sync.start().catch(() => {})
    } else {
      sync = new LocalSyncProvider()
    }
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
  ipcMain.handle('guilds:setActive', async (_e, id: string) => {
    guilds.setActive(id)
    await initSync() // the workspace follows the active guild — re-point sync
    mainWindow?.webContents.send('sync:changed') // nudge the roster to rebuild
    mainWindow?.webContents.send('workspace:changed') // Settings re-reads membership
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

  // Auth
  ipcMain.handle('auth:status', async () => {
    const auth = getOrCreateDiscordAuth()
    if (!auth) return { signedIn: false }
    const session = await auth.restoreSession().catch(() => null)
    if (!session) return { signedIn: false }
    // Role + workspace reflect the ACTIVE guild (each claimed guild is its own
    // workspace). null role => signed in but not a member of this guild.
    const workspaceId = activeWorkspaceId()
    const role = workspaceId ? ((await roleInWorkspace(auth, workspaceId)) ?? undefined) : undefined
    return { signedIn: true, role, workspaceId: role ? workspaceId : undefined }
  })

  ipcMain.handle('auth:signIn', async () => {
    const auth = getOrCreateDiscordAuth()
    if (!auth) return null
    try {
      const session = await signInViaLoopback(auth)
      // Pending invites are accepted explicitly by the user (see invites:* IPC),
      // not auto-redeemed. Resolve their role in the active guild's workspace.
      const workspaceId = activeWorkspaceId()
      const role = workspaceId ? await roleInWorkspace(auth, workspaceId) : null
      await initSync()
      return {
        accountName: session.user?.email ?? session.user?.id ?? '',
        role: role ?? undefined,
        workspaceId: role ? workspaceId : undefined
      }
    } catch {
      return null
    }
  })

  ipcMain.handle('auth:signOut', async () => {
    const auth = getOrCreateDiscordAuth()
    await auth?.signOut()
    // Reset to local sync
    await sync.stop().catch(() => {})
    sync = new LocalSyncProvider()
    mainWindow?.webContents.send('sync:status', sync.status)
  })

  // Guild claiming
  ipcMain.handle(
    'guild:claim',
    async () => {
      const auth = getOrCreateDiscordAuth()
      if (!auth) return { ok: false, error: 'Not authenticated' }
      const guild = guilds.active()
      if (!guild?.gw2ApiKey || !guild?.gw2GuildId) {
        return { ok: false, error: 'Select an active guild with a GW2 leader API key first.' }
      }
      try {
        const client = auth.authedClient()
        const { data, error } = await client.functions.invoke('claim-guild', {
          body: { apiKey: guild.gw2ApiKey, guildId: guild.gw2GuildId, guildName: guild.gw2GuildName }
        })
        if (error) return { ok: false, error: String((error as { message?: string }).message ?? error) }
        const result = data as { error?: string } | null
        if (result?.error) return { ok: false, error: result.error }
        await initSync()
        return { ok: true, workspaceId: guild.gw2GuildId }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }
  )

  // Members management
  ipcMain.handle('members:list', async () => {
    const auth = getOrCreateDiscordAuth()
    if (!auth) return []
    const workspaceId = activeWorkspaceId()
    if (!workspaceId) return []
    const client = auth.authedClient()
    const { data } = await client
      .from('workspace_members')
      .select('user_id, discord_id, role')
      .eq('workspace_id', workspaceId)
    return (data ?? []).map((r: Record<string, unknown>) => ({
      userId: String(r.user_id),
      discordId: r.discord_id != null ? String(r.discord_id) : '',
      role: String(r.role)
    }))
  })

  ipcMain.handle('members:setRole', async (_e, { userId, role }: { userId: string; role: string }) => {
    if (role !== 'write' && role !== 'read') return
    const auth = getOrCreateDiscordAuth()
    if (!auth) return
    const workspaceId = activeWorkspaceId()
    if (!workspaceId) return
    const client = auth.authedClient()
    await client
      .from('workspace_members')
      .update({ role })
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
  })

  ipcMain.handle('members:revoke', async (_e, { userId }: { userId: string }) => {
    const auth = getOrCreateDiscordAuth()
    if (!auth) return
    const workspaceId = activeWorkspaceId()
    if (!workspaceId) return
    const client = auth.authedClient()
    await client
      .from('workspace_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
  })

  // The active guild's Discord roster (id + username), used by the member/invite
  // UI to show usernames instead of raw ids and to invite by username.
  ipcMain.handle('discord:members', async () => {
    const guild = guilds.active()
    if (!guild?.discordGuildId || !guild?.axitoolsKey) return []
    try {
      const overview = await axitools().discordOverview(guild.discordGuildId, true)
      return asDiscordMembers(overview)
        .filter((m) => !m.bot)
        .map((m) => ({
          id: m.id,
          name: m.name ?? m.id,
          displayName: m.display_name ?? m.name ?? m.id
        }))
    } catch {
      return []
    }
  })

  // Invites
  ipcMain.handle(
    'invite:create',
    async (_e, payload: { discordId?: string; code?: string; role?: string }) => {
      const auth = getOrCreateDiscordAuth()
      if (!auth) return {}
      const workspaceId = activeWorkspaceId()
      if (!workspaceId) return {}
      if (payload.role !== 'write' && payload.role !== 'read') return { error: 'invalid_role' }
      const client = auth.authedClient()
      // Get current user id for created_by (required by DB not-null constraint)
      const { data: { user } } = await client.auth.getUser()
      const row: Record<string, unknown> = {
        workspace_id: workspaceId,
        created_by: user?.id ?? null
      }
      row.role = payload.role
      if (payload.discordId) row.discord_id = payload.discordId
      else row.code = generateInviteCode()
      const { data } = await client.from('workspace_invites').insert(row).select('code').single()
      return { code: (data as Record<string, unknown> | null)?.code as string | undefined }
    }
  )

  // Redeem an invite code (the invitee's side): grants membership, then resolves
  // which workspace/role they now belong to and starts sync.
  ipcMain.handle('invite:redeem', async (_e, { code }: { code: string }) => {
    const auth = getOrCreateDiscordAuth()
    if (!auth) return { ok: false, error: 'Not signed in' }
    const trimmed = (code ?? '').trim()
    if (!trimmed) return { ok: false, error: 'Enter an invite code' }
    try {
      const { data, error } = await auth
        .authedClient()
        .functions.invoke('redeem-invite', { body: { code: trimmed } })
      const result = data as { error?: string; workspaceId?: string } | null
      if (error || result?.error) {
        return { ok: false, error: 'That invite code is invalid or already used.' }
      }
      // Membership now exists in the invite's workspace. Re-point sync (it picks
      // up the active guild if that's the one redeemed); the UI re-reads status.
      await initSync()
      return { ok: true, workspaceId: result?.workspaceId }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // Pending invites for the signed-in user (the invitee's side): list, then
  // accept/reject. Accepting grants membership in that invite's workspace.
  ipcMain.handle('invites:list', async () => {
    const auth = getOrCreateDiscordAuth()
    if (!auth) return []
    try {
      const { data } = await auth.authedClient().functions.invoke('list-invites', { body: {} })
      return (data as { invites?: unknown[] } | null)?.invites ?? []
    } catch {
      return []
    }
  })

  ipcMain.handle(
    'invites:respond',
    async (_e, { inviteId, action }: { inviteId: string; action: 'accept' | 'reject' }) => {
      const auth = getOrCreateDiscordAuth()
      if (!auth) return { ok: false, error: 'Not signed in' }
      try {
        const { data, error } = await auth
          .authedClient()
          .functions.invoke('respond-invite', { body: { inviteId, action } })
        const result = data as { ok?: boolean; error?: string; workspaceId?: string } | null
        if (error || !result?.ok) return { ok: false, error: 'Could not respond to the invite.' }
        if (action === 'accept') await initSync()
        return { ok: true, workspaceId: result.workspaceId }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }
  )

  // Roster refresh via sync provider
  ipcMain.handle('roster:refresh', async () => {
    if (sync instanceof SupabaseSyncProvider) {
      const count = await sync.refreshRoster()
      return { count }
    }
    return { count: 0 }
  })

  // Custom window controls (frameless window)
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximizeToggle', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)
  ipcMain.handle('app:platform', () => process.platform)

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
    // transparent:true is what actually rounds the corners on a frameless window
    // (the compositor has no window-rounding effect here, so transparency — not
    // backgroundColor — cuts the corners out to the desktop). The renderer paints
    // an opaque rounded rectangle (#root / app shell) inside it. Same technique as
    // AxiStream/AxiBridge.
    backgroundColor: '#00000000',
    transparent: true,
    autoHideMenuBar: true,
    // Frameless on every OS so we draw a consistent custom titlebar + controls.
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false))
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) mainWindow.loadURL(devUrl)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

// ---- deep-link / protocol registration ------------------------------------

app.setAsDefaultProtocolClient('axiroster')

// Enforce single instance so the second-instance event fires on Windows/Linux,
// enabling deep-link callbacks to reach the running instance.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('open-url', (_e, url) => handleAuthCallback(url))
app.on('second-instance', (_e, argv) => {
  const url = argv.find((a) => a.startsWith('axiroster://'))
  if (url) handleAuthCallback(url)
})

// ---- app lifecycle ---------------------------------------------------------

app.whenReady().then(async () => {
  const cipher = await electronCipher()
  const userData = app.getPath('userData')
  store = new SettingsStore(join(userData, 'settings.json'), cipher)
  guilds = new GuildStore(store)
  roster = new RosterStore(join(userData, 'rosterAnnotations.json'))
  links = new LinkStore(join(userData, 'rosterLinks.json'))

  registerIpc()
  createWindow()
  setupAutoUpdates(() => mainWindow)
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
