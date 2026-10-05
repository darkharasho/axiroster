// supabase/functions/stamp-identity/handler.ts
// Stamps Discord username + display name onto workspace_members rows so the
// member-management panel shows real names instead of raw Discord ids (which
// happened when the AxiTools bot roster couldn't resolve them).
//
// The caller's own row is always stamped from their token. If a guildId is
// given and the caller belongs to it, EVERY member of that workspace is
// backfilled by reading their trustworthy auth.identities via the admin API —
// so the owner opening the app once repopulates names for everyone.
// No I/O: everything is injected by index.ts.
import { discordIdFromUser, discordNamesFromUser, type UserLike } from '../_shared/identity.ts'
import { UNAVAILABLE, type PolicyIdentity } from '../_shared/policy.ts'

export interface StampDeps {
  blocked(ids: PolicyIdentity[]): Promise<boolean>
  /** The workspace's stored Discord server id (workspaceDiscordServer). */
  serverOf(ws: string): Promise<string | null>
  db: {
    stampSelf(uid: string, names: Record<string, unknown>): Promise<void>
    isMember(ws: string, uid: string): Promise<boolean>
    memberIds(ws: string): Promise<string[]>
    getUser(uid: string): Promise<UserLike | null>
    stampMember(ws: string, uid: string, row: Record<string, unknown>): Promise<void>
  }
}

export async function handleStamp(deps: StampDeps, input: { user: UserLike & { id: string }; guildId?: string }) {
  const { user, guildId } = input
  // Axi access policy: a revoked user or workspace is not stamped or backfilled.
  if (await deps.blocked([
    { kind: 'discord_user', value: discordIdFromUser(user) },
    { kind: 'gw2_guild', value: guildId },
    { kind: 'discord_server', value: guildId ? await deps.serverOf(guildId) : null }
  ])) {
    return { status: 403, body: UNAVAILABLE }
  }

  // Always stamp the caller's own membership rows from their own identity.
  const self = discordNamesFromUser(user)
  await deps.db.stampSelf(user.id, { discord_username: self.username, discord_global_name: self.globalName })

  let stamped = 1
  // Confirm the caller actually belongs to the workspace before reading peers.
  if (guildId && (await deps.db.isMember(guildId, user.id))) {
    for (const uid of await deps.db.memberIds(guildId)) {
      if (uid === user.id) continue
      const u = await deps.db.getUser(uid)
      if (!u) continue
      const names = discordNamesFromUser(u)
      await deps.db.stampMember(guildId, uid, {
        discord_id: discordIdFromUser(u),
        discord_username: names.username,
        discord_global_name: names.globalName
      })
      stamped++
    }
  }
  return { status: 200, body: { stamped } }
}
