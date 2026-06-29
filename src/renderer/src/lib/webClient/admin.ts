// src/renderer/src/lib/webClient/admin.ts
// The remaining web write methods: invite create/redeem/list-sent/revoke
// (workspace_invites + redeem-invite fn), retention logging (retention_snapshots),
// and honest "desktop-only" defaults for the guild-claim/add/remove flows that
// require a local GW2 leader key the browser doesn't hold.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { InviteResult, SentInvite } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { activeWorkspaceId } from './discordGw2'

function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}

export async function webCreateInvite(
  sb: SupabaseClient,
  settings: WebSettings,
  payload: { discordId?: string; code?: string; role?: string }
): Promise<InviteResult> {
  try {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) return { error: 'No active guild selected.' }
    if (payload.role !== 'write' && payload.role !== 'read') return { error: 'invalid_role' }
    const {
      data: { user }
    } = await sb.auth.getUser()
    const row: Record<string, unknown> = { workspace_id: ws, created_by: user?.id ?? null, role: payload.role }
    if (payload.discordId) row.discord_id = payload.discordId
    else row.code = payload.code || generateInviteCode()
    const { data } = await sb.from('workspace_invites').insert(row).select('code').single()
    return { code: (data as { code?: string } | null)?.code }
  } catch {
    return { error: 'failed' }
  }
}

export async function webRedeemInvite(
  sb: SupabaseClient,
  code: string
): Promise<{ ok: boolean; error?: string; role?: string; workspaceId?: string }> {
  const trimmed = (code ?? '').trim()
  if (!trimmed) return { ok: false, error: 'Enter an invite code' }
  try {
    const { data, error } = await sb.functions.invoke('redeem-invite', { body: { code: trimmed } })
    const r = (data ?? {}) as { error?: string; workspaceId?: string; role?: string }
    if (error || r.error)
      return { ok: false, error: r.error ?? (error as { message?: string } | null)?.message ?? 'Could not redeem' }
    return { ok: true, workspaceId: r.workspaceId, role: r.role }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function webPendingSentInvites(sb: SupabaseClient, settings: WebSettings): Promise<SentInvite[]> {
  try {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) return []
    const { data } = await sb
      .from('workspace_invites')
      .select('id, discord_id, code, role, created_at')
      .eq('workspace_id', ws)
      .is('redeemed_by', null)
      .order('created_at', { ascending: true })
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      discordId: r.discord_id != null ? String(r.discord_id) : null,
      code: r.code != null ? String(r.code) : null,
      role: String(r.role)
    }))
  } catch {
    return []
  }
}

export async function webRevokeInvite(
  sb: SupabaseClient,
  settings: WebSettings,
  inviteId: string
): Promise<{ ok: boolean }> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return { ok: false }
  const { error } = await sb.from('workspace_invites').delete().eq('id', inviteId).eq('workspace_id', ws)
  return { ok: !error }
}

export async function webAdoptSharedKeys(): Promise<{ adopted: boolean }> {
  // On web the member already uses the workspace's shared keys server-side (Edge
  // Functions); there is no local guild profile to adopt.
  return { adopted: false }
}

export async function webLogRetention(
  sb: SupabaseClient,
  settings: WebSettings,
  snapshots: { date: string; memberKey: string; score: number; tier: string }[]
): Promise<void> {
  try {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws || !Array.isArray(snapshots) || snapshots.length === 0) return
    const rows = snapshots.map((s) => ({
      workspace_id: ws,
      date: s.date,
      member_key: s.memberKey,
      score: s.score,
      tier: s.tier
    }))
    await sb.from('retention_snapshots').upsert(rows, { onConflict: 'workspace_id,date,member_key' })
  } catch {
    /* best-effort */
  }
}
