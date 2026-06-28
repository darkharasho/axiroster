// src/renderer/src/lib/webClient/workspace.ts
// Web "guild" methods mapped to the Supabase workspace model: a guild is a
// workspace the user is a member of (workspace_members -> workspaces). Secrets
// aren't readable on web, so key fields map to ''. The reads degrade to empty
// values instead of throwing, so the App shell stays robust.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GuildSummary, GuildProfile, PendingInvite } from '../../../../preload/index.d'
import type { WebSettings } from './settings'

interface Membership {
  workspace_id: string
  role: string
}

async function userId(sb: SupabaseClient): Promise<string | null> {
  const {
    data: { user }
  } = await sb.auth.getUser()
  return user?.id ?? null
}

async function getMemberships(sb: SupabaseClient, uid: string): Promise<Membership[]> {
  const { data } = await sb.from('workspace_members').select('workspace_id, role').eq('user_id', uid)
  return (data ?? []) as Membership[]
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '')

function wsRowToSummary(row: Record<string, unknown>, activeId: string): GuildSummary {
  const id = s(row.workspace_id)
  return {
    id,
    name: s(row.guild_name) || 'Guild',
    active: id === activeId,
    gw2GuildName: s(row.guild_name),
    gw2GuildId: id,
    gw2AccountName: '',
    hasGw2Key: false,
    discordGuildName: s(row.discord_guild_name),
    discordGuildId: s(row.discord_guild_id),
    hasAxitoolsKey: Boolean(row.discord_guild_id),
    memberRoleId: s(row.member_role_id),
    bridgeRepos: Array.isArray(row.bridge_repos) ? (row.bridge_repos as GuildSummary['bridgeRepos']) : [],
    shared: true,
    axitoolsShared: Boolean(row.keys_shared),
    retentionEnabled: false,
    pipelineEnabled: true
  }
}

function wsRowToProfile(row: Record<string, unknown>): GuildProfile {
  const id = s(row.workspace_id)
  return {
    id,
    name: s(row.guild_name) || 'Guild',
    gw2ApiKey: '',
    gw2GuildId: id,
    gw2GuildName: s(row.guild_name),
    gw2AccountName: '',
    axitoolsKey: '',
    discordGuildId: s(row.discord_guild_id),
    discordGuildName: s(row.discord_guild_name),
    memberRoleId: s(row.member_role_id),
    bridgeRepos: Array.isArray(row.bridge_repos) ? (row.bridge_repos as GuildProfile['bridgeRepos']) : [],
    shared: true,
    axitoolsShared: Boolean(row.keys_shared),
    retentionEnabled: false,
    pipelineEnabled: true
  }
}

export async function webListGuilds(sb: SupabaseClient, settings: WebSettings): Promise<GuildSummary[]> {
  try {
    const uid = await userId(sb)
    if (!uid) return []
    const members = await getMemberships(sb, uid)
    if (members.length === 0) return []
    const ids = members.map((m) => m.workspace_id)
    const { data } = await sb.from('workspaces').select('*').in('workspace_id', ids)
    const rows = (data ?? []) as Record<string, unknown>[]
    const activeId = settings.get('activeGuildId') || ids[0]
    return rows.map((row) => wsRowToSummary(row, activeId))
  } catch {
    return []
  }
}

export async function webGetGuild(sb: SupabaseClient, id: string): Promise<GuildProfile | null> {
  try {
    const { data } = await sb.from('workspaces').select('*').eq('workspace_id', id).maybeSingle()
    return data ? wsRowToProfile(data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function webSetActiveGuild(settings: WebSettings, id: string): Promise<void> {
  settings.set('activeGuildId', id)
}

export async function webListWorkspaceRoles(sb: SupabaseClient): Promise<Record<string, string>> {
  try {
    const uid = await userId(sb)
    if (!uid) return {}
    const out: Record<string, string> = {}
    for (const m of await getMemberships(sb, uid)) out[m.workspace_id] = m.role
    return out
  } catch {
    return {}
  }
}

export async function webListInvites(sb: SupabaseClient): Promise<PendingInvite[]> {
  try {
    const { data, error } = await sb.functions.invoke('list-invites', { body: {} })
    if (error) return []
    return ((data as { invites?: PendingInvite[] } | null)?.invites ?? []) as PendingInvite[]
  } catch {
    return []
  }
}

export async function webRespondInvite(
  sb: SupabaseClient,
  inviteId: string,
  action: 'accept' | 'reject'
): Promise<{ ok: boolean; error?: string; workspaceId?: string }> {
  const { data, error } = await sb.functions.invoke('respond-invite', { body: { inviteId, action } })
  if (error) return { ok: false, error: (error as { message?: string }).message ?? 'request failed' }
  const d = (data ?? {}) as { ok?: boolean; workspaceId?: string }
  return { ok: d.ok ?? true, workspaceId: d.workspaceId }
}
