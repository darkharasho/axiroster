// supabase/functions/respond-invite/handler.ts
// The invitee accepts or rejects a specific invite. A user may only act on an
// unredeemed invite that targets THEIR immutable Discord id (canRespond).
// No I/O: everything is injected by index.ts.
import { canRespond, type Invite } from '../_shared/invite.ts'
import { UNAVAILABLE, type PolicyIdentity } from '../_shared/policy.ts'

export interface RespondDeps {
  blocked(ids: PolicyIdentity[]): Promise<boolean>
  /** The workspace's stored Discord server id (workspaceDiscordServer). */
  serverOf(ws: string): Promise<string | null>
  db: {
    getInvite(id: string): Promise<Invite | null>
    upsertMember(row: Record<string, unknown>): Promise<void>
    markRedeemed(id: string, uid: string): Promise<void>
    deleteInvite(id: string): Promise<void>
  }
}

export async function handleRespond(
  deps: RespondDeps,
  input: { userId: string; discordId: string | null; inviteId?: string; action?: string }
) {
  if (!input.inviteId || (input.action !== 'accept' && input.action !== 'reject')) {
    return { status: 400, body: { error: 'inviteId and action (accept|reject) required' } }
  }
  const invite = await deps.db.getInvite(input.inviteId)
  if (!canRespond(invite, input.discordId)) {
    return { status: 404, body: { error: 'invite not available' } }
  }
  const inv = invite as Invite

  if (input.action === 'accept') {
    // Axi access policy, as in redeem-invite: the caller, the workspace's GW2
    // guild and its stored Discord server. Refused before anything is written.
    if (await deps.blocked([
      { kind: 'discord_user', value: input.discordId },
      { kind: 'gw2_guild', value: inv.workspace_id },
      { kind: 'discord_server', value: await deps.serverOf(inv.workspace_id) }
    ])) {
      return { status: 403, body: UNAVAILABLE }
    }
    try {
      await deps.db.upsertMember({
        workspace_id: inv.workspace_id,
        user_id: input.userId,
        discord_id: input.discordId,
        role: inv.role
      })
    } catch (e) {
      return { status: 500, body: { error: (e as Error).message } }
    }
    await deps.db.markRedeemed(inv.id, input.userId)
    return { status: 200, body: { ok: true, workspaceId: inv.workspace_id, role: inv.role } }
  }

  // reject: drop the pending invite (grants nothing, so no policy check)
  await deps.db.deleteInvite(inv.id)
  return { status: 200, body: { ok: true, rejected: true } }
}
