// src/main/audit/auditRepo.ts
//
// The audit-store seam. The local impl persists to JSON (offline / unclaimed
// guild); the Supabase impl is cache-backed so these synchronous methods keep
// working while Supabase is the source of truth. Mirrors the SyncProvider seam.
import type { AuditEvent } from '../auditNormalize'
import type { AuditPerson } from '../../shared/auditPerson'

export interface AuditCursors {
  gw2LastLogId?: number
  discordLastId?: string
}

export interface AuditFilter {
  source?: 'gw2' | 'discord'
  type?: string
  search?: string
  /** Only events that happened to this person (member history). */
  person?: AuditPerson
  limit?: number
}

export interface AuditRepo {
  /** Hydrate from the backend + start streaming. No-op for the local impl. */
  start(): Promise<void>
  stop(): Promise<void>
  /** Insert new events (deduped by uid). Returns how many were added. */
  merge(events: AuditEvent[]): number
  list(filter?: AuditFilter): AuditEvent[]
  getCursors(): AuditCursors
  setCursors(patch: AuditCursors): void
  counts(): { gw2: number; discord: number }
  lastUpdated(): string
  /** Fires when remote rows arrive (drives the audit:updated IPC push). */
  onChange?(cb: () => void): () => void
}
