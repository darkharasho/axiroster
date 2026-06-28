// src/main/audit/auditRows.ts
// Pure mappers between AuditEvent and the audit_events / audit_cursors rows.
// The full event is stored in `payload`; the broken-out columns exist only so
// the DB can filter/order. Mirrors annToRow/rowToAnn in supabaseSync.ts.
import type { AuditEvent } from '../auditNormalize'
import type { AuditCursors } from './auditRepo'

export function eventToRow(workspaceId: string, e: AuditEvent): Record<string, unknown> {
  return {
    workspace_id: workspaceId,
    uid: e.uid,
    source: e.source,
    type: e.type ?? '',
    actor: e.actor ?? '',
    target: e.target ?? '',
    summary: e.summary ?? '',
    ts: e.time,
    payload: e
  }
}

export function rowToEvent(r: Record<string, unknown>): AuditEvent {
  const p = (r.payload ?? null) as Partial<AuditEvent> | null
  if (p && typeof p === 'object' && typeof p.uid === 'string') return p as AuditEvent
  const uid = String(r.uid)
  return {
    uid,
    source: r.source === 'discord' ? 'discord' : 'gw2',
    id: uid.includes(':') ? uid.slice(uid.indexOf(':') + 1) : uid,
    time: typeof r.ts === 'string' ? r.ts : new Date(0).toISOString(),
    type: typeof r.type === 'string' ? r.type : '',
    actor: typeof r.actor === 'string' ? r.actor : '',
    target: typeof r.target === 'string' ? r.target : '',
    summary: typeof r.summary === 'string' ? r.summary : '',
    raw: null
  }
}

export function cursorsToRow(workspaceId: string, c: AuditCursors): Record<string, unknown> {
  return {
    workspace_id: workspaceId,
    gw2_last_log_id: c.gw2LastLogId ?? null,
    discord_last_id: c.discordLastId ?? null
  }
}

export function rowToCursors(r: Record<string, unknown>): AuditCursors {
  const out: AuditCursors = {}
  if (r.gw2_last_log_id != null) out.gw2LastLogId = Number(r.gw2_last_log_id)
  if (r.discord_last_id != null) out.discordLastId = String(r.discord_last_id)
  return out
}
