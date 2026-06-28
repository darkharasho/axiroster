// src/renderer/src/components/RecruitmentView.tsx
//
// Recruitment kanban. Subjects = reconciled members + prospect:* rows, placed into
// stage columns via the shared meta:pipeline doc. Drag a card to restage. Votes,
// linking, and stage settings live alongside (added in the actions pass). Pipeline
// state is read via window.axiroster.pipeline* and is workspace-synced.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Users2, RefreshCw, Plus } from 'lucide-react'
import type { BridgePlayerMetrics, ReconciledMember, RosterPayload, RosterAnnotation } from '../../../preload/index.d'
import {
  DEFAULT_STAGES, parsePipelineDoc, parseVoteRow, groupBoard,
  type PipelineStage, type PipelineSubject, type VoteValue
} from '../lib/pipeline'
import { aggregateMemberMetrics } from '../lib/metrics'
import { parseRegistry, resolveColorId, tagStyle, dotColor, type TagRegistry } from '../lib/tagRegistry'
import { toast } from '../lib/toast'

const STAGE_DOT: Record<string, string> = { slate: '#94a3b8', blue: '#3b82f6', amber: '#f59e0b', emerald: '#10b981', rose: '#f43f5e' }

export default function RecruitmentView(): JSX.Element {
  const [payload, setPayload] = useState<RosterPayload | null>(null)
  const [stages, setStages] = useState<PipelineStage[]>(DEFAULT_STAGES)
  const [placement, setPlacement] = useState<Record<string, string>>({})
  const [prospects, setProspects] = useState<RosterAnnotation[]>([])
  const [voteRows, setVoteRows] = useState<Record<string, VoteValue>[]>([])
  const [myVote, setMyVote] = useState<Record<string, VoteValue>>({})
  const [myVoterId, setMyVoterId] = useState<string | null>(null)
  const [canEdit, setCanEdit] = useState(true)
  const [loading, setLoading] = useState(false)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [registry, setRegistry] = useState<TagRegistry>({})

  const load = useCallback(async () => {
    setLoading(true)
    const [roster, pipe, auth] = await Promise.all([
      window.axiroster.buildRoster(),
      window.axiroster.pipelineGet(),
      window.axiroster.authStatus()
    ])
    if (roster.ok) setPayload(roster.data)
    setCanEdit(auth.role !== 'read')
    setMyVoterId(auth.userId ?? null)
    // pipe.stages may be undefined → defaults; reuse the pure parser by round-tripping
    const doc = parsePipelineDoc(JSON.stringify({ stages: pipe.stages, placement: pipe.placement }))
    setStages(doc.stages)
    setPlacement(doc.placement)
    setProspects(pipe.prospects)
    setVoteRows(pipe.votes.map((v) => parseVoteRow(JSON.stringify(v.row))))
    const mine = pipe.votes.find((v) => v.voterId === (auth.userId ?? ''))
    setMyVote(mine ? parseVoteRow(JSON.stringify(mine.row)) : {})
    window.axiroster.getTagRegistry().then((m) => setRegistry(parseRegistry(JSON.stringify(m))))
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // Suppress unused-variable warnings for vote state used in future Task 5
  void voteRows
  void myVote
  void myVoterId

  const members: ReconciledMember[] = useMemo(() => payload?.members ?? [], [payload])
  const metrics: Record<string, BridgePlayerMetrics> = payload?.metrics ?? {}

  const subjects: PipelineSubject[] = useMemo(() => {
    const memberSubs: PipelineSubject[] = members.map((m) => ({
      key: m.annotationKey, name: m.label,
      accountName: m.accounts[0]?.account_name ?? null, isProspect: false, tags: m.tags
    }))
    const prospectSubs: PipelineSubject[] = prospects.map((p) => ({
      key: p.memberId, name: p.nickname || 'Prospect',
      accountName: p.aliases[0] ?? null, isProspect: true, tags: p.tags
    }))
    return [...memberSubs, ...prospectSubs]
  }, [members, prospects])

  const board = useMemo(() => groupBoard(subjects, placement, stages), [subjects, placement, stages])

  const restage = async (subjectKey: string, stageId: string): Promise<void> => {
    setPlacement((p) => ({ ...p, [subjectKey]: stageId })) // optimistic
    await window.axiroster.pipelineSetPlacement(subjectKey, stageId)
  }

  const addProspect = async (): Promise<void> => {
    const name = window.prompt('Prospect name (Discord handle or IGN):')?.trim()
    if (!name) return
    await window.axiroster.pipelineAddProspect({ name })
    toast('Prospect added')
    await load()
  }

  const attendanceOf = (m: PipelineSubject): string | null => {
    if (m.isProspect) return null
    const member = members.find((x) => x.annotationKey === m.key)
    if (!member) return null
    const agg = aggregateMemberMetrics(member.accounts, metrics)
    if (!agg || agg.raidsConsidered === 0) return null
    return `${Math.round((agg.raidsAttended / agg.raidsConsidered) * 100)}% · ${agg.raidsAttended} raids`
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-panel-line bg-panel-sunk px-4 py-2.5">
        <Users2 size={15} className="text-accent-soft" />
        <span className="text-sm font-semibold text-ink">Recruitment</span>
        <span className="text-xs text-ink-faint">· {Object.keys(placement).length} in pipeline</span>
        {canEdit && (
          <button onClick={addProspect} className="btn ml-auto px-2 py-1 text-xs"><Plus size={13} /> Add prospect</button>
        )}
        <button onClick={load} className={`btn px-2 ${canEdit ? '' : 'ml-auto'}`} title="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto p-4">
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(190px, 1fr))` }}>
          {stages.map((stage) => (
            <div
              key={stage.id}
              onDragOver={(e) => { if (canEdit && dragKey) e.preventDefault() }}
              onDrop={() => { if (canEdit && dragKey) { void restage(dragKey, stage.id); setDragKey(null) } }}
              className="rounded-xl border border-panel-line bg-panel-sunk p-2"
            >
              <div className="flex items-center gap-1.5 px-1.5 pb-2 pt-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: STAGE_DOT[stage.color] ?? '#94a3b8' }} />
                <span className="text-xs font-semibold">{stage.label}</span>
                <span className="ml-auto rounded-full bg-panel-raised px-1.5 font-mono text-[10px] text-ink-faint">{board[stage.id]?.length ?? 0}</span>
              </div>
              {(board[stage.id] ?? []).map((subj) => (
                <div
                  key={subj.key}
                  draggable={canEdit}
                  onDragStart={() => setDragKey(subj.key)}
                  onDragEnd={() => setDragKey(null)}
                  className="mb-2 cursor-grab rounded-lg border border-panel-line bg-panel-raised p-2.5 hover:border-panel-line2"
                >
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-ink">{subj.name}</div>
                      <div className="truncate text-[10.5px] text-ink-faint">{subj.accountName ?? 'Discord only'}</div>
                    </div>
                    {subj.isProspect && <span className="rounded border border-amber-500/30 px-1 text-[9px] uppercase tracking-wide text-amber-300">prospect</span>}
                  </div>
                  {subj.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {subj.tags.map((t) => {
                        const id = resolveColorId(t, registry)
                        return (
                          <span key={t} className="inline-flex items-center gap-1 rounded px-1.5 text-[10px]" style={tagStyle(id)}>
                            <span className="h-1 w-1 rounded-full" style={{ background: dotColor(id) }} />{t}
                          </span>
                        )
                      })}
                    </div>
                  )}
                  {attendanceOf(subj) && <div className="mt-1.5 text-[10.5px] text-ink-faint">⚔ {attendanceOf(subj)}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
