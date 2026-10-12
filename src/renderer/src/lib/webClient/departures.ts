// src/renderer/src/lib/webClient/departures.ts
// Web read of the departure:* reserved annotation rows. Writes reuse
// webUpsertAnnotation; detection runs server-side in refresh-roster.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DepartureRow } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { activeWorkspaceId } from './discordGw2'

export async function webDeparturesGet(sb: SupabaseClient, settings: WebSettings): Promise<DepartureRow[]> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return []
  const { data, error } = await sb
    .from('roster_annotations')
    .select('member_id, notes')
    .eq('workspace_id', ws)
    .like('member_id', 'departure:%')
  if (error) return []
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    key: String(r.member_id),
    notes: typeof r.notes === 'string' ? r.notes : ''
  }))
}
