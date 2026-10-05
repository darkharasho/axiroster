// supabase/functions/get-shared-keys/handler.ts
// Member-only: if the workspace shares its keys, return the decrypted GW2 +
// AxiTools keys and guild metadata so the member's app can adopt a guild profile.
// No I/O: everything is injected by index.ts.
import { UNAVAILABLE } from '../_shared/policy.ts'

export interface GetSharedKeysDeps {
  keySecret: string
  decrypt(enc: string, secret: string): Promise<string>
  /** The RLS predicate is_member(ws) asked as the caller (rlsMember): false for a revoked member. */
  allowed(ws: string): Promise<boolean>
  db: {
    isMember(ws: string, uid: string): Promise<boolean>
    getWorkspace(ws: string): Promise<Record<string, any> | null>
    getSecrets(ws: string): Promise<{ leader_key_enc?: string | null; axitools_key_enc?: string | null } | null>
  }
}

export async function handleGetSharedKeys(deps: GetSharedKeysDeps, input: { userId: string; guildId?: string }) {
  if (!input.guildId) return { status: 400, body: { error: 'guildId required' } }
  if (!(await deps.db.isMember(input.guildId, input.userId))) return { status: 403, body: { error: 'not_member' } }
  // Axi access policy: the keys are read through the service role, so RLS would
  // not stop a revoked member; ask its predicate before reading anything.
  if (!(await deps.allowed(input.guildId))) return { status: 403, body: UNAVAILABLE }

  const ws = await deps.db.getWorkspace(input.guildId)
  const sec = await deps.db.getSecrets(input.guildId)

  // The whole guild config is shared with members: GW2 key, AxiTools key, the
  // member-role anchor, and the AxiBridge repos. read/write gates who can EDIT it.
  const axitoolsShared = Boolean(sec?.axitools_key_enc)
  return {
    status: 200,
    body: {
      apiKey: sec?.leader_key_enc ? await deps.decrypt(sec.leader_key_enc, deps.keySecret) : null,
      axitoolsShared,
      axitoolsKey: axitoolsShared ? await deps.decrypt(sec!.axitools_key_enc!, deps.keySecret) : null,
      gw2GuildId: input.guildId,
      gw2GuildName: ws?.guild_name ?? '',
      discordGuildId: ws?.discord_guild_id ?? '',
      discordGuildName: ws?.discord_guild_name ?? '',
      memberRoleId: ws?.member_role_id ?? '',
      bridgeRepos: Array.isArray(ws?.bridge_repos) ? ws.bridge_repos : [],
      retentionEnabled: Boolean(ws?.retention_enabled),
      pipelineEnabled: ws?.pipeline_enabled !== false
    }
  }
}
