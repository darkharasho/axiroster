//
// Pure recruitment-pipeline logic. No React/DOM imports so it is node-testable.
// State is persisted in annotation rows (meta:pipeline, prospect:*, vote:*) by the
// main process; this module only parses/derives.

export type StageType = 'active' | 'accepted' | 'declined'
export interface PipelineStage { id: string; label: string; color: string; type: StageType }
export type VoteValue = 'yes' | 'no' | 'abstain'

export const DEFAULT_STAGES: PipelineStage[] = [
  { id: 'applied', label: 'Applied', color: 'slate', type: 'active' },
  { id: 'trialing', label: 'Trialing', color: 'blue', type: 'active' },
  { id: 'review', label: 'Review / Vote', color: 'amber', type: 'active' },
  { id: 'accepted', label: 'Accepted', color: 'emerald', type: 'accepted' },
  { id: 'passed', label: 'Passed', color: 'rose', type: 'declined' }
]

export interface PipelineDoc { stages: PipelineStage[]; placement: Record<string, string> }

function sanitizeStages(arr: unknown): PipelineStage[] {
  if (!Array.isArray(arr)) return DEFAULT_STAGES
  const out: PipelineStage[] = []
  for (const s of arr as Array<Record<string, unknown>>) {
    const id = String(s?.id || '').trim()
    if (!id) continue
    const t = s?.type
    const type: StageType = t === 'accepted' || t === 'declined' ? t : 'active'
    out.push({ id, label: String(s?.label || id), color: String(s?.color || 'slate'), type })
  }
  return out.length ? out : DEFAULT_STAGES
}

export function parsePipelineDoc(notes: string): PipelineDoc {
  if (!notes || !notes.trim()) return { stages: DEFAULT_STAGES, placement: {} }
  try {
    const raw = JSON.parse(notes) as { stages?: unknown; placement?: unknown }
    const stages = sanitizeStages(raw?.stages)
    const placement =
      raw?.placement && typeof raw.placement === 'object' && !Array.isArray(raw.placement)
        ? (raw.placement as Record<string, string>)
        : {}
    return { stages, placement }
  } catch {
    return { stages: DEFAULT_STAGES, placement: {} }
  }
}

export function parseVoteRow(notes: string): Record<string, VoteValue> {
  if (!notes || !notes.trim()) return {}
  try {
    const raw = JSON.parse(notes)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, VoteValue> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === 'yes' || v === 'no' || v === 'abstain') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

export function tallyVotes(rows: Record<string, VoteValue>[], subjectKey: string): { yes: number; no: number; abstain: number } {
  const t = { yes: 0, no: 0, abstain: 0 }
  for (const r of rows) {
    const v = r[subjectKey]
    if (v) t[v]++
  }
  return t
}

export interface PipelineSubject { key: string; name: string; accountName: string | null; isProspect: boolean; tags: string[] }

export function groupBoard(
  subjects: PipelineSubject[],
  placement: Record<string, string>,
  stages: PipelineStage[]
): Record<string, PipelineSubject[]> {
  const firstActive = stages.find((s) => s.type === 'active')?.id ?? stages[0]?.id ?? ''
  const valid = new Set(stages.map((s) => s.id))
  const board: Record<string, PipelineSubject[]> = {}
  for (const s of stages) board[s.id] = []
  for (const subj of subjects) {
    const placed = placement[subj.key]
    if (placed === undefined) continue
    const stageId = valid.has(placed) ? placed : firstActive
    if (board[stageId]) board[stageId].push(subj)
  }
  return board
}

export function mergeAnnotationData(
  target: { nickname: string; aliases: string[]; notes: string; tags: string[] },
  source: { nickname: string; aliases: string[]; notes: string; tags: string[] }
): { aliases: string[]; notes: string; tags: string[] } {
  const lc = (a: string): string => a.toLowerCase()
  const tagSeen = new Set(target.tags.map(lc))
  const tags = [...target.tags]
  for (const t of source.tags) if (t && !tagSeen.has(lc(t))) { tagSeen.add(lc(t)); tags.push(t) }
  const aliasSeen = new Set([...target.aliases.map(lc), lc(target.nickname)])
  const aliases = [...target.aliases]
  for (const a of [source.nickname, ...source.aliases]) if (a && !aliasSeen.has(lc(a))) { aliasSeen.add(lc(a)); aliases.push(a) }
  const notes = target.notes && target.notes.trim() ? target.notes : source.notes
  return { aliases, notes, tags }
}

export function rekeyVotes(row: Record<string, VoteValue>, fromKey: string, toKey: string): Record<string, VoteValue> {
  if (!(fromKey in row)) return row
  const next = { ...row }
  next[toKey] = next[fromKey]
  delete next[fromKey]
  return next
}
