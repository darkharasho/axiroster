import {
  reconcileRoster,
  isReservedAnnotationKey,
  type DiscordMemberRaw,
  type LinkedMemberRaw,
  type InGameMemberRaw,
  type ManualLinkRaw,
  type AnnotationRaw
} from '../rosterReconcile'
import { asLinkedMembers, asDiscordMembers, asDiscordRoles, type DiscordRole } from './adapters'
import type { RepoRef, BridgePlayerMetrics, AttendanceRaidDTO } from '../axibridgeClient'

// ---- roster source selection ------------------------------------------------

/** Pure helper: when a leader key is present use the live GW2 pull, otherwise
 *  fall back to the synced roster_members table streamed via SyncEvents. */
export function rosterSourceFor(ctx: { hasLeaderKey: boolean }): 'live' | 'synced' {
  return ctx.hasLeaderKey ? 'live' : 'synced'
}

// ---- types ------------------------------------------------------------------

export interface SourceStatus {
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
export interface DiscordCandidate {
  id: string
  name: string
  displayName: string
}

export interface RosterPayload {
  members: import('../rosterReconcile').ReconciledMember[]
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

// ---- GuildMeta + RosterAssemblyDeps interfaces ------------------------------

export interface GuildMeta {
  discordGuildId: string | null
  discordGuildName: string | null
  gw2GuildId: string | null
  gw2GuildName: string | null
  hasAxitoolsKey: boolean
  hasGw2Key: boolean
  memberRoleId: string | null
  bridgeRepos: { owner: string; repo: string }[]
  retentionEnabled: boolean
}

export interface RosterAssemblyDeps {
  activeGuild(): GuildMeta | null
  // AxiTools (raw responses; assembler applies the adapters)
  membersLinked(discordGuildId: string): Promise<unknown>
  discordOverview(discordGuildId: string): Promise<unknown> // includeMembers=true
  // GW2 live source
  inGameMembers(gw2GuildId: string): Promise<InGameMemberRaw[]>
  guildRanks(gw2GuildId: string): Promise<{ id: string; order: number }[]>
  // Synced fallback (no leader key)
  syncedMembers(): InGameMemberRaw[]
  // Local stores
  manualLinks(): ManualLinkRaw[]
  annotations(): AnnotationRaw[]
  // AxiBridge (best-effort)
  bridgeMetrics(repos: RepoRef[]): Promise<Map<string, BridgePlayerMetrics>>
  attendance(repos: RepoRef[]): Promise<AttendanceRaidDTO[]>
}

// ---- assembleRoster ---------------------------------------------------------

export async function assembleRoster(deps: RosterAssemblyDeps): Promise<RosterPayload> {
  const warnings: string[] = []
  const guild = deps.activeGuild()
  const discordGuildId = guild?.discordGuildId || null
  const gw2GuildId = guild?.gw2GuildId || null

  const hasAxitoolsKey = guild?.hasAxitoolsKey ?? false
  const hasGw2Key = guild?.hasGw2Key ?? false
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
    // Both calls hit the same AxiTools bot. Collect their failures and emit ONE
    // banner — when the bot is down both fail identically, and two near-duplicate
    // warnings ("links unavailable" + "roster unavailable") just read as noise.
    const discordErrs: string[] = []
    try {
      linked = asLinkedMembers(await deps.membersLinked(discordGuildId as string))
    } catch (e) {
      discordErrs.push((e as Error).message)
    }
    try {
      const overview = await deps.discordOverview(discordGuildId as string)
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
      inGameRoster = await deps.inGameMembers(gw2GuildId as string)
      haveInGame = true
      gw2Source.loaded = true
      gw2Source.count = inGameRoster.length
      // Rank hierarchy is best-effort; if it fails the renderer falls back to
      // alphabetical rank sorting. Don't let it break the roster.
      try {
        for (const r of await deps.guildRanks(gw2GuildId as string)) rankOrder[r.id] = r.order
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
  } else if (rosterSource === 'synced') {
    // No leader key — build the in-game roster from the synced roster_members
    // table instead of a live GW2 pull. The payload shape mirrors InGameMemberRaw.
    const synced = deps.syncedMembers()
    for (const m of synced) inGameRoster.push(m)
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
    manualLinks: deps.manualLinks(),
    annotations: deps.annotations(),
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
      const m = await deps.bridgeMetrics(repos)
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
      attendance = await deps.attendance(repos)
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
