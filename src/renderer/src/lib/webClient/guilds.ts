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
    bridgeRepos: input.bridgeRepos,
    retentionEnabled: input.retentionEnabled,
    pipelineEnabled: input.pipelineEnabled
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

    // Edit: persist non-secret config (incl. feature flags) directly via RLS —
    // ws_update_write permits owner+write. share-keys would demand a GW2 apiKey
    // the browser doesn't hold for an existing guild, so only call it when the
    // owner is actually (re)entering keys. (Read members' update is RLS-filtered
    // to a harmless no-op; the editor form is hidden from them.)
    await sb
      .from('workspaces')
      .update({
        member_role_id: input.memberRoleId,
        bridge_repos: input.bridgeRepos,
        retention_enabled: input.retentionEnabled ?? false,
        pipeline_enabled: input.pipelineEnabled !== false
      })
      .eq('workspace_id', ws)
    if (input.gw2ApiKey) {
      await sb.functions.invoke('share-keys', { body: shareBody(input, ws) }).catch(() => {})
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
    // Owner-side guild deletion is destructive (wipes the workspace for every
    // member) and is a separate, deliberate future feature; a non-member has
    // nothing to leave. Only a non-owner member leaves here.
    if (role === null || role === 'owner') return
    const { data, error } = await sb
      .from('workspace_members')
      .delete()
      .eq('workspace_id', id)
      .eq('user_id', user.id)
      .select('user_id')
    // Clear the active guild only if RLS actually removed our row. Until the
    // wm_self_leave policy (migration 0010) is applied, the delete is filtered to
    // zero rows — don't pretend the leave worked.
    if (!error && Array.isArray(data) && data.length > 0 && settings.get('activeGuildId') === id) {
      settings.set('activeGuildId', '')
    }
  } catch {
    /* never throws */
  }
}
