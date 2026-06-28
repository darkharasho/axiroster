// src/renderer/src/lib/webClient/pipeline.ts
// Web recruitment pipeline: ports the desktop reserved-row board to direct
// roster_annotations ops. meta:pipeline holds { stages, placement, placedAt };
// prospect:<uuid> rows are prospect annotations; vote:<userId> rows hold a JSON
// { subjectKey: 'yes'|'no'|'abstain' } map. Reserved rows are written RAW (full
// row, no empty-prune) because their notes-JSON payload must persist.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RosterAnnotation } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { activeWorkspaceId } from './discordGw2'

const ANN = 'roster_annotations'
const PIPELINE_KEY = 'meta:pipeline'
const now = (): string => new Date().toISOString()

interface Doc {
  stages?: unknown
  placement: Record<string, string>
  placedAt: Record<string, string>
}
type Vote = 'yes' | 'no' | 'abstain'
interface PipelineResult {
  stages: unknown
  placement: Record<string, string>
  placedAt: Record<string, string>
  prospects: RosterAnnotation[]
  votes: { voterId: string; row: Record<string, Vote> }[]
}

function parseDoc(notes: unknown): Doc {
  try {
    const r = JSON.parse(typeof notes === 'string' && notes ? notes : '{}')
    return {
      stages: r?.stages,
      placement: r?.placement && typeof r.placement === 'object' ? r.placement : {},
      placedAt: r?.placedAt && typeof r.placedAt === 'object' ? r.placedAt : {}
    }
  } catch {
    return { stages: undefined, placement: {}, placedAt: {} }
  }
}

function rowToAnn(r: Record<string, unknown>): RosterAnnotation {
  return {
    memberId: String(r.member_id),
    nickname: typeof r.nickname === 'string' ? r.nickname : '',
    aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [],
    notes: typeof r.notes === 'string' ? r.notes : '',
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    mainAccount: typeof r.main_account === 'string' ? r.main_account : '',
    createdAt: typeof r.created_at === 'string' ? r.created_at : now(),
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : now()
  }
}

async function allRows(sb: SupabaseClient, ws: string): Promise<Record<string, unknown>[]> {
  const { data } = await sb.from(ANN).select('*').eq('workspace_id', ws)
  return (data ?? []) as Record<string, unknown>[]
}

async function getAnn(sb: SupabaseClient, ws: string, memberId: string): Promise<RosterAnnotation | null> {
  const { data } = await sb.from(ANN).select('*').eq('workspace_id', ws).eq('member_id', memberId).maybeSingle()
  return data ? rowToAnn(data as Record<string, unknown>) : null
}

async function upsertAnn(
  sb: SupabaseClient,
  ws: string,
  a: { memberId: string; nickname?: string; aliases?: string[]; notes?: string; tags?: string[]; mainAccount?: string }
): Promise<void> {
  await sb.from(ANN).upsert(
    {
      workspace_id: ws,
      member_id: a.memberId,
      nickname: a.nickname ?? '',
      aliases: a.aliases ?? [],
      notes: a.notes ?? '',
      tags: a.tags ?? [],
      main_account: a.mainAccount ?? '',
      updated_at: now()
    },
    { onConflict: 'workspace_id,member_id' }
  )
}

async function deleteAnn(sb: SupabaseClient, ws: string, memberId: string): Promise<void> {
  await sb.from(ANN).delete().eq('workspace_id', ws).eq('member_id', memberId)
}

async function readDoc(sb: SupabaseClient, ws: string): Promise<Doc> {
  const row = await getAnn(sb, ws, PIPELINE_KEY)
  return parseDoc(row?.notes)
}

async function writeDoc(sb: SupabaseClient, ws: string, doc: Doc): Promise<void> {
  await upsertAnn(sb, ws, { memberId: PIPELINE_KEY, notes: JSON.stringify(doc) })
}

function voteRows(rows: Record<string, unknown>[]): { memberId: string; map: Record<string, string> }[] {
  return rows
    .filter((r) => String(r.member_id).startsWith('vote:'))
    .map((r) => {
      let map: Record<string, string> = {}
      try {
        const j = JSON.parse(typeof r.notes === 'string' ? r.notes : '{}')
        map = j && typeof j === 'object' && !Array.isArray(j) ? j : {}
      } catch {
        map = {}
      }
      return { memberId: String(r.member_id), map }
    })
}

export async function webPipelineGet(sb: SupabaseClient, settings: WebSettings): Promise<PipelineResult> {
  const empty: PipelineResult = { stages: undefined, placement: {}, placedAt: {}, prospects: [], votes: [] }
  try {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) return empty
    const rows = await allRows(sb, ws)
    const doc = parseDoc(rows.find((r) => String(r.member_id) === PIPELINE_KEY)?.notes)
    let backfilled = false
    for (const key of Object.keys(doc.placement)) {
      if (!doc.placedAt[key]) {
        doc.placedAt[key] = now()
        backfilled = true
      }
    }
    if (backfilled) await writeDoc(sb, ws, doc)
    const prospects = rows.filter((r) => String(r.member_id).startsWith('prospect:')).map(rowToAnn)
    const votes = voteRows(rows).map((v) => ({
      voterId: v.memberId.slice('vote:'.length),
      row: v.map as Record<string, Vote>
    }))
    return { stages: doc.stages, placement: doc.placement, placedAt: doc.placedAt, prospects, votes }
  } catch {
    return empty
  }
}

export async function webPipelineSetPlacement(
  sb: SupabaseClient,
  settings: WebSettings,
  subjectKey: string,
  stageId: string
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  const doc = await readDoc(sb, ws)
  doc.placement[subjectKey] = stageId
  doc.placedAt[subjectKey] = now()
  await writeDoc(sb, ws, doc)
}

export async function webPipelinePlaceMany(
  sb: SupabaseClient,
  settings: WebSettings,
  keys: string[],
  stageId: string
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  const doc = await readDoc(sb, ws)
  const at = now()
  for (const key of Array.isArray(keys) ? keys : []) {
    const k = String(key || '').trim()
    if (!k) continue
    doc.placement[k] = stageId
    doc.placedAt[k] = at
  }
  await writeDoc(sb, ws, doc)
}

export async function webPipelineSetStages(
  sb: SupabaseClient,
  settings: WebSettings,
  stages: unknown
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  const doc = await readDoc(sb, ws)
  await writeDoc(sb, ws, { stages, placement: doc.placement, placedAt: doc.placedAt })
}

export async function webPipelineAddProspect(
  sb: SupabaseClient,
  settings: WebSettings,
  input: { name: string; handle?: string }
): Promise<RosterAnnotation> {
  const id = `prospect:${crypto.randomUUID()}`
  const nickname = String(input?.name || 'Prospect')
  const aliases = input?.handle ? [String(input.handle)] : []
  const annotation: RosterAnnotation = {
    memberId: id,
    nickname,
    aliases,
    notes: '',
    tags: [],
    mainAccount: '',
    createdAt: now(),
    updatedAt: now()
  }
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return annotation
  await upsertAnn(sb, ws, { memberId: id, nickname, aliases })
  const doc = await readDoc(sb, ws)
  const stagesArr = Array.isArray(doc.stages) ? (doc.stages as Array<{ id?: string }>) : []
  doc.placement[id] = String(stagesArr[0]?.id || 'applied')
  doc.placedAt[id] = now()
  await writeDoc(sb, ws, doc)
  return annotation
}

export async function webPipelineRemoveProspect(
  sb: SupabaseClient,
  settings: WebSettings,
  key: string
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  await deleteAnn(sb, ws, key)
  const doc = await readDoc(sb, ws)
  delete doc.placement[key]
  delete doc.placedAt[key]
  await writeDoc(sb, ws, doc)
  for (const v of voteRows(await allRows(sb, ws))) {
    if (key in v.map) {
      delete v.map[key]
      await upsertAnn(sb, ws, { memberId: v.memberId, notes: JSON.stringify(v.map) })
    }
  }
}

export async function webPipelineVote(
  sb: SupabaseClient,
  settings: WebSettings,
  subjectKey: string,
  value: 'yes' | 'no' | 'abstain' | 'clear'
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  const {
    data: { user }
  } = await sb.auth.getUser()
  if (!user?.id) return
  const voterKey = `vote:${user.id}`
  const existing = await getAnn(sb, ws, voterKey)
  let map: Record<string, string> = {}
  try {
    map = existing ? JSON.parse(existing.notes || '{}') : {}
  } catch {
    map = {}
  }
  if (value === 'clear') delete map[subjectKey]
  else map[subjectKey] = value
  await upsertAnn(sb, ws, { memberId: voterKey, notes: JSON.stringify(map) })
}

export async function webPipelineLinkProspect(
  sb: SupabaseClient,
  settings: WebSettings,
  prospectKey: string,
  memberKey: string
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  const prospect = await getAnn(sb, ws, prospectKey)
  if (!prospect) return
  const member =
    (await getAnn(sb, ws, memberKey)) ??
    ({ memberId: memberKey, nickname: '', aliases: [], notes: '', tags: [], mainAccount: '', createdAt: now(), updatedAt: now() } as RosterAnnotation)
  const lc = (s: string): string => s.toLowerCase()
  const tagSeen = new Set(member.tags.map(lc))
  const tags = [...member.tags]
  for (const t of prospect.tags) if (t && !tagSeen.has(lc(t))) { tagSeen.add(lc(t)); tags.push(t) }
  const aliasSeen = new Set([...member.aliases.map(lc), lc(member.nickname)])
  const aliases = [...member.aliases]
  for (const a of [prospect.nickname, ...prospect.aliases]) if (a && !aliasSeen.has(lc(a))) { aliasSeen.add(lc(a)); aliases.push(a) }
  const notes = member.notes && member.notes.trim() ? member.notes : prospect.notes
  await upsertAnn(sb, ws, { memberId: memberKey, nickname: member.nickname, aliases, notes, tags, mainAccount: member.mainAccount })
  const doc = await readDoc(sb, ws)
  if (doc.placement[prospectKey] !== undefined) {
    doc.placement[memberKey] = doc.placement[prospectKey]
    delete doc.placement[prospectKey]
    if (doc.placedAt[prospectKey]) {
      doc.placedAt[memberKey] = doc.placedAt[prospectKey]
      delete doc.placedAt[prospectKey]
    }
  }
  await writeDoc(sb, ws, doc)
  for (const v of voteRows(await allRows(sb, ws))) {
    if (prospectKey in v.map) {
      v.map[memberKey] = v.map[prospectKey]
      delete v.map[prospectKey]
      await upsertAnn(sb, ws, { memberId: v.memberId, notes: JSON.stringify(v.map) })
    }
  }
  await deleteAnn(sb, ws, prospectKey)
}

export async function webPipelineArchivePassed(sb: SupabaseClient, settings: WebSettings): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  const doc = await readDoc(sb, ws)
  const stagesArr = Array.isArray(doc.stages) ? (doc.stages as Array<{ id?: string; type?: string }>) : []
  const declined = new Set(stagesArr.filter((s) => s?.type === 'declined').map((s) => String(s?.id)))
  const removed: string[] = []
  for (const [subj, stage] of Object.entries(doc.placement)) {
    if (declined.has(stage)) {
      delete doc.placement[subj]
      delete doc.placedAt[subj]
      removed.push(subj)
    }
  }
  await writeDoc(sb, ws, doc)
  for (const v of voteRows(await allRows(sb, ws))) {
    let changed = false
    for (const subj of removed) if (subj in v.map) { delete v.map[subj]; changed = true }
    if (changed) await upsertAnn(sb, ws, { memberId: v.memberId, notes: JSON.stringify(v.map) })
  }
}
