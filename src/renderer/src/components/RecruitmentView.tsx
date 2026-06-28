// src/renderer/src/components/RecruitmentView.tsx
//
// Recruitment kanban. Subjects = reconciled members + prospect:* rows, placed into
// stage columns via the shared meta:pipeline doc. Drag a card to restage. Votes,
// linking, and stage settings live alongside (added in the actions pass). Pipeline
// state is read via client.pipeline* and is workspace-synced.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Users2, RefreshCw, Plus, Settings, Archive } from 'lucide-react'
import type { BridgePlayerMetrics, ReconciledMember, RosterPayload, RosterAnnotation } from '../../../preload/index.d'
import { client } from '../lib/client'
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
  const [placedAt, setPlacedAt] = useState<Record<string, string>>({})
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

  // Add-prospect modal state (Electron renderers don't support window.prompt).
  // A typeahead over the roster + Discord server: pick an existing person to stage
  // them directly, or create a manual prospect for a truly-external recruit.
  const [showAddProspect, setShowAddProspect] = useState(false)
  const [apQuery, setApQuery] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [roster, pipe, auth] = await Promise.all([
      client.buildRoster(),
      client.pipelineGet(),
      client.authStatus()
    ])
    if (roster.ok) setPayload(roster.data)
    setCanEdit(auth.role !== 'read')
    setMyVoterId(auth.userId ?? null)
    // pipe.stages may be undefined → defaults; reuse the pure parser by round-tripping
    const doc = parsePipelineDoc(JSON.stringify({ stages: pipe.stages, placement: pipe.placement }))
    setStages(doc.stages)
    setPlacement(doc.placement)
    setPlacedAt(pipe.placedAt ?? {})
    setProspects(pipe.prospects)
    setVoteRows(pipe.votes.map((v) => parseVoteRow(JSON.stringify(v.row))))
    const mine = pipe.votes.find((v) => v.voterId === (auth.userId ?? ''))
    setMyVote(mine ? parseVoteRow(JSON.stringify(mine.row)) : {})
    client.getTagRegistry().then((m) => setRegistry(parseRegistry(JSON.stringify(m))))
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
    const nowIso = new Date().toISOString()
    setPlacement((p) => ({ ...p, [subjectKey]: stageId })) // optimistic
    setPlacedAt((p) => ({ ...p, [subjectKey]: nowIso })) // reset time-in-stage
    await client.pipelineSetPlacement(subjectKey, stageId)
  }

  // Whole days a subject has sat in its current stage (null when no timestamp yet).
  const daysInStage = (key: string): number | null => {
    const iso = placedAt[key]
    if (!iso) return null
    const t = Date.parse(iso)
    if (Number.isNaN(t)) return null
    return Math.max(0, Math.floor((Date.now() - t) / 86400000))
  }

  const firstStageId = stages[0]?.id ?? 'applied'

  const closeAddProspect = (): void => {
    setShowAddProspect(false)
    setApQuery('')
  }

  // Stage an already-reconciled member straight into the pipeline (no duplicate).
  const stageExisting = async (key: string, label: string): Promise<void> => {
    await client.pipelineSetPlacement(key, firstStageId)
    closeAddProspect()
    toast(`${label} added to pipeline`)
    await load()
  }

  // Create a manual prospect for an external recruit (optionally pre-filled handle).
  const createProspect = async (name: string, handle?: string): Promise<void> => {
    const n = name.trim()
    if (!n) return
    await client.pipelineAddProspect(handle ? { name: n, handle } : { name: n })
    closeAddProspect()
    toast('Prospect added')
    await load()
  }

  // Typeahead suggestions: reconciled members + Discord-server users not yet placed.
  const suggestions = useMemo(() => {
    const q = apQuery.trim().toLowerCase()
    if (!q) return [] as Array<{ kind: 'member' | 'discord'; key: string; label: string; sub: string; handle?: string }>
    const placed = new Set(Object.keys(placement))
    const out: Array<{ kind: 'member' | 'discord'; key: string; label: string; sub: string; handle?: string }> = []
    for (const m of members) {
      if (placed.has(m.annotationKey)) continue
      const acct = m.accounts[0]?.account_name ?? m.accountName ?? ''
      const hay = `${m.label} ${acct} ${m.discordName ?? ''}`.toLowerCase()
      if (hay.includes(q)) out.push({ kind: 'member', key: m.annotationKey, label: m.label, sub: acct || (m.discordName ? `@${m.discordName}` : 'Discord only') })
    }
    const memberDiscordIds = new Set(members.map((m) => m.annotationKey))
    for (const c of payload?.discordCandidates ?? []) {
      if (memberDiscordIds.has(c.id) || placed.has(c.id)) continue
      const hay = `${c.displayName} ${c.name}`.toLowerCase()
      if (hay.includes(q)) out.push({ kind: 'discord', key: c.id, label: c.displayName, sub: `@${c.name} · Discord`, handle: `@${c.name}` })
    }
    return out.slice(0, 8)
  }, [apQuery, members, placement, payload])

  const exactMember = useMemo(
    () => suggestions.some((s) => s.label.toLowerCase() === apQuery.trim().toLowerCase()),
    [suggestions, apQuery]
  )

  // Discord roles offered for bulk-add: each with the count of members holding it
  // who aren't already in the pipeline. Filtered by the same query, count>0.
  const roleOptions = useMemo(() => {
    const placed = new Set(Object.keys(placement))
    const q = apQuery.trim().toLowerCase()
    return (payload?.discordRoles ?? [])
      .map((r) => ({
        id: r.id,
        name: r.name,
        keys: members.filter((m) => m.roles.includes(r.id) && !placed.has(m.annotationKey)).map((m) => m.annotationKey)
      }))
      .filter((r) => r.keys.length > 0 && r.name !== '@everyone' && (!q || r.name.toLowerCase().includes(q)))
      .sort((a, b) => b.keys.length - a.keys.length)
      .slice(0, 6)
  }, [payload, members, placement, apQuery])

  const addRole = async (name: string, keys: string[]): Promise<void> => {
    if (keys.length === 0) return
    await client.pipelinePlaceMany(keys, firstStageId)
    closeAddProspect()
    toast(`Added ${keys.length} member${keys.length === 1 ? '' : 's'} with ${name}`)
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
    await client.pipelineVote(subjectKey, next)
    await load()
  }

  // ── Step 2: Link prospect to member ──────────────────────────────────────
  const linkProspect = async (prospectKey: string, memberKey: string): Promise<void> => {
    await client.pipelineLinkProspect(prospectKey, memberKey)
    toast('Prospect linked to member')
    setLinkingKey(null)
    await load()
  }

  // ── Step 3: Archive passed ────────────────────────────────────────────────
  const archivePassed = async (): Promise<void> => {
    await client.pipelineArchivePassed()
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
    await client.pipelineSetStages(editStages)
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
            <button onClick={() => setShowAddProspect(true)} className="btn ml-auto px-2 py-1 text-xs"><Plus size={13} /> Add prospect</button>
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

      {/* Add prospect modal — typeahead over roster + Discord server */}
      {showAddProspect && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24" onClick={closeAddProspect}>
          <div className="w-96 rounded-xl border border-panel-line bg-panel-raised p-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 px-1 text-sm font-semibold text-ink">Add to pipeline</div>
            <input
              autoFocus
              value={apQuery}
              onChange={(e) => setApQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') closeAddProspect() }}
              placeholder="Search a member, GW2 account, or Discord user — or type a new name"
              className="field h-8 w-full px-2.5 py-0 text-xs"
            />
            <div className="mt-2 max-h-72 overflow-y-auto">
              {suggestions.map((s) => (
                <button
                  key={`${s.kind}:${s.key}`}
                  onClick={() => s.kind === 'member' ? stageExisting(s.key, s.label) : createProspect(s.label, s.handle)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-panel-hover"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${s.kind === 'member' ? 'bg-accent-soft' : 'bg-blue-400'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-ink">{s.label}</span>
                    <span className="block truncate text-[10px] text-ink-faint">{s.sub}</span>
                  </span>
                  <span className="text-[9px] uppercase tracking-wide text-ink-faint">{s.kind === 'member' ? 'stage' : 'prospect'}</span>
                </button>
              ))}
              {apQuery.trim() && !exactMember && (
                <button
                  onClick={() => createProspect(apQuery)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink-dim hover:bg-panel-hover"
                >
                  <Plus size={12} /> <span className="text-xs">Create prospect “{apQuery.trim()}”</span>
                </button>
              )}
              {!apQuery.trim() && suggestions.length === 0 && roleOptions.length === 0 && (
                <div className="px-2 py-3 text-center text-[11px] text-ink-faint">Start typing to find a member or add a new recruit.</div>
              )}
            </div>
            {roleOptions.length > 0 && (
              <div className="mt-2 border-t border-panel-line pt-2">
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Add a Discord role</div>
                {roleOptions.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => addRole(r.name, r.keys)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-panel-hover"
                  >
                    <Users2 size={13} className="text-ink-faint" />
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">{r.name}</span>
                    <span className="text-[10px] text-ink-faint">Add {r.keys.length}</span>
                  </button>
                ))}
              </div>
            )}
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
                    {(() => {
                      const d = daysInStage(subj.key)
                      return d !== null ? (
                        <span
                          className="shrink-0 rounded bg-panel-sunk px-1.5 py-0.5 font-mono text-[10px] text-ink-faint"
                          title={`${d} day${d === 1 ? '' : 's'} in this stage`}
                        >{d}d</span>
                      ) : null
                    })()}
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
