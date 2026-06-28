// src/renderer/src/components/RecruitmentView.tsx
//
// Recruitment kanban. Subjects = reconciled members + prospect:* rows, placed into
// stage columns via the shared meta:pipeline doc. Drag a card to restage. Votes,
// linking, and stage settings live alongside (added in the actions pass). Pipeline
// state is read via window.axiroster.pipeline* and is workspace-synced.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Users2, RefreshCw, Plus, Settings, Archive } from 'lucide-react'
import type { BridgePlayerMetrics, ReconciledMember, RosterPayload, RosterAnnotation } from '../../../preload/index.d'
import {
  DEFAULT_STAGES, parsePipelineDoc, parseVoteRow, groupBoard, tallyVotes,
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

  // Link-to-member UI state: which prospect card is showing the select
  const [linkingKey, setLinkingKey] = useState<string | null>(null)

  // Stage settings popover state
  const [showStageSettings, setShowStageSettings] = useState(false)
  // Editable copy of stages for the settings form
  const [editStages, setEditStages] = useState<PipelineStage[]>([])

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

  // Compute the set of review-ish stage ids: active stages that are not the first
  const reviewStageIds = useMemo(
    () => new Set(stages.filter((s, i) => s.type === 'active' && i > 0).map((s) => s.id)),
    [stages]
  )

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

  // ── Step 1: Voting ────────────────────────────────────────────────────────
  const vote = async (subjectKey: string, value: VoteValue): Promise<void> => {
    const next = myVote[subjectKey] === value ? 'clear' : value
    setMyVote((m) => {
      const c = { ...m }
      if (next === 'clear') delete c[subjectKey]
      else c[subjectKey] = value
      return c
    })
    await window.axiroster.pipelineVote(subjectKey, next)
    await load()
  }

  // ── Step 2: Link prospect to member ──────────────────────────────────────
  const linkProspect = async (prospectKey: string, memberKey: string): Promise<void> => {
    await window.axiroster.pipelineLinkProspect(prospectKey, memberKey)
    toast('Prospect linked to member')
    setLinkingKey(null)
    await load()
  }

  // ── Step 3: Archive passed ────────────────────────────────────────────────
  const archivePassed = async (): Promise<void> => {
    await window.axiroster.pipelineArchivePassed()
    toast('Archived passed recruits')
    await load()
  }

  // ── Step 3: Stage settings ────────────────────────────────────────────────
  const openStageSettings = (): void => {
    setEditStages(stages.map((s) => ({ ...s })))
    setShowStageSettings(true)
  }

  const saveStageSettings = async (): Promise<void> => {
    // Guard: must keep at least one accepted and one declined stage
    const acceptedCount = editStages.filter((s) => s.type === 'accepted').length
    const declinedCount = editStages.filter((s) => s.type === 'declined').length
    if (acceptedCount === 0 || declinedCount === 0) {
      toast('Must keep at least one accepted and one declined stage')
      return
    }
    await window.axiroster.pipelineSetStages(editStages)
    setShowStageSettings(false)
    await load()
  }

  const moveStage = (idx: number, dir: -1 | 1): void => {
    const next = [...editStages]
    const swap = idx + dir
    if (swap < 0 || swap >= next.length) return
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    setEditStages(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-panel-line bg-panel-sunk px-4 py-2.5">
        <Users2 size={15} className="text-accent-soft" />
        <span className="text-sm font-semibold text-ink">Recruitment</span>
        <span className="text-xs text-ink-faint">· {Object.keys(placement).length} in pipeline</span>
        {canEdit && (
          <>
            <button onClick={addProspect} className="btn ml-auto px-2 py-1 text-xs"><Plus size={13} /> Add prospect</button>
            <button
              onClick={archivePassed}
              className="btn px-2 py-1 text-xs"
              title="Archive passed recruits"
            >
              <Archive size={13} /> Archive passed
            </button>
            <button
              onClick={openStageSettings}
              className="btn px-2 py-1 text-xs"
              title="Stage settings"
            >
              <Settings size={13} />
            </button>
          </>
        )}
        <button onClick={load} className={`btn px-2 ${canEdit ? '' : 'ml-auto'}`} title="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {/* Stage settings popover */}
      {showStageSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowStageSettings(false)}>
          <div className="w-80 rounded-xl border border-panel-line bg-panel-raised p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-sm font-semibold text-ink">Stage Settings</div>
            <div className="flex flex-col gap-2">
              {editStages.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="h-2 w-2 flex-none rounded-full" style={{ background: STAGE_DOT[s.color] ?? '#94a3b8' }} />
                  <input
                    className="min-w-0 flex-1 rounded border border-panel-line bg-panel-sunk px-2 py-0.5 text-xs text-ink"
                    value={s.label}
                    onChange={(e) => {
                      const next = [...editStages]
                      next[i] = { ...next[i], label: e.target.value }
                      setEditStages(next)
                    }}
                  />
                  <span className="text-[10px] text-ink-faint">{s.type}</span>
                  <button
                    className="btn px-1 py-0.5 text-[10px] disabled:opacity-30"
                    onClick={() => moveStage(i, -1)}
                    disabled={i === 0}
                  >↑</button>
                  <button
                    className="btn px-1 py-0.5 text-[10px] disabled:opacity-30"
                    onClick={() => moveStage(i, 1)}
                    disabled={i === editStages.length - 1}
                  >↓</button>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn px-3 py-1 text-xs" onClick={() => setShowStageSettings(false)}>Cancel</button>
              <button className="btn px-3 py-1 text-xs font-semibold text-accent" onClick={saveStageSettings}>Save</button>
            </div>
          </div>
        </div>
      )}

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

                  {/* Step 2: Link-to-member for prospect cards */}
                  {canEdit && subj.isProspect && (
                    <div
                      className="mt-1.5"
                      onDragStart={(e) => e.preventDefault()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      {linkingKey === subj.key ? (
                        <select
                          autoFocus
                          size={1}
                          className="w-full rounded border border-panel-line bg-panel-sunk px-1 py-0.5 text-[11px] text-ink"
                          defaultValue=""
                          onChange={(e) => {
                            const val = e.target.value
                            if (val) void linkProspect(subj.key, val)
                          }}
                          onBlur={() => setLinkingKey(null)}
                        >
                          <option value="" disabled>Select member…</option>
                          {members.map((m) => (
                            <option key={m.annotationKey} value={m.annotationKey}>
                              {m.label}{m.accounts[0]?.account_name ? ` (${m.accounts[0].account_name})` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button
                          className="btn px-1.5 py-0.5 text-[10px]"
                          onClick={(e) => { e.stopPropagation(); setLinkingKey(subj.key) }}
                        >
                          Link to member
                        </button>
                      )}
                    </div>
                  )}

                  {/* Step 1: Vote bar + buttons — only for review-ish active stages */}
                  {canEdit && myVoterId && placement[subj.key] && reviewStageIds.has(placement[subj.key]) && (() => {
                    const t = tallyVotes(voteRows, subj.key)
                    const total = t.yes + t.no || 1
                    const mine = myVote[subj.key]
                    return (
                      <div className="mt-2 border-t border-panel-line pt-2">
                        <div className="flex h-1.5 overflow-hidden rounded-full bg-panel-line2">
                          <div style={{ width: `${(t.yes / total) * 100}%`, background: '#10b981' }} />
                          <div style={{ width: `${(t.no / total) * 100}%`, background: '#f43f5e' }} />
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                          <span className="font-semibold text-emerald-300">✓ {t.yes}</span>
                          <span className="font-semibold text-rose-300">✕ {t.no}</span>
                          <span className="text-ink-faint">– {t.abstain}</span>
                          <span
                            className="ml-auto flex gap-1"
                            onDragStart={(e) => e.preventDefault()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={(e) => { e.stopPropagation(); void vote(subj.key, 'yes') }}
                              className={`h-5 w-5 rounded border text-[11px] ${mine === 'yes' ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300' : 'border-panel-line2 text-ink-faint'}`}
                            >✓</button>
                            <button
                              onClick={(e) => { e.stopPropagation(); void vote(subj.key, 'no') }}
                              className={`h-5 w-5 rounded border text-[11px] ${mine === 'no' ? 'border-rose-500/50 bg-rose-500/20 text-rose-300' : 'border-panel-line2 text-ink-faint'}`}
                            >✕</button>
                            <button
                              onClick={(e) => { e.stopPropagation(); void vote(subj.key, 'abstain') }}
                              className={`h-5 w-5 rounded border text-[11px] ${mine === 'abstain' ? 'border-panel-line2 bg-panel-hover text-ink' : 'border-panel-line2 text-ink-faint'}`}
                            >–</button>
                          </span>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
