// src/shared/auditPerson.ts
// "Everything that happened to this person" — the per-member history rule,
// shared by the desktop in-memory filter and the web database query so both
// return the same rows.

/** One person's identities: their GW2 account names and Discord user ids. */
export interface AuditPerson {
  accounts: string[]
  discordIds: string[]
}

/** GW2 log types that happen *to* the person named in `user`. Stash, treasury,
 *  motd and upgrade entries are things they did, not things done to them. */
export const PERSON_GW2_TYPES = ['joined', 'invited', 'invite_declined', 'kick', 'rank_change']

/** Discord events with no target, where the person is the actor. */
export const PERSON_SELF_DISCORD_TYPES = ['member_join', 'member_leave']

interface PersonEvent {
  source: 'gw2' | 'discord'
  type: string
  actor?: string
  raw: unknown
}

function rawStr(raw: unknown, key: string): string | undefined {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[key] : undefined
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export function isPersonEmpty(p: AuditPerson): boolean {
  return p.accounts.length === 0 && p.discordIds.length === 0
}

export function matchesPerson(e: PersonEvent, p: AuditPerson): boolean {
  if (e.source === 'gw2') {
    return e.actor !== undefined && PERSON_GW2_TYPES.includes(e.type) && p.accounts.includes(e.actor)
  }
  const target = rawStr(e.raw, 'target_id')
  if (target) return p.discordIds.includes(target)
  const actor = rawStr(e.raw, 'actor_id')
  return actor !== undefined && PERSON_SELF_DISCORD_TYPES.includes(e.type) && p.discordIds.includes(actor)
}
