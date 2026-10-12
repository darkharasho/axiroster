// supabase/functions/refresh-roster/handler.ts
import { decryptKey } from '../_shared/crypto.ts'
import type { GuildMember } from '../_shared/gw2.ts'
import { UNAVAILABLE } from '../_shared/policy.ts'
import {
  detectDepartures,
  departureKey,
  parseDepartureDoc,
  serializeDepartureDoc,
  type DepartureAuditEvent,
  type DepartureLink
} from '../_shared/departures.ts'

export interface RefreshDeps {
  keySecret: string
  decrypt: typeof decryptKey
  fetchMembers: (apiKey: string, guildId: string) => Promise<GuildMember[]>
  /** The RLS predicate is_member(ws) asked as the caller (rlsMember): false for a revoked member. */
  allowed(ws: string): Promise<boolean>
  now?: () => string
  db: {
    isMember(ws: string, uid: string): Promise<boolean>
    getSecret(ws: string): Promise<string | null>
    upsertMembers(ws: string, rows: Record<string, unknown>[]): Promise<void>
    /** member_id of every roster_members row — the previous roster. */
    listMemberIds(ws: string): Promise<string[]>
    /** departure:* rows from roster_annotations. */
    listDepartures(ws: string): Promise<{ key: string; notes: string }[]>
    /** The workspace's gw2 kick + joined audit events. */
    listGw2Events(ws: string): Promise<DepartureAuditEvent[]>
    listLinks(ws: string): Promise<DepartureLink[]>
    upsertDepartures(ws: string, rows: { key: string; notes: string }[]): Promise<void>
    deleteMembers(ws: string, ids: string[]): Promise<void>
  }
}

export async function handleRefresh(deps: RefreshDeps, input: { userId: string; guildId: string }) {
  if (!(await deps.db.isMember(input.guildId, input.userId)))
    return { status: 403, body: { error: 'not_member' } }
  // Axi access policy: the leader key is read through the service role.
  if (!(await deps.allowed(input.guildId))) return { status: 403, body: UNAVAILABLE }
  const enc = await deps.db.getSecret(input.guildId)
  if (!enc) return { status: 409, body: { error: 'no_key' } }
  const apiKey = await deps.decrypt(enc, deps.keySecret)
  const members = await deps.fetchMembers(apiKey, input.guildId)

  // The previous roster must be read BEFORE the upsert overwrites it. An empty
  // table means this guild was never refreshed: no snapshot, so no diff.
  let previous: string[] | null = null
  let departuresError: string | undefined
  try {
    const ids = await deps.db.listMemberIds(input.guildId)
    previous = ids.length ? ids : null
  } catch (e) {
    departuresError = (e as Error).message
  }

  const rows = members.map((m) => ({
    workspace_id: input.guildId, member_id: m.name, payload: m
  }))
  await deps.db.upsertMembers(input.guildId, rows)

  // Departures never fail the refresh: errors are reported, the response stays 200.
  let departures = 0
  if (departuresError === undefined) {
    try {
      departures = await recordDepartures(deps, input.guildId, previous, members)
    } catch (e) {
      departuresError = (e as Error).message
    }
  }
  const body: Record<string, unknown> = { count: rows.length, departures }
  if (departuresError !== undefined) body.departuresError = departuresError
  return { status: 200, body }
}

async function recordDepartures(
  deps: RefreshDeps,
  ws: string,
  previous: string[] | null,
  members: GuildMember[]
): Promise<number> {
  const [rows, auditEvents, links] = await Promise.all([
    deps.db.listDepartures(ws),
    deps.db.listGw2Events(ws),
    deps.db.listLinks(ws)
  ])
  const existing = new Map(rows.map((r) => [r.key, parseDepartureDoc(r.key, r.notes)]))
  const res = detectDepartures({
    previous,
    current: members,
    auditEvents,
    existing,
    links,
    now: (deps.now ?? (() => new Date().toISOString()))()
  })
  if (res.changed.length) {
    await deps.db.upsertDepartures(
      ws,
      res.changed.map((d) => ({ key: departureKey(d.account), notes: serializeDepartureDoc(d) }))
    )
  }
  // A non-empty pull is authoritative for who is in the guild, so stale rows go
  // even when the mass-drop guard skipped recording diff episodes.
  if (members.length && res.vanished.length) await deps.db.deleteMembers(ws, res.vanished)
  return res.changed.length
}
