// src/main/departureSync.ts
//
// Desktop side of departure detection: after a successful live GW2 pull, fold the
// guild's audit log + the roster diff into departure:* annotation rows. Each
// failing source is logged and skipped; nothing here may block the roster.
import {
  detectDepartures,
  parseDepartureDoc,
  serializeDepartureDoc,
  departureKey,
  DEPARTURE_PREFIX,
  type DepartureAuditEvent,
  type DepartureDoc,
  type DepartureLink,
  type DepartureRosterMember
} from '../shared/departures'

export interface DepartureSyncDeps {
  /** The guild (profile id) this roster build is for. */
  guildId: string
  /** The guild the audit store currently belongs to (null = none). The store is
   *  retargeted asynchronously on a guild switch, so it can briefly still hold
   *  the previous guild's log; detection must not fold that into this guild. */
  auditGuildId: string | null
  snapshot: { read(): string[] | null; write(accounts: string[]): void }
  auditEvents(): DepartureAuditEvent[]
  /** The guild's annotation rows (reserved rows included) — the server copy when
   *  one is reachable. A throw aborts detection with the snapshot untouched. */
  reservedRows(): { memberId: string; notes: string }[] | Promise<{ memberId: string; notes: string }[]>
  links: DepartureLink[]
  /** Persist one departure row (local store + sync push). */
  save(key: string, notes: string): Promise<void>
  log(msg: string): void
  now(): string
}

export async function syncDepartures(
  deps: DepartureSyncDeps,
  current: DepartureRosterMember[]
): Promise<number> {
  // A failed or empty pull says nothing about who left: keep the old snapshot.
  if (current.length === 0) return 0
  if (deps.auditGuildId !== deps.guildId) {
    deps.log('departures: audit log belongs to another guild (still retargeting); detection skipped')
    return 0
  }

  let auditEvents: DepartureAuditEvent[] = []
  try {
    auditEvents = deps.auditEvents()
  } catch (e) {
    deps.log(`departures: audit log unavailable: ${(e as Error).message}`)
  }
  let previous: string[] | null = null
  try {
    previous = deps.snapshot.read()
  } catch (e) {
    deps.log(`departures: snapshot unreadable: ${(e as Error).message}`)
  }

  const existing = new Map<string, DepartureDoc>()
  for (const r of await deps.reservedRows()) {
    if (r.memberId.startsWith(DEPARTURE_PREFIX)) existing.set(r.memberId, parseDepartureDoc(r.memberId, r.notes))
  }

  const res = detectDepartures({ previous, current, auditEvents, existing, links: deps.links, now: deps.now() })
  if (res.skipped === 'mass-drop') {
    deps.log(`departures: ${res.vanished.length} accounts vanished at once (mass drop); roster diff skipped`)
  }

  let written = 0
  const failed: string[] = []
  for (const doc of res.changed) {
    try {
      await deps.save(departureKey(doc.account), serializeDepartureDoc(doc))
      written++
    } catch (e) {
      failed.push(doc.account)
      deps.log(`departures: failed to save ${doc.account}: ${(e as Error).message}`)
    }
  }
  try {
    // Keep accounts whose save failed so they vanish again next run and are retried.
    const names = current.map((m) => m.name)
    const seen = new Set(names.map((n) => n.toLowerCase()))
    for (const a of failed) if (!seen.has(a.toLowerCase())) { names.push(a); seen.add(a.toLowerCase()) }
    deps.snapshot.write(names)
  } catch (e) {
    deps.log(`departures: snapshot write failed: ${(e as Error).message}`)
  }
  return written
}
