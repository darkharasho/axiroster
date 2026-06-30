// src/renderer/src/lib/auditIdentities.ts
//
// Turns raw audit events into a render model where Discord usernames and GW2
// account names become identity "chips", resolved against the reconciled roster
// so a chip can show the Discord <-> GW2 tie when one exists.
//
// Resolution keys off structured fields in event.raw (reliable), not the prose
// summary: Discord events carry actor_id/target_id (Discord user ids, which equal
// ReconciledMember.memberId); GW2 events carry account names.

import type { AuditEvent, ReconciledMember } from '../../../preload/index.d'

/** One resolved identity to render as a chip. Both names present => tied. */
export interface ChipModel {
  discordName?: string
  gw2Account?: string
  /** Whether this identity was found in the roster (vs. a raw/unknown name). */
  known: boolean
  /** Which side the event referenced, for styling a one-sided/unknown chip. */
  side: 'discord' | 'gw2'
}

/** A run of action text; `b` marks an emphasized span (rank/role/item names). */
export interface Seg {
  t: string
  b?: boolean
}

export interface RowModel {
  lead?: ChipModel
  action: Seg[]
  trail?: ChipModel
  /** Set instead of the structured fields when the event type is unmapped. */
  fallback?: string
}

export interface IdentityIndex {
  byDiscordId: Map<string, ReconciledMember>
  byAccount: Map<string, ReconciledMember>
}

export function buildIdentityIndex(members: ReconciledMember[]): IdentityIndex {
  const byDiscordId = new Map<string, ReconciledMember>()
  const byAccount = new Map<string, ReconciledMember>()
  for (const m of members) {
    if (m.memberId) byDiscordId.set(m.memberId, m)
    for (const a of m.accounts) byAccount.set(a.account_name.toLowerCase(), m)
  }
  return { byDiscordId, byAccount }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function discordDisplay(m: ReconciledMember): string | undefined {
  return m.displayName || m.discordName || undefined
}

/** Strip a leading "<@123…>" mention and trailing "(handle)" the bot sometimes
 *  includes, leaving a readable label. */
function cleanDiscordName(raw?: string): string | undefined {
  const s = str(raw)
  if (!s) return undefined
  const noMention = s.replace(/^<@!?\d+>\s*/, '').trim()
  return noMention || s
}

function resolveDiscord(index: IdentityIndex, id?: string, name?: string): ChipModel {
  const m = id ? index.byDiscordId.get(id) : undefined
  if (m) {
    return {
      discordName: discordDisplay(m) ?? cleanDiscordName(name),
      gw2Account: m.accounts[0]?.account_name,
      known: true,
      side: 'discord'
    }
  }
  return { discordName: cleanDiscordName(name), known: false, side: 'discord' }
}

function resolveGw2(index: IdentityIndex, account?: string): ChipModel | undefined {
  const acct = str(account)
  if (!acct) return undefined
  const m = index.byAccount.get(acct.toLowerCase())
  if (m) {
    return { discordName: discordDisplay(m), gw2Account: acct, known: true, side: 'gw2' }
  }
  return { gw2Account: acct, known: false, side: 'gw2' }
}

function firstLine(s?: string): string | undefined {
  const v = str(s)
  return v ? v.split('\n')[0] : undefined
}

function humanizeType(t: string): string {
  return t.replace(/_/g, ' ')
}

const DISCORD_VERBS: Record<string, string> = {
  member_join: 'joined the server',
  member_leave: 'left the server',
  member_kick: 'was kicked',
  member_ban: 'was banned',
  member_unban: 'was unbanned',
  member_role_update: 'had roles changed',
  member_server_mute: 'was server-muted',
  member_server_unmute: 'was server-unmuted',
  member_server_deaf: 'was server-deafened',
  member_server_undeaf: 'was server-undeafened',
  message_delete: 'deleted a message in',
  message_edit: 'edited a message in',
  channel_create: 'created channel',
  channel_delete: 'deleted channel',
  channel_update: 'updated channel',
  role_create: 'created role',
  role_delete: 'deleted role',
  role_update: 'updated role',
  guild_update: 'updated the server',
  emoji_update: 'updated emojis'
}

export function discordVerb(eventType: string): string {
  return DISCORD_VERBS[eventType] ?? eventType.replace(/_/g, ' ')
}

function describeGw2(e: AuditEvent, index: IdentityIndex): RowModel {
  const r = e.raw as Record<string, unknown>
  const lead = resolveGw2(index, str(r.user))
  switch (e.type) {
    case 'joined':
      return { lead, action: [{ t: 'joined the guild' }] }
    case 'invited':
      return { lead, action: [{ t: 'was invited by' }], trail: resolveGw2(index, str(r.invited_by)) }
    case 'invite_declined':
      return { lead, action: [{ t: 'declined the guild invite' }] }
    case 'kick':
      return str(r.user) === str(r.kicked_by)
        ? { lead, action: [{ t: 'left the guild' }] }
        : { lead, action: [{ t: 'was kicked by' }], trail: resolveGw2(index, str(r.kicked_by)) }
    case 'rank_change':
      return {
        lead,
        action: [
          { t: 'rank changed ' },
          { t: str(r.old_rank) ?? '?', b: true },
          { t: ' → ' },
          { t: str(r.new_rank) ?? '?', b: true }
        ]
      }
    case 'treasury':
      return {
        lead,
        action: [
          { t: 'deposited ' },
          { t: `${typeof r.count === 'number' ? r.count : 0}× item ${str(r.item_id) ?? '?'}`, b: true },
          { t: ' to the treasury' }
        ]
      }
    case 'stash':
      return { lead, action: [{ t: `${str(r.operation) ?? 'moved'} guild stash items` }] }
    case 'motd':
      return { lead, action: [{ t: 'set the message of the day' }] }
    case 'upgrade':
      return { lead, action: [{ t: `${str(r.action) ?? 'worked on'} a guild upgrade` }] }
    default:
      return { action: [], fallback: e.summary }
  }
}

function describeDiscord(e: AuditEvent, index: IdentityIndex): RowModel {
  const r = e.raw as Record<string, unknown>
  const targetId = str(r.target_id)
  const actorId = str(r.actor_id)
  const detail = firstLine(str(r.details))
  const action: Seg[] = [{ t: detail ?? humanizeType(e.type) }]

  // Most Discord events centre on the affected member (target); a few (message
  // edits/deletes) have only an actor. Lead with whichever exists, and when an
  // acting moderator differs from the target, append "by <actor>".
  if (targetId || str(r.target_name)) {
    const lead = resolveDiscord(index, targetId, str(r.target_name))
    if ((actorId || str(r.actor_name)) && actorId !== targetId) {
      return { lead, action: [...action, { t: ' by' }], trail: resolveDiscord(index, actorId, str(r.actor_name)) }
    }
    return { lead, action }
  }
  if (actorId || str(r.actor_name)) {
    return { lead: resolveDiscord(index, actorId, str(r.actor_name)), action }
  }
  return { action: [], fallback: detail ?? e.summary }
}

/** Build the inline render model for one event. */
export function describeEvent(e: AuditEvent, index: IdentityIndex): RowModel {
  return e.source === 'gw2' ? describeGw2(e, index) : describeDiscord(e, index)
}
