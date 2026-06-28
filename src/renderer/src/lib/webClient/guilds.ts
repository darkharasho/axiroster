// src/renderer/src/lib/webClient/guilds.ts
// Web guild create/configure/remove parity. Drives the same Edge Functions the
// desktop uses (claim-guild + share-keys); workspace_id === gw2GuildId. The
// desktop's save-local-then-claim two-step collapses to one server round-trip
// because the browser has no local guild cache to bridge them.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GuildSummary, GuildProfileInput, ClaimGuildResult } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { resolveEffectiveWorkspace } from './auth'

// My role for a specific workspace id (null if I'm not a member of it).
async function roleFor(sb: SupabaseClient, ws: string): Promise<string | null> {
  const {
    data: { user }
  } = await sb.auth.getUser()
  if (!user?.id) return null
  const { data } = await sb
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', user.id)
  const rows = (data ?? []) as { workspace_id: string; role: string }[]
  const found = rows.find((r) => r.workspace_id === ws)
  return found ? String(found.role) : null
}

function summaryFor(input: GuildProfileInput, ws: string, active: boolean): GuildSummary {
  return {
    id: ws,
    name: input.name,
    active,
    gw2GuildName: input.gw2GuildName,
    gw2GuildId: input.gw2GuildId,
    gw2AccountName: input.gw2AccountName,
    hasGw2Key: Boolean(input.gw2ApiKey),
    discordGuildName: input.discordGuildName,
    discordGuildId: input.discordGuildId,
    hasAxitoolsKey: Boolean(input.axitoolsKey),
    memberRoleId: input.memberRoleId,
    bridgeRepos: input.bridgeRepos,
    shared: input.shared ?? false,
    axitoolsShared: input.axitoolsShared ?? false,
    retentionEnabled: input.retentionEnabled ?? false,
    pipelineEnabled: input.pipelineEnabled !== false
  }
}

function shareBody(input: GuildProfileInput, ws: string): Record<string, unknown> {
  return {
    guildId: ws,
    share: true,
    apiKey: input.gw2ApiKey,
    axitoolsKey: input.axitoolsKey || undefined,
    gw2GuildName: input.gw2GuildName,
    discordGuildId: input.discordGuildId,
    discordGuildName: input.discordGuildName,
    memberRoleId: input.memberRoleId,
    bridgeRepos: input.bridgeRepos
  }
}

export async function webUpsertGuild(
  sb: SupabaseClient,
  settings: WebSettings,
  input: GuildProfileInput
): Promise<GuildSummary | null> {
  try {
    const ws = input.gw2GuildId
    if (!ws) return null // no GW2 guild ⇒ no workspace_id ⇒ can't create on the server

    if (!input.id) {
      // Create: claim, then push config.
      const { data, error } = await sb.functions.invoke('claim-guild', {
        body: {
          apiKey: input.gw2ApiKey,
          guildId: ws,
          guildName: input.name,
          discordGuildId: input.discordGuildId,
          discordGuildName: input.discordGuildName
        }
      })
      const res = (data ?? {}) as { error?: string; workspaceId?: string; role?: string }
      if (error || res.error) {
        // Re-configuring a guild I already own is fine; anything else fails.
        if (res.error === 'already_claimed' && (await roleFor(sb, ws)) === 'owner') {
          // fall through to share-keys
        } else {
          return null
        }
      }
      await sb.functions.invoke('share-keys', { body: shareBody(input, ws) }).catch(() => {})
      settings.set('activeGuildId', ws)
      return summaryFor(input, ws, true)
    }

    // Edit: push config by role (mirrors desktop pushSharedConfig).
    const role = await roleFor(sb, ws)
    if (role === 'owner') {
      await sb.functions.invoke('share-keys', { body: shareBody(input, ws) }).catch(() => {})
    } else if (role === 'write') {
      await sb
        .from('workspaces')
        .update({ member_role_id: input.memberRoleId, bridge_repos: input.bridgeRepos })
        .eq('workspace_id', ws)
    }
    const active = settings.get('activeGuildId') === ws
    return summaryFor(input, ws, active)
  } catch {
    return null
  }
}

export async function webClaimGuild(sb: SupabaseClient, settings: WebSettings): Promise<ClaimGuildResult> {
  try {
    const {
      data: { user }
    } = await sb.auth.getUser()
    if (!user?.id) return { ok: false, error: 'Not signed in' }
    const ws = await resolveEffectiveWorkspace(sb, settings, user.id)
    if (!ws) return { ok: false, error: 'Add a guild first.' }
    if (ws.role !== 'owner') return { ok: false, error: 'Only the owner can claim this guild.' }
    return { ok: true, workspaceId: ws.workspaceId }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function webRemoveGuild(sb: SupabaseClient, settings: WebSettings, id: string): Promise<void> {
  try {
    const {
      data: { user }
    } = await sb.auth.getUser()
    if (!user?.id) return
    const role = await roleFor(sb, id)
    if (role === null || role === 'owner') return // owner-delete is deferred (destructive)
    await sb.from('workspace_members').delete().eq('workspace_id', id).eq('user_id', user.id)
    if (settings.get('activeGuildId') === id) settings.set('activeGuildId', '')
  } catch {
    /* never throws */
  }
}
