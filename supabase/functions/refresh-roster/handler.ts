// supabase/functions/refresh-roster/handler.ts
import { decryptKey } from '../_shared/crypto.ts'
import type { GuildMember } from '../_shared/gw2.ts'

export interface RefreshDeps {
  keySecret: string
  decrypt: typeof decryptKey
  fetchMembers: (apiKey: string, guildId: string) => Promise<GuildMember[]>
  db: {
    isMember(ws: string, uid: string): Promise<boolean>
    getSecret(ws: string): Promise<string | null>
    upsertMembers(ws: string, rows: Record<string, unknown>[]): Promise<void>
  }
}

export async function handleRefresh(deps: RefreshDeps, input: { userId: string; guildId: string }) {
  if (!(await deps.db.isMember(input.guildId, input.userId)))
    return { status: 403, body: { error: 'not_member' } }
  const enc = await deps.db.getSecret(input.guildId)
  if (!enc) return { status: 409, body: { error: 'no_key' } }
  const apiKey = await deps.decrypt(enc, deps.keySecret)
  const members = await deps.fetchMembers(apiKey, input.guildId)
  const rows = members.map((m) => ({
    workspace_id: input.guildId, member_id: m.name, payload: m
  }))
  await deps.db.upsertMembers(input.guildId, rows)
  return { status: 200, body: { count: rows.length } }
}
