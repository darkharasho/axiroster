import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'crypto'
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { SettingsStore, electronCipher, type SettingKey } from './secrets'
import { DiscordAuth } from './auth/discordAuth'
import type { Session } from '@supabase/supabase-js'
import { codeFromCallback } from './auth/authFlows'
import { GuildStore, type GuildProfileInput } from './guildStore'
import { RosterStore, type RosterAnnotationPatch } from './rosterStore'
import { LinkStore } from './linkStore'
import { LocalAuditStore } from './audit/localAuditStore'
import type { AuditRepo, AuditFilter } from './audit/auditRepo'
import { SupabaseAuditRepo } from './audit/supabaseAuditRepo'
import { LocalRetentionHistory } from './retention/localRetentionHistory'
import { SupabaseRetentionRepo } from './retention/supabaseRetentionRepo'
import type { RetentionRepo, RetentionSnapshot } from './retention/retentionRepo'
import { migrateAuditToSupabase, migrateRetentionToSupabase } from './migrateLocalToSupabase'
import { AuditSync } from './auditSync'
import { Gw2Client, Gw2Error } from './gw2Client'
import { AxitoolsClient, AxitoolsError } from './axitoolsClient'
import { parseAxitoolsKey } from './axivaleKey'
import { AxibridgeClient, type RepoRef, type BridgePlayerMetrics, type AttendanceRaidDTO } from './axibridgeClient'
import {
  reconcileRoster,
  isReservedAnnotationKey,
  type DiscordMemberRaw,
  type LinkedMemberRaw,
  type InGameMemberRaw,
  type ReconciledMember
} from './rosterReconcile'
import type { SyncProvider, SyncEvent } from './sync/syncProvider'
import { LocalSyncProvider } from './sync/syncProvider'
import { SupabaseSyncProvider } from './sync/supabaseSync'
import { setupAutoUpdates } from './updater'
import { extractReleaseNotesRangeFromFile } from './versionUtils'
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
let retentionHistory: RetentionRepo
let sync: SyncProvider = new LocalSyncProvider()
// Set by initSync() when a Supabase workspace is connected; null when local-only.
let activeWsConn: { url: string; anonKey: string; workspaceId: string; accessToken: string; refreshToken: string } | null = null
let auditStore: AuditRepo | null = null
let auditSync: AuditSync | null = null

/** Point the audit store + poller at the active guild (per-guild file) and start
 *  syncing. A source is skipped when its key is absent, so partial-credential
 *  guilds (Discord-only members, etc.) don't spam errors. */
async function retargetAudit(): Promise<void> {
  auditSync?.stop()
  await auditStore?.stop?.()
  const g = guilds.active()
  if (!g) {
    auditStore = null
    auditSync = null
    return
  }
  const localPath = join(app.getPath('userData'), 'auditLog', `${g.id}.json`)
  const localStore = new LocalAuditStore(localPath)
  if (activeWsConn) {
    const supa = new SupabaseAuditRepo(activeWsConn)
    await supa.start().catch(() => {})
    // Backfill any local-only history into the cloud once, then read live.
    await migrateAuditToSupabase({
      workspaceId: activeWsConn.workspaceId,
      target: supa,
      local: localStore,
      getSetting: (k) => store.getSetting(k as never),
      setSetting: (k, v) => store.setSetting(k as never, v)
    }).catch(() => {})
    supa.onChange?.(() => mainWindow?.webContents.send('audit:updated'))
    auditStore = supa
  } else {
    auditStore = localStore
  }
  auditSync = new AuditSync({
    store: auditStore,
    gw2: () => gw2(),
    axitools: () => axitools(),
    gw2GuildId: () => (guilds.active()?.gw2ApiKey ? (guilds.active()?.gw2GuildId ?? null) : null),
    discordGuildId: () =>
      guilds.active()?.axitoolsKey ? (guilds.active()?.discordGuildId ?? null) : null,
    onUpdated: () => mainWindow?.webContents.send('audit:updated'),
    onError: (msg) => mainWindow?.webContents.send('audit:error', msg),
    onStatus: (status) => mainWindow?.webContents.send('audit:status', status)
  })
  auditSync.start()
}

/** Point retention history at the active workspace (Supabase) or local file. */
async function retargetRetention(): Promise<void> {
  const localPath = join(app.getPath('userData'), 'retentionHistory.json')
  const localHist = new LocalRetentionHistory(localPath)
  await retentionHistory?.stop?.().catch(() => {})
  if (activeWsConn) {
    const supa = new SupabaseRetentionRepo(activeWsConn)
    await supa.start().catch(() => {})
    await migrateRetentionToSupabase({
      workspaceId: activeWsConn.workspaceId,
      target: supa,
      local: localHist,
      getSetting: (k) => store.getSetting(k as never),
      setSetting: (k, v) => store.setSetting(k as never, v)
    }).catch(() => {})
    retentionHistory = supa
  } else {
    retentionHistory = localHist
  }
}
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
  attendance: AttendanceRaidDTO[]
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

// Dedupe concurrent roster builds. sync:changed + workspace:changed + tab
// switches can all fire near-simultaneously; without this each spawns its own
// (slow, retrying) AxiTools fetch — a timeout storm. Same active guild → share
// the in-flight build; a guild switch starts a fresh one.
let rosterBuildInFlight: { id: string | null; p: Promise<RosterPayload> } | null = null
function buildRosterDeduped(): Promise<RosterPayload> {
  const id = guilds.activeId()
  if (rosterBuildInFlight && rosterBuildInFlight.id === id) return rosterBuildInFlight.p
  const p = buildRoster()
  rosterBuildInFlight = { id, p }
  void p.finally(() => {
    if (rosterBuildInFlight?.p === p) rosterBuildInFlight = null
  })
  return p
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
    // Both calls hit the same AxiTools bot. Collect their failures and emit ONE
    // banner — when the bot is down both fail identically, and two near-duplicate
    // warnings ("links unavailable" + "roster unavailable") just read as noise.
    const discordErrs: string[] = []
    try {
      linked = asLinkedMembers(await at.membersLinked(discordGuildId as string))
    } catch (e) {
      discordErrs.push((e as Error).message)
    }
    try {
      const overview = await at.discordOverview(discordGuildId as string, true)
      discordMembers = asDiscordMembers(overview)
      discordRoles = asDiscordRoles(overview)
      discordSource.loaded = true
      discordSource.count = discordMembers.length
    } catch (e) {
      discordSource.error = (e as Error).message
      discordErrs.push((e as Error).message)
    }
    if (discordErrs.length) {
      const unique = [...new Set(discordErrs)]
      warnings.push(`Discord unavailable: ${unique.join(' · ')}`)
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
    annotations: roster.list().filter((a) => !isReservedAnnotationKey(a.memberId)),
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

  // Attendance data — only fetched when the guild has opted in via retentionEnabled.
  let attendance: AttendanceRaidDTO[] = []
  if (guild?.retentionEnabled && repos.length > 0) {
    try {
      attendance = await new AxibridgeClient(repos).attendanceRaids()
    } catch (e) {
      warnings.push(`Attendance data unavailable: ${(e as Error).message}`)
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
    attendance,
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

// The workspace the signed-in user is actually working in. Owners/leaders manage
// their active guild; but an INVITED member may have no local guild profile at
// all — their workspace comes from their server membership. So: prefer the
// active guild if the user is a member of it (multi-guild owners), otherwise
// fall back to their first membership (invited members). null if they belong to
// no workspace. RLS lets a member read their own workspace_members rows.
async function effectiveWorkspace(
  auth: DiscordAuth
): Promise<{ workspaceId: string; role: string } | null> {
  try {
    const client = auth.authedClient()
    const {
      data: { user }
    } = await client.auth.getUser()
    if (!user) return null
    const { data } = await client
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', user.id)
    const memberships = (data ?? []) as { workspace_id: string; role: string }[]
    if (memberships.length === 0) return null
    const active = activeWorkspaceId()
    const chosen = (active && memberships.find((m) => m.workspace_id === active)) || memberships[0]
    return { workspaceId: String(chosen.workspace_id), role: String(chosen.role) }
  } catch {
    return null
  }
}

// Give a member a (read-only) guild profile for the workspace they belong to so
// the guild shows up and they can see the roster. The GW2 key + guild are ALWAYS
// shared (the workspace), so the member gets a live roster pull. The AxiTools key
// is shared only if the owner opted in — otherwise the member adds their own.
// Returns true if the profile was created or its shared fields changed.
async function adoptWorkspaceGuild(auth: DiscordAuth): Promise<boolean> {
  const ws = await effectiveWorkspace(auth)
  if (!ws) return false
  // Never overwrite a member's own (non-shared) profile for this guild.
  const existing = guilds.all().find((g) => g.gw2GuildId === ws.workspaceId)
  if (existing && !existing.shared) return false
  try {
    const { data } = await auth
      .authedClient()
      .functions.invoke('get-shared-keys', { body: { guildId: ws.workspaceId } })
    const r = data as {
      apiKey?: string | null
      axitoolsKey?: string | null
      axitoolsShared?: boolean
      gw2GuildName?: string
      discordGuildId?: string
      discordGuildName?: string
      memberRoleId?: string
      bridgeRepos?: { owner: string; repo: string }[]
    } | null
    if (!r) return false

    const apiKey = r.apiKey ?? ''
    const gw2GuildName = r.gw2GuildName ?? ''
    const axitoolsShared = Boolean(r.axitoolsShared)
    const axitoolsKey = axitoolsShared ? (r.axitoolsKey ?? '') : (existing?.axitoolsKey ?? '')
    const memberRoleId = r.memberRoleId ?? ''
    const bridgeRepos = Array.isArray(r.bridgeRepos) ? r.bridgeRepos : []
    const reposKey = JSON.stringify(bridgeRepos)

    // No-op if nothing meaningful changed (avoids churn on every settings open).
    if (
      existing &&
      existing.gw2ApiKey === apiKey &&
      existing.gw2GuildName === gw2GuildName &&
      existing.axitoolsShared === axitoolsShared &&
      (!axitoolsShared || existing.axitoolsKey === axitoolsKey) &&
      existing.memberRoleId === memberRoleId &&
      JSON.stringify(existing.bridgeRepos) === reposKey
    ) {
      return false
    }
    guilds.upsert({
      id: existing?.id,
      name: existing?.name || gw2GuildName || 'Shared guild',
      gw2ApiKey: apiKey,
      gw2GuildId: ws.workspaceId,
      gw2GuildName,
      gw2AccountName: existing?.gw2AccountName ?? '',
      axitoolsKey,
      discordGuildId: existing?.discordGuildId || r.discordGuildId || '',
      discordGuildName: existing?.discordGuildName || r.discordGuildName || '',
      // Shared config: the member-role anchor + AxiBridge repos follow the workspace.
      memberRoleId,
      bridgeRepos,
      shared: true,
      axitoolsShared,
      retentionEnabled: existing?.retentionEnabled ?? false,
      pipelineEnabled: existing?.pipelineEnabled !== false
    })
    return !existing
  } catch {
    return false
  }
}

// Push the active guild's full config to the workspace so members share it.
// Owners push everything (keys + config) via share-keys; write members push only
// the non-secret config (member role + bridge repos) straight to workspaces (RLS
// allows can_write). Read members can't, and it's a no-op.
async function pushSharedConfig(auth: DiscordAuth, guildId: string): Promise<void> {
  const ws = await effectiveWorkspace(auth)
  if (!ws || ws.workspaceId !== guildId) return
  const guild = guilds.active()
  if (!guild || guild.gw2GuildId !== guildId) return
  const client = auth.authedClient()
  if (ws.role === 'owner') {
    await client
      .functions.invoke('share-keys', {
        body: {
          guildId,
          share: true,
          apiKey: guild.gw2ApiKey,
          axitoolsKey: guild.axitoolsKey,
          gw2GuildName: guild.gw2GuildName,
          discordGuildId: guild.discordGuildId,
          discordGuildName: guild.discordGuildName,
          memberRoleId: guild.memberRoleId,
          bridgeRepos: guild.bridgeRepos
        }
      })
      .catch(() => {})
  } else if (ws.role === 'write') {
    await client
      .from('workspaces')
      .update({ member_role_id: guild.memberRoleId, bridge_repos: guild.bridgeRepos })
      .eq('workspace_id', guildId)
      .then(undefined, () => {})
  }
}

// Remove adopted (shared) guild profiles for workspaces the user is no longer a
// member of — e.g. after the owner revokes their access. Returns true if any were
// removed. Never touches the member's own (non-shared) profiles.
async function pruneOrphanedSharedGuilds(auth: DiscordAuth): Promise<boolean> {
  const sharedGuilds = guilds.all().filter((g) => g.shared)
  if (sharedGuilds.length === 0) return false
  try {
    const client = auth.authedClient()
    const {
      data: { user }
    } = await client.auth.getUser()
    if (!user) return false
    const { data } = await client
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
    const memberOf = new Set((data ?? []).map((m: { workspace_id: string }) => m.workspace_id))
    let removed = false
    for (const g of sharedGuilds) {
      if (!memberOf.has(g.gw2GuildId)) {
        guilds.remove(g.id)
        removed = true
      }
    }
    if (removed) {
      // Wipe the workspace's cached data so a revoked member doesn't retain the
      // guild's notes/links/roster. A still-valid workspace re-backfills on initSync.
      roster.clear()
      links.clear()
      syncedMembers.clear()
    }
    return removed
  } catch {
    return false
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

  if (url && anonKey && auth) {
    const session = await auth.restoreSession().catch(() => null)
    // Drop adopted guilds for workspaces we were revoked from.
    if (session) await pruneOrphanedSharedGuilds(auth).catch(() => {})
    // Sync whichever workspace the user actually belongs to (their active guild
    // if they're a member of it, else their invited membership).
    const ws = session ? await effectiveWorkspace(auth) : null
    if (session && ws) {
      // Owners publish their full guild config (keys + member role + bridge repos)
      // on every connect — not just fresh sign-in — so it survives auto-update /
      // session restore.
      if (ws.role === 'owner') await pushSharedConfig(auth, ws.workspaceId).catch(() => {})
      // Stamp Discord usernames onto membership rows so the member panel shows
      // real names, not raw ids. The owner's call backfills every member from
      // their auth identity; a member's call backfills at least their own row.
      await auth
        .authedClient()
        .functions.invoke('stamp-identity', { body: { guildId: ws.workspaceId } })
        .catch(() => {})
      sync = new SupabaseSyncProvider(
        {
          url,
          anonKey,
          workspaceId: ws.workspaceId,
          accessToken: session.access_token,
          refreshToken: session.refresh_token
        },
        applySyncEvent,
        () => mainWindow?.webContents.send('workspace:changed')
      )
      activeWsConn = {
        url,
        anonKey,
        workspaceId: ws.workspaceId,
        accessToken: session.access_token,
        refreshToken: session.refresh_token
      }
      await sync.start().catch(() => {})
      // Upload local annotations/links created before sync connected. backfill
      // only pulls DOWN; without this, a leader's existing notes/manual links
      // never reach the cloud, so officers never see them. Best-effort; read
      // members' pushes are denied by RLS and ignored.
      await Promise.all([
        ...roster.list().map((a) => sync.pushAnnotation(a).catch(() => {})),
        ...links.list().map((l) => sync.pushLink(l).catch(() => {}))
      ])
    } else {
      sync = new LocalSyncProvider()
      activeWsConn = null
    }
  } else {
    sync = new LocalSyncProvider()
    activeWsConn = null
  }
  mainWindow?.webContents.send('workspace:changed')

  mainWindow?.webContents.send('sync:status', sync.status)

  // Point the audit + retention repos at the now-finalized connection (Supabase
  // when a workspace is active, local otherwise). Both branch on activeWsConn.
  await retargetAudit()
  await retargetRetention()
}

// ---- IPC -------------------------------------------------------------------

function registerIpc(): void {
  // settings (sync config + window only — guild credentials live in GuildStore)
  ipcMain.handle('settings:get', (_e, key: SettingKey) => store.getSetting(key))
  ipcMain.handle('settings:set', (_e, key: SettingKey, value: string) => store.setSetting(key, value))

  // Guild profiles
  ipcMain.handle('guilds:list', () => guilds.summaries())
  ipcMain.handle('guilds:get', (_e, id: string) => guilds.get(id))
  ipcMain.handle('guilds:upsert', async (_e, input: GuildProfileInput) => {
    const rec = guilds.upsert(input)
    // Editing a workspace guild propagates the shared config (owner/write only).
    const auth = getOrCreateDiscordAuth()
    if (auth && rec.gw2GuildId) await pushSharedConfig(auth, rec.gw2GuildId).catch(() => {})
    return guilds.summaries().find((g) => g.id === rec.id) ?? null
  })
  ipcMain.handle('guilds:remove', (_e, id: string) => guilds.remove(id))
  ipcMain.handle('guilds:setActive', async (_e, id: string) => {
    guilds.setActive(id)
    await initSync() // the workspace follows the active guild — re-point sync + audit/retention
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
      return ok(await buildRosterDeduped())
    } catch (e) {
      return fail(e)
    }
  })
  // Guild Log (local-only audit log; never synced)
  ipcMain.handle('audit:list', (_e, filter?: AuditFilter) => {
    if (!auditStore) return { events: [], updatedAt: '' }
    return { events: auditStore.list(filter), updatedAt: auditStore.lastUpdated() }
  })
  ipcMain.handle('audit:status', () => auditSync?.getStatus() ?? null)
  ipcMain.handle('audit:refresh', async () => {
    if (!auditSync) return ok(0)
    try {
      return ok(await auditSync.refresh())
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
  ipcMain.handle('roster:tags:get', () => {
    const rec = roster.get('meta:tags')
    if (!rec || !rec.notes) return {}
    try {
      const m = JSON.parse(rec.notes)
      return m && typeof m === 'object' && !Array.isArray(m) ? m : {}
    } catch {
      return {}
    }
  })
  ipcMain.handle('roster:tags:set', async (_e, map: Record<string, string>) => {
    // The `meta:tags` row intentionally persists even when `map` is `{}`. It stores
    // app metadata (the tag color registry), is filtered out of the member list via
    // `isReservedAnnotationKey`, and must NOT be pruned like an empty annotation.
    const rec = roster.upsert('meta:tags', { notes: JSON.stringify(map ?? {}) })
    if (rec) await sync.pushAnnotation(rec).catch(() => {})
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

  // ---- Recruitment pipeline (stored in reserved annotation rows) ----
  const PIPELINE_KEY = 'meta:pipeline'
  type PipelineDocShape = { stages?: unknown; placement: Record<string, string>; placedAt: Record<string, string> }
  const nowIso = (): string => new Date().toISOString()
  const pipelineParse = (notes: string): PipelineDocShape => {
    try {
      const r = JSON.parse(notes || '{}')
      return {
        stages: r?.stages,
        placement: r?.placement && typeof r.placement === 'object' ? r.placement : {},
        placedAt: r?.placedAt && typeof r.placedAt === 'object' ? r.placedAt : {}
      }
    } catch {
      return { stages: undefined, placement: {}, placedAt: {} }
    }
  }
  const pushRow = async (key: string): Promise<void> => {
    const rec = roster.get(key)
    if (rec) await sync.pushAnnotation(rec).catch(() => {})
  }
  const writePipeline = async (doc: PipelineDocShape): Promise<void> => {
    roster.upsert(PIPELINE_KEY, { notes: JSON.stringify(doc) })
    await pushRow(PIPELINE_KEY)
  }
  const readPipelineDoc = (): PipelineDocShape => {
    const rec = roster.get(PIPELINE_KEY)
    return rec ? pipelineParse(rec.notes) : { stages: undefined, placement: {}, placedAt: {} }
  }
  /** The caller's stable vote-row key, derived server-side from the session. */
  const currentVoterKey = async (): Promise<string | null> => {
    const auth = getOrCreateDiscordAuth()
    const session = auth ? await auth.restoreSession().catch(() => null) : null
    const id = session?.user?.id
    return id ? `vote:${id}` : null
  }

  ipcMain.handle('pipeline:get', async () => {
    const doc = readPipelineDoc()
    // Lazy backfill: stamp any placed subject lacking a placedAt so the
    // "time in stage" badge counts from today rather than showing blank.
    let backfilled = false
    for (const key of Object.keys(doc.placement)) {
      if (!doc.placedAt[key]) { doc.placedAt[key] = nowIso(); backfilled = true }
    }
    if (backfilled) await writePipeline(doc)
    const all = roster.list()
    const prospects = all.filter((a) => a.memberId.startsWith('prospect:'))
    const votes = all
      .filter((a) => a.memberId.startsWith('vote:'))
      .map((a) => {
        try {
          const row = JSON.parse(a.notes || '{}')
          return { voterId: a.memberId.slice('vote:'.length), row: row && typeof row === 'object' ? row : {} }
        } catch {
          return { voterId: a.memberId.slice('vote:'.length), row: {} }
        }
      })
    return { stages: doc.stages, placement: doc.placement, placedAt: doc.placedAt, prospects, votes }
  })

  ipcMain.handle('pipeline:setPlacement', async (_e, subjectKey: string, stageId: string) => {
    const doc = readPipelineDoc()
    doc.placement[subjectKey] = stageId
    doc.placedAt[subjectKey] = nowIso()
    await writePipeline(doc)
  })

  // Bulk-add many subjects (e.g. all members of a Discord role) into one stage,
  // in a single synced write.
  ipcMain.handle('pipeline:placeMany', async (_e, keys: string[], stageId: string) => {
    const doc = readPipelineDoc()
    const at = nowIso()
    for (const key of Array.isArray(keys) ? keys : []) {
      const k = String(key || '').trim()
      if (!k) continue
      doc.placement[k] = stageId
      doc.placedAt[k] = at
    }
    await writePipeline(doc)
  })

  ipcMain.handle('pipeline:setStages', async (_e, stages: unknown) => {
    const doc = readPipelineDoc()
    await writePipeline({ stages, placement: doc.placement, placedAt: doc.placedAt })
  })

  ipcMain.handle('pipeline:addProspect', async (_e, input: { name: string; handle?: string }) => {
    const id = `prospect:${randomUUID()}`
    const aliases = input?.handle ? [String(input.handle)] : []
    roster.upsert(id, { nickname: String(input?.name || 'Prospect'), aliases })
    // place in the first stage of the current doc (or 'applied')
    const doc = readPipelineDoc()
    const stagesArr = Array.isArray(doc.stages) ? (doc.stages as Array<{ id?: string }>) : []
    const firstStage = String(stagesArr[0]?.id || 'applied')
    doc.placement[id] = firstStage
    doc.placedAt[id] = nowIso()
    await writePipeline(doc)
    await pushRow(id)
    return roster.get(id)
  })

  ipcMain.handle('pipeline:removeProspect', async (_e, key: string) => {
    roster.remove(key)
    await sync.removeAnnotation(key).catch(() => {})
    const doc = readPipelineDoc()
    delete doc.placement[key]
    delete doc.placedAt[key]
    await writePipeline(doc)
    // purge from every vote row
    for (const a of roster.list().filter((x) => x.memberId.startsWith('vote:'))) {
      try {
        const row = JSON.parse(a.notes || '{}')
        if (row && typeof row === 'object' && key in row) {
          delete row[key]
          roster.upsert(a.memberId, { notes: JSON.stringify(row) })
          await pushRow(a.memberId)
        }
      } catch { /* ignore corrupt row */ }
    }
  })

  ipcMain.handle('pipeline:vote', async (_e, subjectKey: string, value: 'yes' | 'no' | 'abstain' | 'clear') => {
    const voterKey = await currentVoterKey()
    if (!voterKey) return
    const rec = roster.get(voterKey)
    let row: Record<string, string> = {}
    try { row = rec ? JSON.parse(rec.notes || '{}') : {} } catch { row = {} }
    if (value === 'clear') delete row[subjectKey]
    else row[subjectKey] = value
    roster.upsert(voterKey, { notes: JSON.stringify(row) })
    await pushRow(voterKey)
  })

  ipcMain.handle('pipeline:linkProspect', async (_e, prospectKey: string, memberKey: string) => {
    const prospect = roster.get(prospectKey)
    if (!prospect) return
    const member = roster.get(memberKey) ?? { nickname: '', aliases: [], notes: '', tags: [] }
    // union tags+aliases, keep member notes unless empty (mirror lib/pipeline.mergeAnnotationData)
    const lc = (s: string): string => s.toLowerCase()
    const tagSeen = new Set(member.tags.map(lc))
    const tags = [...member.tags]
    for (const t of prospect.tags) if (t && !tagSeen.has(lc(t))) { tagSeen.add(lc(t)); tags.push(t) }
    const aliasSeen = new Set([...member.aliases.map(lc), lc(member.nickname)])
    const aliases = [...member.aliases]
    for (const a of [prospect.nickname, ...prospect.aliases]) if (a && !aliasSeen.has(lc(a))) { aliasSeen.add(lc(a)); aliases.push(a) }
    const notes = member.notes && member.notes.trim() ? member.notes : prospect.notes
    roster.upsert(memberKey, { aliases, notes, tags })
    await pushRow(memberKey)
    // move placement
    const doc = readPipelineDoc()
    if (doc.placement[prospectKey] !== undefined) {
      doc.placement[memberKey] = doc.placement[prospectKey]
      delete doc.placement[prospectKey]
      if (doc.placedAt[prospectKey]) { doc.placedAt[memberKey] = doc.placedAt[prospectKey]; delete doc.placedAt[prospectKey] }
    }
    await writePipeline(doc)
    // re-key votes
    for (const a of roster.list().filter((x) => x.memberId.startsWith('vote:'))) {
      try {
        const r = JSON.parse(a.notes || '{}')
        if (r && typeof r === 'object' && prospectKey in r) {
          r[memberKey] = r[prospectKey]
          delete r[prospectKey]
          roster.upsert(a.memberId, { notes: JSON.stringify(r) })
          await pushRow(a.memberId)
        }
      } catch { /* ignore */ }
    }
    // remove the prospect row
    roster.remove(prospectKey)
    await sync.removeAnnotation(prospectKey).catch(() => {})
  })

  ipcMain.handle('pipeline:archivePassed', async () => {
    const doc = readPipelineDoc()
    const stagesArr = Array.isArray(doc.stages) ? (doc.stages as Array<{ id?: string; type?: string }>) : []
    const declined = new Set(stagesArr.filter((s) => s?.type === 'declined').map((s) => String(s?.id)))
    const removed: string[] = []
    for (const [subj, stage] of Object.entries(doc.placement)) {
      if (declined.has(stage)) { delete doc.placement[subj]; delete doc.placedAt[subj]; removed.push(subj) }
    }
    await writePipeline(doc)
    for (const a of roster.list().filter((x) => x.memberId.startsWith('vote:'))) {
      try {
        const r = JSON.parse(a.notes || '{}')
        let changed = false
        for (const subj of removed) if (subj in r) { delete r[subj]; changed = true }
        if (changed) { roster.upsert(a.memberId, { notes: JSON.stringify(r) }); await pushRow(a.memberId) }
      } catch { /* ignore */ }
    }
  })

  // Auth
  ipcMain.handle('auth:status', async () => {
    const auth = getOrCreateDiscordAuth()
    if (!auth) return { signedIn: false }
    const session = await auth.restoreSession().catch(() => null)
    if (!session) return { signedIn: false }
    // Role + workspace come from the user's membership (active guild for owners,
    // invited membership for members). null role => signed in but no workspace.
    const ws = await effectiveWorkspace(auth)
    return { signedIn: true, role: ws?.role, workspaceId: ws?.workspaceId, userId: session.user?.id ?? null }
  })

  ipcMain.handle('auth:signIn', async () => {
    const auth = getOrCreateDiscordAuth()
    if (!auth) return null
    try {
      const session = await signInViaLoopback(auth)
      // Pending invites are accepted explicitly by the user (see invites:* IPC),
      // not auto-redeemed. Resolve their workspace, then either publish the shared
      // config (owner) or adopt it (members).
      const ws = await effectiveWorkspace(auth)
      if (ws?.role === 'owner') await pushSharedConfig(auth, ws.workspaceId).catch(() => {})
      await adoptWorkspaceGuild(auth).catch(() => {})
      await initSync()
      return {
        accountName: session.user?.email ?? session.user?.id ?? '',
        role: ws?.role,
        workspaceId: ws?.workspaceId
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
    activeWsConn = null
    // Reset audit/retention to local too (tears down the old Supabase realtime channel).
    await retargetAudit()
    await retargetRetention()
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
          body: {
            apiKey: guild.gw2ApiKey,
            guildId: guild.gw2GuildId,
            guildName: guild.gw2GuildName,
            discordGuildId: guild.discordGuildId,
            discordGuildName: guild.discordGuildName
          }
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
      .select('user_id, discord_id, discord_username, discord_global_name, role')
      .eq('workspace_id', workspaceId)
    return (data ?? []).map((r: Record<string, unknown>) => ({
      userId: String(r.user_id),
      discordId: r.discord_id != null ? String(r.discord_id) : '',
      discordName: r.discord_username != null ? String(r.discord_username) : '',
      discordGlobalName: r.discord_global_name != null ? String(r.discord_global_name) : '',
      role: String(r.role)
    }))
  })

  // Role per workspace for the signed-in user, keyed by workspace_id (== gw2GuildId)
  // so the rail can badge every guild without switching to it. {} when signed out.
  ipcMain.handle('workspace:roles', async () => {
    const auth = getOrCreateDiscordAuth()
    if (!auth) return {}
    try {
      // Hydrate the session first — the client is created with persistSession:false,
      // so getUser() returns null until restoreSession() applies the stored session.
      // Without this the rail badges race auth:status and fall back to "local".
      const session = await auth.restoreSession().catch(() => null)
      if (!session) return {}
      const client = auth.authedClient()
      const {
        data: { user }
      } = await client.auth.getUser()
      if (!user) return {}
      const { data } = await client
        .from('workspace_members')
        .select('workspace_id, role')
        .eq('user_id', user.id)
      const out: Record<string, string> = {}
      for (const r of (data ?? []) as { workspace_id: string; role: string }[]) {
        out[String(r.workspace_id)] = String(r.role)
      }
      return out
    } catch {
      return {}
    }
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
        if (action === 'accept') {
          await adoptWorkspaceGuild(auth).catch(() => {})
          await initSync()
        }
        return { ok: true, workspaceId: result.workspaceId }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }
  )

  // Owner's view of invites they created that are still pending, with revoke.
  // RLS (is_owner) lets the owner read/delete workspace_invites directly.
  ipcMain.handle('invites:pending', async () => {
    const auth = getOrCreateDiscordAuth()
    if (!auth) return []
    const workspaceId = activeWorkspaceId()
    if (!workspaceId) return []
    const { data } = await auth
      .authedClient()
      .from('workspace_invites')
      .select('id, discord_id, code, role, created_at')
      .eq('workspace_id', workspaceId)
      .is('redeemed_by', null)
      .order('created_at', { ascending: true })
    return (data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      discordId: r.discord_id != null ? String(r.discord_id) : null,
      code: r.code != null ? String(r.code) : null,
      role: String(r.role)
    }))
  })

  ipcMain.handle('invites:revoke', async (_e, { inviteId }: { inviteId: string }) => {
    const auth = getOrCreateDiscordAuth()
    if (!auth) return { ok: false }
    const workspaceId = activeWorkspaceId()
    if (!workspaceId) return { ok: false }
    const { error } = await auth
      .authedClient()
      .from('workspace_invites')
      .delete()
      .eq('id', inviteId)
      .eq('workspace_id', workspaceId)
    return { ok: !error }
  })

  // Member side: adopt shared keys for the workspace (no-op if already have a
  // profile or the workspace doesn't share). Used after sign-in and on demand.
  ipcMain.handle('keys:adoptShared', async () => {
    const auth = getOrCreateDiscordAuth()
    if (!auth) return { adopted: false }
    // Revoked-from workspaces lose their adopted guild; current ones get adopted.
    const pruned = await pruneOrphanedSharedGuilds(auth).catch(() => false)
    const adopted = await adoptWorkspaceGuild(auth)
    if (adopted || pruned) {
      await initSync()
      mainWindow?.webContents.send('workspace:changed')
    }
    return { adopted }
  })

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
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  // ---- What's New (release notes baked into the app) ----------------------
  // RELEASE_NOTES.md ships in the asar (build.files); read it from the app path
  // when packaged, or the repo root in dev.
  function readBundledReleaseNotes(): string | null {
    const base = app.isPackaged ? app.getAppPath() : process.cwd()
    try {
      return readFileSync(join(base, 'RELEASE_NOTES.md'), 'utf8')
    } catch {
      return null
    }
  }
  // Notes for versions newer than what the user last saw — drives the auto popup.
  // `force` ignores lastSeen (the manual "What's new" button shows current notes).
  ipcMain.handle('whatsnew:get', (_e, force?: boolean) => {
    const version = app.getVersion()
    const lastSeenVersion = store.getSetting('lastSeenVersion')
    const raw = readBundledReleaseNotes()
    let releaseNotes: string | null = null
    if (raw) {
      releaseNotes = extractReleaseNotesRangeFromFile(raw, version, force ? null : lastSeenVersion)
      // Single-version file or no clean section match → show the whole thing.
      if (!releaseNotes && force) releaseNotes = raw.trim()
    }
    return { version, lastSeenVersion, releaseNotes }
  })
  ipcMain.handle('whatsnew:markSeen', (_e, version: string) => {
    store.setSetting('lastSeenVersion', version)
  })

  // Sync
  ipcMain.handle('sync:status', () => sync.status)
  ipcMain.handle('sync:reinit', async () => {
    await initSync()
    return sync.status
  })

  // Retention history (local-only score log)
  ipcMain.handle('retention:log', (_e, snapshots: RetentionSnapshot[]) => {
    retentionHistory.append(Array.isArray(snapshots) ? snapshots : [])
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
  retentionHistory = new LocalRetentionHistory(join(userData, 'retentionHistory.json'))
  await retargetAudit()

  registerIpc()
  createWindow()
  setupAutoUpdates(() => mainWindow)
  await initSync()

  // Revoke is enforced server-side instantly by RLS, but Realtime can't notify a
  // user who just lost access. Poll membership so an adopted guild disappears
  // shortly after the owner revokes (queued cleanup; access is already disabled).
  setInterval(() => void watchMembership(), 20_000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

async function watchMembership(): Promise<void> {
  if (!guilds.all().some((g) => g.shared)) return
  const auth = getOrCreateDiscordAuth()
  if (!auth) return
  const pruned = await pruneOrphanedSharedGuilds(auth).catch(() => false)
  if (pruned) {
    await initSync()
    mainWindow?.webContents.send('workspace:changed')
  }
}

app.on('window-all-closed', () => {
  roster.flush()
  links.flush()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  roster.flush()
  links.flush()
})
