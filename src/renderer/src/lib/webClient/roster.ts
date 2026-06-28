// src/renderer/src/lib/webClient/roster.ts
// Web roster: pre-fetch the workspace + synced members + annotations + links from
// Supabase, then feed the shared assembleRoster (which applies the adapters and
// reconcile). Discord comes from the axitools Edge Function; GW2 from the synced
// roster_members table (no client-side live pull). All best-effort sources degrade
// to warnings inside assembleRoster.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Result, RosterRefreshResult } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { invokeAxitools, activeWorkspaceId } from './discordGw2'
import {
  assembleRoster,
  type RosterAssemblyDeps,
  type GuildMeta,
  type RosterPayload
} from '../../../../shared/roster/assembleRoster'
import {
  isReservedAnnotationKey,
  type InGameMemberRaw,
  type ManualLinkRaw,
  type AnnotationRaw
} from '../../../../shared/rosterReconcile'
import { AxibridgeClient, type RepoRef } from '../../../../shared/axibridgeClient'

const ok = <T>(data: T): Result<T> => ({ ok: true, data })
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

function unwrap(r: Result<unknown>): unknown {
  if (!r.ok) throw new Error(r.error)
  return r.data
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

function wsRowToGuildMeta(row: Record<string, unknown> | null): GuildMeta {
  const repos = Array.isArray(row?.bridge_repos) ? (row!.bridge_repos as RepoRef[]) : []
  return {
    discordGuildId: str(row?.discord_guild_id),
    discordGuildName: str(row?.discord_guild_name),
    gw2GuildId: str(row?.workspace_id),
    gw2GuildName: str(row?.guild_name),
    // attempt the Discord source when a server is configured; the function reports
    // no_key if the workspace has no AxiTools key (web can't read workspace_secrets)
    hasAxitoolsKey: Boolean(row?.discord_guild_id),
    // web uses the synced roster source — never a client-side live GW2 pull
    hasGw2Key: false,
    memberRoleId: str(row?.member_role_id),
    bridgeRepos: repos,
    retentionEnabled: false
  }
}

function syncedFromRows(rows: Record<string, unknown>[]): InGameMemberRaw[] {
  return rows
    .map((r) => {
      const p = (r.payload ?? {}) as Record<string, unknown>
      return {
        name: typeof p.name === 'string' ? p.name : '',
        rank: typeof p.rank === 'string' ? p.rank : undefined,
        joined: typeof p.joined === 'string' ? p.joined : undefined
      }
    })
    .filter((m) => m.name)
}

function linksFromRows(rows: Record<string, unknown>[]): ManualLinkRaw[] {
  return rows.map((r) => ({ accountName: String(r.account_name), memberId: String(r.member_id) }))
}

function annsFromRows(rows: Record<string, unknown>[]): AnnotationRaw[] {
  return rows
    .map((r) => ({
      memberId: String(r.member_id),
      nickname: typeof r.nickname === 'string' ? r.nickname : '',
      aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [],
      notes: typeof r.notes === 'string' ? r.notes : '',
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
      mainAccount: typeof r.main_account === 'string' ? r.main_account : ''
    }))
    .filter((a) => !isReservedAnnotationKey(a.memberId))
}

export async function webBuildRoster(
  sb: SupabaseClient,
  settings: WebSettings
): Promise<Result<RosterPayload>> {
  try {
    const wsId = await activeWorkspaceId(sb, settings)
    if (!wsId) return fail('No active workspace')
    const [wsRes, memRes, linkRes, annRes] = await Promise.all([
      sb.from('workspaces').select('*').eq('workspace_id', wsId).maybeSingle(),
      sb.from('roster_members').select('member_id, payload').eq('workspace_id', wsId),
      sb.from('roster_links').select('account_name, member_id').eq('workspace_id', wsId),
      sb.from('roster_annotations').select('*').eq('workspace_id', wsId)
    ])
    const guild = wsRowToGuildMeta((wsRes.data ?? null) as Record<string, unknown> | null)
    const members = (memRes.data ?? []) as Record<string, unknown>[]
    const links = (linkRes.data ?? []) as Record<string, unknown>[]
    const anns = (annRes.data ?? []) as Record<string, unknown>[]
    const deps: RosterAssemblyDeps = {
      activeGuild: () => guild,
      membersLinked: async (gid) =>
        unwrap(await invokeAxitools(sb, { op: 'membersLinked', workspaceId: wsId, guildId: gid })),
      discordOverview: async (gid) =>
        unwrap(
          await invokeAxitools(sb, {
            op: 'discordOverview',
            workspaceId: wsId,
            guildId: gid,
            includeMembers: true
          })
        ),
      inGameMembers: async () => [],
      guildRanks: async () => [],
      syncedMembers: () => syncedFromRows(members),
      manualLinks: () => linksFromRows(links),
      annotations: () => annsFromRows(anns),
      bridgeMetrics: async (repos) => new AxibridgeClient(repos).playerMetrics(),
      attendance: async (repos) => new AxibridgeClient(repos).attendanceRaids()
    }
    return ok(await assembleRoster(deps))
  } catch (e) {
    return fail((e as Error).message)
  }
}

export async function webRefreshRoster(
  sb: SupabaseClient,
  settings: WebSettings
): Promise<RosterRefreshResult> {
  const wsId = await activeWorkspaceId(sb, settings)
  if (!wsId) throw new Error('No active workspace')
  const { data, error } = await sb.functions.invoke('refresh-roster', { body: { guildId: wsId } })
  if (error) throw error
  return { count: (data as { count?: number } | null)?.count ?? 0 }
}
