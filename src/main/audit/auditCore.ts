// src/main/audit/auditCore.ts
// Pure audit-event logic shared by LocalAuditStore and SupabaseAuditRepo so the
// dedupe/sort/cap/filter rules live in exactly one place.
import type { AuditEvent } from '../auditNormalize'
import type { AuditFilter } from './auditRepo'

export const MAX_AUDIT_EVENTS = 50000

/** Insert `incoming` into `existing` (mutated in place), deduped by uid, kept
 *  newest-first, capped at MAX_AUDIT_EVENTS. Returns how many were added. */
export function mergeAuditEvents(existing: AuditEvent[], incoming: AuditEvent[]): number {
  if (incoming.length === 0) return 0
  const have = new Set(existing.map((e) => e.uid))
  let added = 0
  for (const e of incoming) {
    if (have.has(e.uid)) continue
    have.add(e.uid); existing.push(e); added++
  }
  if (added > 0) {
    existing.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0))
    if (existing.length > MAX_AUDIT_EVENTS) existing.length = MAX_AUDIT_EVENTS
  }
  return added
}

export function filterAuditEvents(events: AuditEvent[], filter: AuditFilter = {}): AuditEvent[] {
  const limit = filter.limit ?? 1000
  const q = filter.search?.trim().toLowerCase()
  const out: AuditEvent[] = []
  for (const e of events) {
    if (filter.source && e.source !== filter.source) continue
    if (filter.type && e.type !== filter.type) continue
    if (q && !`${e.actor ?? ''} ${e.target ?? ''} ${e.summary}`.toLowerCase().includes(q)) continue
    out.push(e)
    if (out.length >= limit) break
  }
  return out
}

export function countsBySource(events: AuditEvent[]): { gw2: number; discord: number } {
  let gw2 = 0, discord = 0
  for (const e of events) { if (e.source === 'gw2') gw2++; else discord++ }
  return { gw2, discord }
}
