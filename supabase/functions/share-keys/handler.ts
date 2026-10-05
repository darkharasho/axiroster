// supabase/functions/share-keys/handler.ts
// Owner-only: turn key sharing on/off for a workspace. When on, the GW2 +
// AxiTools keys are stored encrypted (workspace_secrets) and the guild metadata
// + keys_shared flag are set on workspaces, so members can adopt them.
// No I/O: everything is injected by index.ts. db writes resolve to an error
// message, or null on success.
import { UNAVAILABLE, type PolicyIdentity } from '../_shared/policy.ts'

export interface ShareKeysBody {
  guildId?: string
  share?: boolean
  apiKey?: string
  axitoolsKey?: string
  gw2GuildName?: string
  discordGuildId?: string
  discordGuildName?: string
  memberRoleId?: string
  bridgeRepos?: unknown
  retentionEnabled?: boolean
  pipelineEnabled?: boolean
}

export interface ShareKeysDeps {
  keySecret: string
  encrypt(plain: string, secret: string): Promise<string>
  accountName(apiKey: string): Promise<string | null>
  blocked(ids: PolicyIdentity[]): Promise<boolean>
  /** The workspace's stored Discord server id (workspaceDiscordServer). */
  serverOf(ws: string): Promise<string | null>
  db: {
    role(ws: string, uid: string): Promise<string | null>
    upsertSecret(row: Record<string, unknown>): Promise<string | null>
    updateSecret(ws: string, patch: Record<string, unknown>): Promise<string | null>
    updateWorkspace(ws: string, patch: Record<string, unknown>): Promise<string | null>
  }
}

export async function handleShareKeys(
  deps: ShareKeysDeps,
  input: { userId: string; discordId: string | null; body: ShareKeysBody }
) {
  const body = input.body
  if (!body.guildId) return { status: 400, body: { error: 'guildId required' } }
  if ((await deps.db.role(body.guildId, input.userId)) !== 'owner') {
    return { status: 403, body: { error: 'not_owner' } }
  }

  if (body.share) {
    if (!body.apiKey) return { status: 400, body: { error: 'apiKey required' } }
    // Axi access policy: the owner, their GW2 account, the workspace's GW2 guild
    // and its Discord server, both the one being written and the one stored, so
    // a revoked server cannot be cleared or swapped out by re-sharing.
    if (await deps.blocked([
      { kind: 'discord_user', value: input.discordId },
      { kind: 'gw2_account', value: await deps.accountName(body.apiKey) },
      { kind: 'gw2_guild', value: body.guildId },
      { kind: 'discord_server', value: body.discordGuildId },
      { kind: 'discord_server', value: await deps.serverOf(body.guildId) }
    ])) {
      return { status: 403, body: UNAVAILABLE }
    }
    const e1 = await deps.db.upsertSecret({
      workspace_id: body.guildId,
      leader_key_enc: await deps.encrypt(body.apiKey, deps.keySecret),
      axitools_key_enc: body.axitoolsKey ? await deps.encrypt(body.axitoolsKey, deps.keySecret) : null
    })
    if (e1) return { status: 500, body: { error: e1 } }
    const wsUpdate: Record<string, unknown> = { keys_shared: true, has_leader_key: true }
    if (body.gw2GuildName != null) wsUpdate.guild_name = body.gw2GuildName
    if (body.discordGuildId != null) wsUpdate.discord_guild_id = body.discordGuildId
    if (body.discordGuildName != null) wsUpdate.discord_guild_name = body.discordGuildName
    if (body.memberRoleId != null) wsUpdate.member_role_id = body.memberRoleId
    if (Array.isArray(body.bridgeRepos)) wsUpdate.bridge_repos = body.bridgeRepos
    if (typeof body.retentionEnabled === 'boolean') wsUpdate.retention_enabled = body.retentionEnabled
    if (typeof body.pipelineEnabled === 'boolean') wsUpdate.pipeline_enabled = body.pipelineEnabled
    const e2 = await deps.db.updateWorkspace(body.guildId, wsUpdate)
    if (e2) return { status: 500, body: { error: e2 } }
    return { status: 200, body: { ok: true, shared: true } }
  }

  // Turning sharing off only takes access away, so a revoked owner may do it.
  await deps.db.updateSecret(body.guildId, { axitools_key_enc: null })
  await deps.db.updateWorkspace(body.guildId, { keys_shared: false })
  return { status: 200, body: { ok: true, shared: false } }
}
