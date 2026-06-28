// src/renderer/src/lib/webClient/audit.ts
// Web audit log: read the Phase-0 audit_events table directly. The full
// AuditEvent is in the `payload` jsonb column; the broken-out columns
// (source/type/actor/target/summary/ts) are used for DB filtering. There is no
// server-side audit poller on web, so auditRefresh is a no-op.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuditEvent, AuditFilter, Result } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { activeWorkspaceId } from './discordGw2'

const TABLE = 'audit_events'

export async function webAuditList(
  sb: SupabaseClient,
  settings: WebSettings,
  filter?: AuditFilter
): Promise<{ events: AuditEvent[]; updatedAt: string }> {
  try {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) return { events: [], updatedAt: '' }
    // Filters (eq/or) MUST precede the terminal order/limit in supabase-js.
    let q = sb.from(TABLE).select('payload').eq('workspace_id', ws)
    if (filter?.source) q = q.eq('source', filter.source)
    if (filter?.type) q = q.eq('type', filter.type)
    if (filter?.search) {
      const s = filter.search.replace(/[,()%*]/g, '').trim()
      if (s) q = q.or(`actor.ilike.%${s}%,target.ilike.%${s}%,summary.ilike.%${s}%`)
    }
    const { data } = await q.order('ts', { ascending: false }).limit(filter?.limit ?? 1000)
    const events = ((data ?? []) as { payload: AuditEvent }[]).map((r) => r.payload).filter(Boolean)
    return { events, updatedAt: events[0]?.time ?? '' }
  } catch {
    return { events: [], updatedAt: '' }
  }
}

export async function webAuditRefresh(): Promise<Result<number>> {
  // No server-side audit poller on web; the Log shows whatever the desktop poller
  // has synced into audit_events. Genuinely 0 new events from the browser.
  return { ok: true, data: 0 }
}
