// src/renderer/src/components/RecruitCardModal.tsx
//
// Jira-style detail modal for a recruit card. Left pane: header + comment thread.
// Right pane (Task 5): editable side panel. Comments are server-authored
// (comment:<uuid> rows); author/edit/delete rules enforced in the main/web layer.
import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { X, Pencil, Trash2, ChevronDown, Check } from 'lucide-react'
import type { PipelineCommentDTO } from '../../../preload/index.d'
import type { PipelineStage, PipelineSubject, VoteValue } from '../lib/pipeline'
import { tallyVotes } from '../lib/pipeline'
import type { TagRegistry } from '../lib/tagRegistry'
import { setTagColor, type TagColorId } from '../lib/tagRegistry'
import { client } from '../lib/client'
import { toast } from '../lib/toast'
import TagPicker from './TagPicker'
import { useMountTransition } from '../lib/useMountTransition'

export interface RecruitCardModalProps {
  subject: PipelineSubject
  stages: PipelineStage[]
  placement: Record<string, string>
  placedAt: Record<string, string>
  voteRows: Record<string, VoteValue>[]
  myVote: Record<string, VoteValue>
  canEdit: boolean
  myVoterId: string | null
  isOwner: boolean
  currentUserId: string | null
  registry: TagRegistry
  onClose: () => void
  onChanged: () => void
}

// The stage palette is the guild's pipeline data, delivered per-instance (rule
// 10) rather than borrowing one of the language's five meaningful inks.
const STAGE_DOT: Record<string, string> = { slate: '#94a3b8', blue: '#3b82f6', amber: '#f59e0b', emerald: '#34d399', rose: '#f43f5e' }
const stageSeries = (color: string | undefined): string => STAGE_DOT[color ?? 'slate'] ?? STAGE_DOT.slate

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function RecruitCardModal(props: RecruitCardModalProps): JSX.Element {
  const { subject, canEdit, isOwner, currentUserId, onClose } = props
  // The parent mounts us already-open and unmounts us the moment onClose fires,
  // so both halves of the animation are owned here: open on mount to play the
  // enter, and on close hold the unmount until the exit has finished.
  const [open, setOpen] = useState(false)
  const closing = useRef(false)
  const t = useMountTransition(open)
  useEffect(() => setOpen(true), [])
  const close = (): void => {
    closing.current = true
    setOpen(false)
  }
  useEffect(() => {
    if (closing.current && !t.mounted) onClose()
  }, [t.mounted, onClose])
  const { stages, placement, placedAt, voteRows, myVote, myVoterId, registry, onChanged } = props
  const [comments, setComments] = useState<PipelineCommentDTO[]>([])
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [busy, setBusy] = useState(false)
  const [nickname, setNickname] = useState(subject.name)
  const [aliasText, setAliasText] = useState(subject.aliases.join(', '))
  const [tags, setTags] = useState<string[]>(subject.tags)
  const [reg, setReg] = useState<TagRegistry>(registry)
  useEffect(() => { setReg(registry) }, [registry])

  const [stageOpen, setStageOpen] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!stageOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (stageRef.current && !stageRef.current.contains(e.target as Node)) setStageOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [stageOpen])

  const stageId = placement[subject.key]
  const currentStage = stages.find((s) => s.id === stageId)
  const reviewStageIds = new Set(stages.filter((s, i) => s.type === 'active' && i > 0).map((s) => s.id))
  const days = (() => {
    const iso = placedAt[subject.key]
    if (!iso) return null
    const t = Date.parse(iso)
    return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86400000))
  })()

  const saveAnn = async (patch: Record<string, unknown>): Promise<void> => {
    if (!canEdit) return
    await client.upsertAnnotation(subject.key, patch)
    onChanged()
  }
  const changeStage = async (next: string): Promise<void> => {
    await client.pipelineSetPlacement(subject.key, next)
    onChanged()
  }
  const castVote = async (value: VoteValue): Promise<void> => {
    const next = myVote[subject.key] === value ? 'clear' : value
    await client.pipelineVote(subject.key, next)
    onChanged()
  }

  const reload = useCallback(async () => {
    setComments(await client.pipelineGetComments(subject.key))
  }, [subject.key])
  useEffect(() => { void reload() }, [reload])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const post = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      await client.pipelineAddComment(subject.key, text)
      setDraft('')
      await reload()
    } finally {
      setBusy(false)
    }
  }
  const saveEdit = async (id: string): Promise<void> => {
    const text = editText.trim()
    if (!text) return
    await client.pipelineEditComment(id, text)
    setEditingId(null)
    await reload()
  }
  const del = async (id: string): Promise<void> => {
    await client.pipelineDeleteComment(id)
    toast('Comment deleted')
    await reload()
  }

  const canModify = (c: PipelineCommentDTO): boolean => !!currentUserId && c.authorId === currentUserId
  const canDelete = (c: PipelineCommentDTO): boolean => canModify(c) || isOwner

  return (
    <div
      className={`axi-scrim flex items-center justify-center p-6 transition-opacity duration-150 ease-out ${
        t.shown ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={close}
    >
      <div
        className={`ar-modal__sheet max-w-3xl transition duration-150 ease-out ${
          t.shown ? 'scale-100 opacity-100' : 'scale-[.98] opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="ar-modal__head items-start">
          <div className="min-w-0 flex-1">
            <div className="ar-title truncate">{subject.name}</div>
            <div className="ar-row__sub">{subject.accountName ?? 'Discord only'}</div>
          </div>
          <button onClick={close} className="ar-icon-btn"><X size={15} /></button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* LEFT: comment thread */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="axi-eyebrow">
                Comments · {comments.length}
              </div>
              <div className="flex flex-col gap-4">
                {comments.length === 0 && <div className="ar-note--faint">No comments yet.</div>}
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="ar-row__name">{c.authorName}</span>
                        <span className="ar-note--faint">{timeAgo(c.createdAt)}{c.editedAt ? ' · edited' : ''}</span>
                        {canModify(c) && editingId !== c.id && (
                          <button onClick={() => { setEditingId(c.id); setEditText(c.body) }} className="ar-icon-btn ml-auto" style={{ width: 22, height: 22 }}><Pencil size={12} /></button>
                        )}
                        {canDelete(c) && editingId !== c.id && (
                          <button onClick={() => void del(c.id)} className={`ar-icon-btn ar-icon-btn--danger ${canModify(c) ? '' : 'ml-auto'}`} style={{ width: 22, height: 22 }}><Trash2 size={12} /></button>
                        )}
                      </div>
                      {editingId === c.id ? (
                        <div>
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="ar-textarea min-h-[60px]"
                          />
                          <div className="mt-1.5 flex justify-end gap-2">
                            <button onClick={() => setEditingId(null)} className="axi-btn">Cancel</button>
                            <button onClick={() => void saveEdit(c.id)} className="axi-btn axi-btn--primary">Save</button>
                          </div>
                        </div>
                      ) : (
                        <div className="axi-prose ar-comment">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.body}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Composer */}
            {canEdit && (
              <div className="ar-modal__foot flex-col items-stretch">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void post() }}
                  placeholder="Add a comment…  (markdown supported · ⌘/Ctrl+Enter to post)"
                  className="ar-textarea min-h-[60px]"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button onClick={() => setDraft('')} className="axi-btn">Clear</button>
                  <button onClick={() => void post()} disabled={busy || !draft.trim()} className="axi-btn axi-btn--primary">Comment</button>
                </div>
              </div>
            )}
          </div>

          <aside className="ar-side">
            {/* Stage */}
            <div className="mb-4">
              <div className="axi-eyebrow">Stage</div>
              <div className="axi-menu" ref={stageRef}>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setStageOpen((o) => !o)}
                  className="ar-tile w-full"
                >
                  <span
                    className="axi-diamond axi-diamond--series"
                    style={{ '--axi-series': stageSeries(currentStage?.color) } as React.CSSProperties}
                  />
                  <span className="truncate">{currentStage?.label ?? 'Unplaced'}</span>
                  <ChevronDown size={14} className="ml-auto" />
                </button>
                {stageOpen && canEdit && (
                  <div className="axi-menu__pop" style={{ '--axi-menu-width': '100%' } as React.CSSProperties}>
                    {stages.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { setStageOpen(false); if (s.id !== stageId) void changeStage(s.id) }}
                        className="ar-pop__item"
                      >
                        <span
                          className="axi-diamond axi-diamond--series"
                          style={{ '--axi-series': stageSeries(s.color) } as React.CSSProperties}
                        />
                        <span className="truncate">{s.label}</span>
                        {s.id === stageId && <Check size={14} className="ml-auto ar-ink-accent" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Votes — only meaningful in review-ish stages */}
            {myVoterId && stageId && reviewStageIds.has(stageId) && (() => {
              const t = tallyVotes(voteRows, subject.key)
              const mine = myVote[subject.key]
              const total = t.yes + t.no + t.abstain
              const pct = (n: number): string => `${total ? (n / total) * 100 : 0}%`
              const favor = t.yes + t.no > 0 ? Math.round((t.yes / (t.yes + t.no)) * 100) : null
              return (
                <div className="mb-4">
                  <div className="axi-eyebrow">Votes</div>
                  {/* The tally is a composition drawn as length: three parts,
                      each one ink at full strength, no divider between them. */}
                  <div className="axi-meter" style={{ '--axi-meter-h': '10px' } as React.CSSProperties}>
                    <span className="axi-meter__fill" style={{ '--axi-meter-v': pct(t.yes), '--axi-series': 'var(--axi-ok)' } as React.CSSProperties} />
                    <span className="axi-meter__fill" style={{ '--axi-meter-v': pct(t.no), '--axi-series': 'var(--axi-danger)' } as React.CSSProperties} />
                    <span className="axi-meter__fill" style={{ '--axi-meter-v': pct(t.abstain), '--axi-series': 'var(--axi-rule)' } as React.CSSProperties} />
                  </div>
                  <div className="axi-legend mt-2">
                    <span className="axi-legend__key"><span className="axi-diamond axi-diamond--ok" />{t.yes}</span>
                    <span className="axi-legend__key"><span className="axi-diamond axi-diamond--danger" />{t.no}</span>
                    <span className="axi-legend__key"><span className="axi-diamond ar-diamond--idle" />{t.abstain}</span>
                    {favor !== null && <span className="axi-legend__key ml-auto">{favor}% in favor</span>}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => void castVote('yes')} disabled={!canEdit} aria-pressed={mine === 'yes'} className="axi-pill flex-1 justify-center" style={{ '--axi-pill-fill': 'var(--axi-ok)' } as React.CSSProperties}>✓ Yes</button>
                    <button onClick={() => void castVote('no')} disabled={!canEdit} aria-pressed={mine === 'no'} className="axi-pill flex-1 justify-center" style={{ '--axi-pill-fill': 'var(--axi-danger)' } as React.CSSProperties}>✕ No</button>
                    <button onClick={() => void castVote('abstain')} disabled={!canEdit} aria-pressed={mine === 'abstain'} className="axi-pill flex-1 justify-center" style={{ '--axi-pill-fill': 'var(--axi-surface-raised)' } as React.CSSProperties}>–</button>
                  </div>
                </div>
              )
            })()}

            {/* Nickname */}
            <div className="mb-4">
              <div className="axi-eyebrow">Nickname</div>
              <input
                value={nickname}
                disabled={!canEdit}
                onChange={(e) => setNickname(e.target.value)}
                onBlur={() => nickname !== subject.name && void saveAnn({ nickname })}
                className="axi-input"
              />
            </div>

            {/* Aliases (comma-separated) */}
            <div className="mb-4">
              <div className="axi-eyebrow">Aliases / accounts</div>
              <input
                value={aliasText}
                disabled={!canEdit}
                onChange={(e) => setAliasText(e.target.value)}
                onBlur={() => aliasText !== subject.aliases.join(', ') && void saveAnn({ aliases: aliasText.split(',').map((a) => a.trim()).filter(Boolean) })}
                placeholder="Account.1234, alt name"
                className="axi-input"
              />
            </div>

            {/* Tags */}
            <div className="mb-4">
              <div className="axi-eyebrow">Tags</div>
              <TagPicker
                tags={tags}
                registry={reg}
                editable={canEdit}
                onAssign={(name) => {
                  if (tags.some((t) => t.toLowerCase() === name.toLowerCase())) return
                  const next = [...tags, name]
                  setTags(next)
                  void saveAnn({ tags: next })
                }}
                onRemove={(name) => {
                  const next = tags.filter((t) => t !== name)
                  setTags(next)
                  void saveAnn({ tags: next })
                }}
                onRecolor={async (name, id: TagColorId) => {
                  const next = setTagColor(reg, name, id)
                  setReg(next)
                  await client.setTagRegistry(next).catch(() => {})
                }}
              />
            </div>

            {/* Time in stage (read-only) */}
            <div>
              <div className="axi-eyebrow">Time in stage</div>
              <div className="ar-note">{days === null ? '—' : `${days} day${days === 1 ? '' : 's'}`}</div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
