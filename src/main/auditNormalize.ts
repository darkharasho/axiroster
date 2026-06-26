// src/main/auditNormalize.ts
//
// Pure mappers from the two raw audit sources — the GW2 guild log and the
// AxiTools Discord audit feed — into the unified AuditEvent shape the local
// store and the Log UI speak. No IO, no side effects: easy to unit-test.

import type { GuildLogEntry } from './gw2Client'

/** One normalized entry in the unified guild log. */
export interface AuditEvent {
  /** `${source}:${id}` — stable dedupe key across re-fetches. */
  uid: string
  source: 'gw2' | 'discord'
  /** Original id as a string (JS-safe for large Discord ids). */
  id: string
  /** ISO 8601 timestamp. */
  time: string
  /** Source event type, verbatim (e.g. 'joined', 'member_kick'). */
  type: string
  /** Primary subject / who the row is "about" (used for search + arrow display). */
  actor?: string
  /** The other party, when there is one (officer, kicker, inviter…). */
  target?: string
  /** One-line human-readable description. */
  summary: string
  /** Original payload, kept for the detail view. */
  raw: unknown
}

/** Wire shape of one AxiTools `/audit/discord` row (ids already strings). */
export interface DiscordAuditRaw {
  id: number | string
  created_at: string
  event_type: string
  actor_id?: string | null
  actor_name?: string | null
  target_id?: string | null
  target_name?: string | null
  details?: string | null
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0
}

function gw2Summary(e: GuildLogEntry): string {
  const user = str(e.user) ?? 'Someone'
  switch (e.type) {
    case 'joined':
      return `${user} joined the guild`
    case 'invited':
      return `${user} was invited by ${str(e.invited_by) ?? 'an officer'}`
    case 'invite_declined':
      return `${user} declined the guild invite`
    case 'kick':
      return str(e.user) === str(e.kicked_by)
        ? `${user} left the guild`
        : `${user} was kicked by ${str(e.kicked_by) ?? 'an officer'}`
    case 'rank_change':
      return `${user}'s rank changed from ${str(e.old_rank) ?? '?'} to ${str(e.new_rank) ?? '?'}`
    case 'treasury':
      return `${user} deposited ${num(e.count)}× item ${str(e.item_id) ?? '?'} to the treasury`
    case 'stash':
      return `${user} ${str(e.operation) ?? 'moved'} guild stash items`
    case 'motd':
      return `${user} set the message of the day`
    case 'upgrade':
      return `${user} ${str(e.action) ?? 'worked on'} a guild upgrade`
    default:
      return `${user} — ${e.type}`
  }
}

export function normalizeGw2(e: GuildLogEntry): AuditEvent {
  const other = str(e.invited_by) ?? str(e.kicked_by) ?? str(e.changed_by)
  return {
    uid: `gw2:${e.id}`,
    source: 'gw2',
    id: String(e.id),
    time: e.time,
    type: e.type,
    actor: str(e.user),
    target: other,
    summary: gw2Summary(e),
    raw: e
  }
}

function discordFallback(e: DiscordAuditRaw): string {
  const who = str(e.target_name) ?? str(e.actor_name) ?? 'Someone'
  const verb = e.event_type.replace(/_/g, ' ')
  return `${who}: ${verb}`
}

export function normalizeDiscord(e: DiscordAuditRaw): AuditEvent {
  return {
    uid: `discord:${e.id}`,
    source: 'discord',
    id: String(e.id),
    time: e.created_at,
    type: e.event_type,
    actor: str(e.actor_name),
    target: str(e.target_name),
    summary: str(e.details) ?? discordFallback(e),
    raw: e
  }
}
