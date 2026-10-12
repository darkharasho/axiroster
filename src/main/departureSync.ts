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
  snapshot: { read(): string[] | null; write(accounts: string[]): void }
  auditEvents(): DepartureAuditEvent[]
  /** The active guild's annotation rows (reserved rows included). */
  reservedRows(): { memberId: string; notes: string }[]
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
  for (const r of deps.reservedRows()) {
    if (r.memberId.startsWith(DEPARTURE_PREFIX)) existing.set(r.memberId, parseDepartureDoc(r.memberId, r.notes))
  }

  const res = detectDepartures({ previous, current, auditEvents, existing, links: deps.links, now: deps.now() })
  if (res.skipped === 'mass-drop') {
    deps.log(`departures: ${res.vanished.length} accounts vanished at once (mass drop); roster diff skipped`)
  }

  let written = 0
  for (const doc of res.changed) {
    try {
      await deps.save(departureKey(doc.account), serializeDepartureDoc(doc))
      written++
    } catch (e) {
      deps.log(`departures: failed to save ${doc.account}: ${(e as Error).message}`)
    }
  }
  try {
    deps.snapshot.write(current.map((m) => m.name))
  } catch (e) {
    deps.log(`departures: snapshot write failed: ${(e as Error).message}`)
  }
  return written
}
