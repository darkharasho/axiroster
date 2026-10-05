import { matchInvite, type Invite } from '../_shared/invite.ts'
import { UNAVAILABLE, type PolicyIdentity } from '../_shared/policy.ts'
export interface RedeemDeps {
  blocked(ids: PolicyIdentity[]): Promise<boolean>
  db: {
    listOpenInvites(q: { discordId: string | null; code?: string }): Promise<Invite[]>
    markRedeemed(id: string, uid: string): Promise<void>
    insertMember(row: Record<string, unknown>): Promise<void>
  }
}
export async function handleRedeem(
  deps: RedeemDeps,
  input: {
    userId: string
    discordId: string | null
    code?: string
    discordUsername?: string | null
    discordGlobalName?: string | null
  }
) {
  const invites = await deps.db.listOpenInvites({ discordId: input.discordId, code: input.code })
  const invite = matchInvite(invites, { discordId: input.discordId, code: input.code })
  if (!invite) return { status: 404, body: { error: 'no_invite' } }
  if (await deps.blocked([
    { kind: 'discord_user', value: input.discordId },
    { kind: 'gw2_guild', value: invite.workspace_id }
  ])) {
    return { status: 403, body: UNAVAILABLE }
  }
  await deps.db.insertMember({
    workspace_id: invite.workspace_id, user_id: input.userId,
    discord_id: input.discordId, role: invite.role,
    discord_username: input.discordUsername ?? null,
    discord_global_name: input.discordGlobalName ?? null
  })
  await deps.db.markRedeemed(invite.id, input.userId)
  return { status: 200, body: { workspaceId: invite.workspace_id, role: invite.role } }
}
