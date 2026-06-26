import { matchInvite, type Invite } from '../_shared/invite.ts'
export interface RedeemDeps {
  db: {
    listOpenInvites(q: { discordId: string | null; code?: string }): Promise<Invite[]>
    markRedeemed(id: string, uid: string): Promise<void>
    insertMember(row: Record<string, unknown>): Promise<void>
  }
}
export async function handleRedeem(
  deps: RedeemDeps, input: { userId: string; discordId: string | null; code?: string }
) {
  const invites = await deps.db.listOpenInvites({ discordId: input.discordId, code: input.code })
  const invite = matchInvite(invites, { discordId: input.discordId, code: input.code })
  if (!invite) return { status: 404, body: { error: 'no_invite' } }
  await deps.db.insertMember({
    workspace_id: invite.workspace_id, user_id: input.userId,
    discord_id: input.discordId, role: invite.role
  })
  await deps.db.markRedeemed(invite.id, input.userId)
  return { status: 200, body: { workspaceId: invite.workspace_id, role: invite.role } }
}
