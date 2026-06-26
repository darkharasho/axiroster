export interface Invite {
  id: string; workspace_id: string; role: 'write' | 'read'
  code: string | null; discord_id: string | null; redeemed_by: string | null
}
export function matchInvite(
  invites: Invite[], q: { discordId: string | null; code?: string }
): Invite | null {
  if (q.code) return invites.find((i) => i.code === q.code && !i.redeemed_by) ?? null
  return invites.find((i) => i.discord_id && i.discord_id === q.discordId && !i.redeemed_by) ?? null
}
