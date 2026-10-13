// src/renderer/src/lib/webClient/audit.ts
// Web audit log: read the Phase-0 audit_events table directly. The full
// AuditEvent is in the `payload` jsonb column; the broken-out columns
// (source/type/actor/target/summary/ts) are used for DB filtering. There is no
// server-side audit poller on web, so auditRefresh is a no-op.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuditEvent, AuditFilter, Result } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { activeWorkspaceId } from './discordGw2'
import {
  isPersonEmpty,
  PERSON_GW2_TYPES,
  PERSON_SELF_DISCORD_TYPES,
  type AuditPerson
} from '../../../../shared/auditPerson'

const TABLE = 'audit_events'

/** A PostgREST in-list of double-quoted values (account names hold spaces and dots). */
function quotedList(values: string[]): string {
  return `(${values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`
}

/** The person rule from shared/auditPerson as one PostgREST `or` expression.
 *  Discord ids live only inside the stored event, so they match on the payload. */
export function personOrFilter(p: AuditPerson): string {
  const parts: string[] = []
  if (p.accounts.length > 0) {
    parts.push(`and(source.eq.gw2,actor.in.${quotedList(p.accounts)},type.in.(${PERSON_GW2_TYPES.join(',')}))`)
  }
  if (p.discordIds.length > 0) {
    const ids = quotedList(p.discordIds)
    parts.push(`and(source.eq.discord,payload->raw->>target_id.in.${ids})`)
    parts.push(
      `and(source.eq.discord,type.in.(${PERSON_SELF_DISCORD_TYPES.join(',')}),payload->raw->>actor_id.in.${ids})`
    )
  }
  return parts.join(',')
}

export async function webAuditList(
  sb: SupabaseClient,
  settings: WebSettings,
  filter?: AuditFilter
): Promise<{ events: AuditEvent[]; updatedAt: string }> {
  try {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) return { events: [], updatedAt: '' }
    if (filter?.person && isPersonEmpty(filter.person)) return { events: [], updatedAt: '' }
    // Filters (eq/or) MUST precede the terminal order/limit in supabase-js.
    let q = sb.from(TABLE).select('payload').eq('workspace_id', ws)
    if (filter?.source) q = q.eq('source', filter.source)
    if (filter?.type) q = q.eq('type', filter.type)
    if (filter?.search) {
      const s = filter.search.replace(/[,()%*]/g, '').trim()
      if (s) q = q.or(`actor.ilike.%${s}%,target.ilike.%${s}%,summary.ilike.%${s}%`)
    }
    if (filter?.person) q = q.or(personOrFilter(filter.person))
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
