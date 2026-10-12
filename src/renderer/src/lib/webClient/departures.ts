// src/renderer/src/lib/webClient/departures.ts
// Web read of the departure:* reserved annotation rows. The rows are written by
// refresh-roster (web) and by the desktop's detection; writes from the UI reuse
// webUpsertAnnotation.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DepartureRow } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { activeWorkspaceId } from './discordGw2'
import { fetchAllPages } from './paging'

export async function webDeparturesGet(sb: SupabaseClient, settings: WebSettings): Promise<DepartureRow[]> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return []
  const { data, error } = await fetchAllPages((from, to) =>
    sb
      .from('roster_annotations')
      .select('member_id, notes')
      .eq('workspace_id', ws)
      .like('member_id', 'departure:%')
      .order('member_id', { ascending: true })
      .range(from, to)
  )
  if (error) return []
  return data.map((r) => ({ key: String(r.member_id), notes: typeof r.notes === 'string' ? r.notes : '' }))
}
