// src/renderer/src/components/RecruitmentView.tsx
//
// Recruitment kanban. Subjects = reconciled members + prospect:* rows, placed into
// stage columns via the shared meta:pipeline doc. Drag a card to restage. Votes,
// linking, and stage settings live alongside (added in the actions pass). Pipeline
// state is read via client.pipeline* and is workspace-synced.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Picker from './Picker'
import { Users2, RefreshCw, Plus, Settings, Archive, MessageSquare } from 'lucide-react'
import type { BridgePlayerMetrics, ReconciledMember, RosterPayload, RosterAnnotation } from '../../../preload/index.d'
import { client } from '../lib/client'
import {
  DEFAULT_STAGES, parsePipelineDoc, parseVoteRow, groupBoard, tallyVotes, stalePlacementKeys,
  type PipelineStage, type PipelineSubject, type VoteValue
} from '../lib/pipeline'
import { aggregateMemberMetrics } from '../lib/metrics'
import { parseRegistry, resolveColorId, tagStyle, type TagRegistry } from '../lib/tagRegistry'
import { toast } from '../lib/toast'
import RecruitCardModal from './RecruitCardModal'
import { useMountTransition } from '../lib/useMountTransition'
import Tooltip from './Tooltip'

// A stage's colour is the guild's pipeline, not the design language's, so it
// arrives per-instance through --axi-series (RULES.md rule 10) rather than
// borrowing one of the five inks that already mean something.
const STAGE_DOT: Record<string, string> = { slate: '#94a3b8', blue: '#3b82f6', amber: '#f59e0b', emerald: '#34d399', rose: '#f43f5e' }
const stageSeries = (color: string): string => STAGE_DOT[color] ?? STAGE_DOT.slate

export default function RecruitmentView(): JSX.Element {
  const [payload, setPayload] = useState<RosterPayload | null>(null)
  const [stages, setStages] = useState<PipelineStage[]>(DEFAULT_STAGES)
  const [placement, setPlacement] = useState<Record<string, string>>({})
  const [placedAt, setPlacedAt] = useState<Record<string, string>>({})
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  const [prospects, setProspects] = useState<RosterAnnotation[]>([])
  const [voteRows, setVoteRows] = useState<Record<string, VoteValue>[]>([])
  const [myVote, setMyVote] = useState<Record<string, VoteValue>>({})
  const [myVoterId, setMyVoterId] = useState<string | null>(null)
  const [canEdit, setCanEdit] = useState(true)
  const [loading, setLoading] = useState(false)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [registry, setRegistry] = useState<TagRegistry>({})
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const downPosRef = useRef<{ x: number; y: number } | null>(null)

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
  // Keep the popovers mounted through their fade-out.
  const stageSettingsT = useMountTransition(showStageSettings)
  const addProspectT = useMountTransition(showAddProspect)
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
    setIsOwner(auth.role === 'owner')
    setCurrentUserId(auth.userId ?? null)
    // pipe.stages may be undefined → defaults; reuse the pure parser by round-tripping
    const doc = parsePipelineDoc(JSON.stringify({ stages: pipe.stages, placement: pipe.placement }))
    setStages(doc.stages)
    setPlacement(doc.placement)
    setPlacedAt(pipe.placedAt ?? {})
    setCommentCounts(pipe.commentCounts ?? {})
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
      accountName: m.accounts[0]?.account_name ?? null, aliases: m.aliases, isProspect: false, tags: m.tags
    }))
    const prospectSubs: PipelineSubject[] = prospects.map((p) => ({
      key: p.memberId, name: p.nickname || 'Prospect',
      accountName: p.aliases[0] ?? null, aliases: p.aliases, isProspect: true, tags: p.tags
    }))
    return [...memberSubs, ...prospectSubs]
  }, [members, prospects])

  const board = useMemo(() => groupBoard(subjects, placement, stages), [subjects, placement, stages])

  // Count what this guild actually has on the board, not every key in the
  // placement doc — a stale key for someone outside this roster is not "in
  // pipeline" here, and counting it leaks another guild's headcount.
  const placedCount = useMemo(
    () => Object.values(board).reduce((n, col) => n + col.length, 0),
    [board]
  )

  // Self-heal docs contaminated before reserved rows were scoped per guild: any
  // placement key that resolves to neither a member of THIS roster nor a
  // prospect in THIS workspace is another guild's residue. Gated on a loaded
  // roster (`members.length > 0`) so a failed fetch can never read as "all
  // stale", and it runs at most once per mount.
  const prunedOnce = useRef(false)
  useEffect(() => {
    if (loading || prunedOnce.current) return
    const stale = stalePlacementKeys(placement, subjects, members.length > 0)
    if (!stale.length) return
    prunedOnce.current = true
    void client.pipelinePrunePlacements(stale).then((n) => {
      if (!n) return
      setPlacement((prev) => {
        const next = { ...prev }
        for (const k of stale) delete next[k]
        return next
      })
    })
  }, [loading, placement, subjects, members.length])

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
    <div className="ar-pane">
      <div className="ar-pane__head">
        <Users2 className="ar-ink-accent" size={15} />
        <span className="ar-title">Recruitment</span>
        <span className="ar-note--faint">{placedCount} in pipeline</span>
        {canEdit && (
          <>
            <button onClick={() => setShowAddProspect(true)} className="axi-btn ar-sm ml-auto"><Plus size={13} /> Add prospect</button>
            <Tooltip text="Archive passed recruits">
              <button onClick={archivePassed} className="axi-btn ar-sm">
                <Archive size={13} /> Archive passed
              </button>
            </Tooltip>
            <Tooltip text="Stage settings">
              <button onClick={openStageSettings} className="axi-btn ar-sm">
                <Settings size={13} />
              </button>
            </Tooltip>
          </>
        )}
        <Tooltip text="Refresh" className={`inline-flex ${canEdit ? '' : 'ml-auto'}`}>
          <button onClick={load} className="ar-icon-btn">
            <RefreshCw size={14} className={loading ? 'ar-work' : ''} />
          </button>
        </Tooltip>
      </div>

      {/* Stage settings popover */}
      {stageSettingsT.mounted && (
        <div
          className={`axi-scrim flex items-center justify-center transition-opacity duration-150 ease-out ${
            stageSettingsT.shown ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={() => setShowStageSettings(false)}
        >
          <div
            className={`ar-modal__sheet w-80 p-4 transition duration-150 ease-out ${
              stageSettingsT.shown ? 'scale-100 opacity-100' : 'scale-[.98] opacity-0'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ar-title mb-3">Stage settings</div>
            <div className="flex flex-col gap-2">
              {editStages.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span
                    className="axi-diamond axi-diamond--series"
                    style={{ '--axi-series': stageSeries(s.color) } as React.CSSProperties}
                  />
                  <input
                    className="axi-input min-w-0 flex-1"
                    value={s.label}
                    onChange={(e) => {
                      const next = [...editStages]
                      next[i] = { ...next[i], label: e.target.value }
                      setEditStages(next)
                    }}
                  />
                  <span className="ar-label">{s.type}</span>
                  <button
                    className="ar-icon-btn"
                    style={{ width: 22, height: 22 }}
                    onClick={() => moveStage(i, -1)}
                    disabled={i === 0}
                  >↑</button>
                  <button
                    className="ar-icon-btn"
                    style={{ width: 22, height: 22 }}
                    onClick={() => moveStage(i, 1)}
                    disabled={i === editStages.length - 1}
                  >↓</button>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="axi-btn" onClick={() => setShowStageSettings(false)}>Cancel</button>
              <button className="axi-btn axi-btn--primary" onClick={saveStageSettings}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Add prospect modal — typeahead over roster + Discord server */}
      {addProspectT.mounted && (
        <div
          className={`axi-scrim flex items-start justify-center pt-24 transition-opacity duration-150 ease-out ${
            addProspectT.shown ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={closeAddProspect}
        >
          <div
            className={`ar-modal__sheet w-96 p-3 transition duration-150 ease-out ${
              addProspectT.shown ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ar-title mb-3">Add to pipeline</div>
            <input
              autoFocus
              value={apQuery}
              onChange={(e) => setApQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') closeAddProspect() }}
              placeholder="Search a member, GW2 account, or Discord user — or type a new name"
              className="axi-input"
            />
            <div className="mt-2 max-h-72 overflow-y-auto">
              {suggestions.map((s) => (
                <button
                  key={`${s.kind}:${s.key}`}
                  onClick={() => s.kind === 'member' ? stageExisting(s.key, s.label) : createProspect(s.label, s.handle)}
                  className="ar-pop__item"
                >
                  {/* Already in the roster vs. an outsider is a fact about the
                      record, which is what the reserved meta ink marks. */}
                  <span
                    className={`axi-diamond ${s.kind === 'member' ? 'ar-diamond--idle' : ''}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="ar-row__name block">{s.label}</span>
                    <span className="ar-row__sub block">{s.sub}</span>
                  </span>
                  <span className="ar-label">{s.kind === 'member' ? 'stage' : 'prospect'}</span>
                </button>
              ))}
              {apQuery.trim() && !exactMember && (
                <button
                  onClick={() => createProspect(apQuery)}
                  className="ar-pop__item"
                >
                  <Plus size={12} /> <span>Create prospect “{apQuery.trim()}”</span>
                </button>
              )}
              {!apQuery.trim() && suggestions.length === 0 && roleOptions.length === 0 && (
                <div className="ar-note--faint px-2 py-3 text-center">Start typing to find a member or add a new recruit.</div>
              )}
            </div>
            {roleOptions.length > 0 && (
              <div className="ar-pop__foot flex-col items-stretch">
                <div className="axi-eyebrow mb-0 px-2 pb-1">Add a Discord role</div>
                {roleOptions.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => addRole(r.name, r.keys)}
                    className="ar-pop__item"
                  >
                    <Users2 size={13} />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="ar-label">Add {r.keys.length}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {openKey && (() => {
        const subj = subjects.find((s) => s.key === openKey)
        if (!subj) return null
        return (
          <RecruitCardModal
            subject={subj}
            stages={stages}
            placement={placement}
            placedAt={placedAt}
            voteRows={voteRows}
            myVote={myVote}
            canEdit={canEdit}
            myVoterId={myVoterId}
            isOwner={isOwner}
            currentUserId={currentUserId}
            registry={registry}
            onClose={() => setOpenKey(null)}
            onChanged={() => { void load() }}
          />
        )
      })()}

      <div className="ar-pane__body overflow-x-auto">
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(200px, 1fr))` }}>
          {stages.map((stage) => (
            <div
              key={stage.id}
              onDragOver={(e) => { if (canEdit && dragKey) e.preventDefault() }}
              onDrop={() => { if (canEdit && dragKey) { void restage(dragKey, stage.id); setDragKey(null) } }}
              className={`ar-col${canEdit && dragKey ? ' ar-col--drop' : ''}`}
            >
              <div className="ar-col__head">
                {/* The stage's own colour, handed in as --axi-series. */}
                <span
                  className="axi-diamond axi-diamond--series"
                  style={{ '--axi-series': stageSeries(stage.color) } as React.CSSProperties}
                />
                <span>{stage.label}</span>
                <span className="axi-chip ml-auto">{board[stage.id]?.length ?? 0}</span>
              </div>
              {(board[stage.id] ?? []).map((subj) => (
                <div
                  key={subj.key}
                  draggable={canEdit}
                  onDragStart={() => setDragKey(subj.key)}
                  onDragEnd={() => setDragKey(null)}
                  onMouseDown={(e) => { downPosRef.current = { x: e.clientX, y: e.clientY } }}
                  onClick={(e) => {
                    const d = downPosRef.current
                    // Treat as a click only if the pointer barely moved (not a drag).
                    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) setOpenKey(subj.key)
                  }}
                  className={`ar-card${dragKey === subj.key ? ' ar-card--dragging' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="ar-card__name">{subj.name}</div>
                      <div className="ar-row__sub">{subj.accountName ?? 'Discord only'}</div>
                    </div>
                    {/* Not yet in the roster is a fact about the record, not a
                        verdict on the person — the meta ink, outlined (rule 6). */}
                    {subj.isProspect && <span className="axi-chip axi-chip--meta">prospect</span>}
                    {(() => {
                      const d = daysInStage(subj.key)
                      return d !== null ? (
                        <span
                          className="ar-num shrink-0"
                          title={`${d} day${d === 1 ? '' : 's'} in this stage`}
                        >{d}d</span>
                      ) : null
                    })()}
                    {commentCounts[subj.key] > 0 && (
                      <span
                        className="axi-legend__key shrink-0"
                        title={`${commentCounts[subj.key]} comment${commentCounts[subj.key] === 1 ? '' : 's'}`}
                      >
                        <MessageSquare size={10} /> {commentCounts[subj.key]}
                      </span>
                    )}
                  </div>
                  {subj.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {subj.tags.map((t) => (
                        <span key={t} className="ar-tag" style={tagStyle(resolveColorId(t, registry))}>
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {attendanceOf(subj) && <div className="ar-note--faint">⚔ {attendanceOf(subj)}</div>}

                  {/* Step 2: Link-to-member for prospect cards */}
                  {canEdit && subj.isProspect && (
                    <div
                      onDragStart={(e) => e.preventDefault()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      {/* Opens on mount and closes on any dismissal: this
                          picker is the whole transient UI, not a control
                          parked in a strip, so there is nothing left to show
                          once the list goes away. */}
                      {linkingKey === subj.key ? (
                        <Picker
                          autoOpen
                          value=""
                          className="w-full"
                          onChange={(v) => {
                            if (v) void linkProspect(subj.key, v)
                          }}
                          onDismiss={() => setLinkingKey(null)}
                          options={[
                            { value: '', label: 'Select member…' },
                            ...members.map((m) => ({
                              value: m.annotationKey,
                              label: `${m.label}${m.accounts[0]?.account_name ? ` (${m.accounts[0].account_name})` : ''}`
                            }))
                          ]}
                        />
                      ) : (
                        <button
                          className="axi-btn ar-sm"
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
                      <div className="ar-pop__foot flex-col items-stretch gap-2">
                        {/* A composition drawn as length, each part one ink at
                            full strength and no divider between them (rule 9). */}
                        <div className="axi-meter" style={{ '--axi-meter-h': '8px' } as React.CSSProperties}>
                          <span
                            className="axi-meter__fill"
                            style={{ '--axi-meter-v': `${(t.yes / total) * 100}%`, '--axi-series': 'var(--axi-ok)' } as React.CSSProperties}
                          />
                          <span
                            className="axi-meter__fill"
                            style={{ '--axi-meter-v': `${(t.no / total) * 100}%`, '--axi-series': 'var(--axi-danger)' } as React.CSSProperties}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="axi-legend__key ar-ink-ok">✓ {t.yes}</span>
                          <span className="axi-legend__key ar-ink-danger">✕ {t.no}</span>
                          <span className="axi-legend__key">– {t.abstain}</span>
                          <span
                            className="ml-auto flex gap-1"
                            onDragStart={(e) => e.preventDefault()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={(e) => { e.stopPropagation(); void vote(subj.key, 'yes') }}
                              className={`ar-vote ar-vote--yes${mine === 'yes' ? ' ar-vote--on' : ''}`}
                            >✓</button>
                            <button
                              onClick={(e) => { e.stopPropagation(); void vote(subj.key, 'no') }}
                              className={`ar-vote ar-vote--no${mine === 'no' ? ' ar-vote--on' : ''}`}
                            >✕</button>
                            <button
                              onClick={(e) => { e.stopPropagation(); void vote(subj.key, 'abstain') }}
                              className={`ar-vote ar-vote--abstain${mine === 'abstain' ? ' ar-vote--on' : ''}`}
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
