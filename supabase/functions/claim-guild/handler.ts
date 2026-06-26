// supabase/functions/claim-guild/handler.ts
import { verifyLeaderKey } from '../_shared/gw2.ts'
import { decideClaim } from '../_shared/claim.ts'
import { encryptKey } from '../_shared/crypto.ts'

export interface ClaimDeps {
  keySecret: string
  verify: typeof verifyLeaderKey
  encrypt: typeof encryptKey
  db: {
    countOwners(ws: string): Promise<number>
    upsertWorkspace(row: Record<string, unknown>): Promise<void>
    insertSecret(row: Record<string, unknown>): Promise<void>
    insertMember(row: Record<string, unknown>): Promise<void>
  }
}
export interface ClaimInput {
  userId: string; discordId: string | null; apiKey: string; guildId: string
  guildName?: string; discordGuildId?: string; discordGuildName?: string
  discordUsername?: string | null; discordGlobalName?: string | null
}

export async function handleClaim(deps: ClaimDeps, input: ClaimInput) {
  const { isLeader } = await deps.verify((globalThis as any).fetch, input.apiKey, input.guildId)
  const owners = await deps.db.countOwners(input.guildId)
  const decision = decideClaim(owners, isLeader)
  if (!decision.ok) {
    const status = decision.reason === 'already_claimed' ? 409 : 403
    return { status, body: { error: decision.reason } }
  }
  await deps.db.upsertWorkspace({
    workspace_id: input.guildId,
    guild_name: input.guildName ?? '',
    discord_guild_id: input.discordGuildId ?? '',
    discord_guild_name: input.discordGuildName ?? '',
    has_leader_key: true
  })
  await deps.db.insertSecret({
    workspace_id: input.guildId, leader_key_enc: await deps.encrypt(input.apiKey, deps.keySecret)
  })
  await deps.db.insertMember({
    workspace_id: input.guildId, user_id: input.userId, discord_id: input.discordId, role: 'owner',
    discord_username: input.discordUsername ?? null,
    discord_global_name: input.discordGlobalName ?? null
  })
  return { status: 200, body: { workspaceId: input.guildId, role: 'owner' } }
}
