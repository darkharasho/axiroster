// src/renderer/src/lib/webClient/members.ts
// Web workspace-member management: list/setRole/revoke against workspace_members
// (role changes are owner-gated by RLS), plus the Discord member list via the
// axitools function. Mirrors the desktop members:* / discord:members handlers.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkspaceMember, DiscordRosterMember } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { activeWorkspaceId, invokeAxitools } from './discordGw2'
import { asDiscordMembers } from '../../../../shared/roster/adapters'

export async function webListMembers(sb: SupabaseClient, settings: WebSettings): Promise<WorkspaceMember[]> {
  try {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) return []
    const { data } = await sb
      .from('workspace_members')
      .select('user_id, discord_id, discord_username, discord_global_name, role')
      .eq('workspace_id', ws)
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      userId: String(r.user_id),
      discordId: r.discord_id != null ? String(r.discord_id) : '',
      discordName: r.discord_username != null ? String(r.discord_username) : '',
      discordGlobalName: r.discord_global_name != null ? String(r.discord_global_name) : '',
      role: String(r.role)
    }))
  } catch {
    return []
  }
}

export async function webSetMemberRole(
  sb: SupabaseClient,
  settings: WebSettings,
  userId: string,
  role: string
): Promise<void> {
  if (role !== 'write' && role !== 'read') return
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  await sb.from('workspace_members').update({ role }).eq('workspace_id', ws).eq('user_id', userId)
}

export async function webRevokeMember(
  sb: SupabaseClient,
  settings: WebSettings,
  userId: string
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  await sb.from('workspace_members').delete().eq('workspace_id', ws).eq('user_id', userId)
}

export async function webDiscordMembers(
  sb: SupabaseClient,
  settings: WebSettings
): Promise<DiscordRosterMember[]> {
  try {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) return []
    const { data: wsRow } = await sb
      .from('workspaces')
      .select('discord_guild_id')
      .eq('workspace_id', ws)
      .maybeSingle()
    const discordGuildId = (wsRow as { discord_guild_id?: string } | null)?.discord_guild_id
    if (!discordGuildId) return []
    const r = await invokeAxitools(sb, {
      op: 'discordOverview',
      workspaceId: ws,
      guildId: discordGuildId,
      includeMembers: true
    })
    if (!r.ok) return []
    return asDiscordMembers(r.data)
      .filter((m) => !m.bot)
      .map((m) => ({ id: m.id, name: m.name ?? m.id, displayName: m.display_name ?? m.name ?? m.id }))
  } catch {
    return []
  }
}
