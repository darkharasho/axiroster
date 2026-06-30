// src/renderer/src/components/RecruitCardModal.tsx
//
// Jira-style detail modal for a recruit card. Left pane: header + comment thread.
// Right pane (Task 5): editable side panel. Comments are server-authored
// (comment:<uuid> rows); author/edit/delete rules enforced in the main/web layer.
import { useCallback, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { X, Pencil, Trash2 } from 'lucide-react'
import type { PipelineCommentDTO } from '../../../preload/index.d'
import type { PipelineStage, PipelineSubject, VoteValue } from '../lib/pipeline'
import { tallyVotes } from '../lib/pipeline'
import type { TagRegistry } from '../lib/tagRegistry'
import { setTagColor, type TagColorId } from '../lib/tagRegistry'
import { client } from '../lib/client'
import { toast } from '../lib/toast'
import TagPicker from './TagPicker'

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

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function RecruitCardModal(props: RecruitCardModalProps): JSX.Element {
  const { subject, canEdit, isOwner, currentUserId, onClose } = props
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

  const stageId = placement[subject.key]
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
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-panel-line bg-panel-raised shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-panel-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-semibold text-ink">{subject.name}</div>
            <div className="truncate text-xs text-ink-faint">{subject.accountName ?? 'Discord only'}</div>
          </div>
          <button onClick={onClose} className="btn px-2 py-1"><X size={16} /></button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* LEFT: comment thread */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Comments · {comments.length}
              </div>
              <div className="space-y-4">
                {comments.length === 0 && <div className="text-sm text-ink-faint">No comments yet.</div>}
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2 text-xs">
                        <span className="font-semibold text-ink">{c.authorName}</span>
                        <span className="text-ink-faint">{timeAgo(c.createdAt)}{c.editedAt ? ' · edited' : ''}</span>
                        {canModify(c) && editingId !== c.id && (
                          <button onClick={() => { setEditingId(c.id); setEditText(c.body) }} className="ml-auto text-ink-faint hover:text-ink"><Pencil size={12} /></button>
                        )}
                        {canDelete(c) && editingId !== c.id && (
                          <button onClick={() => void del(c.id)} className={`${canModify(c) ? '' : 'ml-auto'} text-ink-faint hover:text-rose-300`}><Trash2 size={12} /></button>
                        )}
                      </div>
                      {editingId === c.id ? (
                        <div>
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="field min-h-[60px] w-full text-sm"
                          />
                          <div className="mt-1.5 flex justify-end gap-2">
                            <button onClick={() => setEditingId(null)} className="btn px-2 py-1 text-xs">Cancel</button>
                            <button onClick={() => void saveEdit(c.id)} className="btn px-2 py-1 text-xs font-semibold text-accent">Save</button>
                          </div>
                        </div>
                      ) : (
                        <div className="prose prose-invert max-w-none rounded-lg rounded-tl-sm border border-panel-line bg-panel-sunk px-3 py-2 text-sm text-ink [&_p]:my-0">
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
              <div className="border-t border-panel-line px-5 py-3">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void post() }}
                  placeholder="Add a comment…  (markdown supported · ⌘/Ctrl+Enter to post)"
                  className="field min-h-[60px] w-full text-sm"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button onClick={() => setDraft('')} className="btn px-3 py-1 text-xs">Clear</button>
                  <button onClick={() => void post()} disabled={busy || !draft.trim()} className="btn px-3 py-1 text-xs font-semibold text-accent disabled:opacity-50">Comment</button>
                </div>
              </div>
            )}
          </div>

          <aside className="w-64 shrink-0 overflow-y-auto border-l border-panel-line bg-panel-sunk px-4 py-4">
            {/* Stage */}
            <div className="mb-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Stage</div>
              <select
                value={stageId ?? ''}
                disabled={!canEdit}
                onChange={(e) => void changeStage(e.target.value)}
                className="field w-full text-sm disabled:opacity-60"
              >
                {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>

            {/* Votes — only meaningful in review-ish stages */}
            {myVoterId && stageId && reviewStageIds.has(stageId) && (() => {
              const t = tallyVotes(voteRows, subject.key)
              const mine = myVote[subject.key]
              return (
                <div className="mb-4">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Votes</div>
                  <div className="flex gap-2">
                    <button onClick={() => void castVote('yes')} disabled={!canEdit} className={`flex-1 rounded border py-1.5 text-sm font-semibold ${mine === 'yes' ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300' : 'border-panel-line text-emerald-300/80'}`}>✓ {t.yes}</button>
                    <button onClick={() => void castVote('no')} disabled={!canEdit} className={`flex-1 rounded border py-1.5 text-sm font-semibold ${mine === 'no' ? 'border-rose-500/50 bg-rose-500/20 text-rose-300' : 'border-panel-line text-rose-300/80'}`}>✕ {t.no}</button>
                    <button onClick={() => void castVote('abstain')} disabled={!canEdit} className={`flex-1 rounded border py-1.5 text-sm ${mine === 'abstain' ? 'border-panel-line2 bg-panel-hover text-ink' : 'border-panel-line text-ink-faint'}`}>– {t.abstain}</button>
                  </div>
                </div>
              )
            })()}

            {/* Nickname */}
            <div className="mb-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Nickname</div>
              <input
                value={nickname}
                disabled={!canEdit}
                onChange={(e) => setNickname(e.target.value)}
                onBlur={() => nickname !== subject.name && void saveAnn({ nickname })}
                className="field w-full text-sm disabled:opacity-60"
              />
            </div>

            {/* Aliases (comma-separated) */}
            <div className="mb-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Aliases / accounts</div>
              <input
                value={aliasText}
                disabled={!canEdit}
                onChange={(e) => setAliasText(e.target.value)}
                onBlur={() => aliasText !== subject.aliases.join(', ') && void saveAnn({ aliases: aliasText.split(',').map((a) => a.trim()).filter(Boolean) })}
                placeholder="Account.1234, alt name"
                className="field w-full text-sm disabled:opacity-60"
              />
            </div>

            {/* Tags */}
            <div className="mb-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Tags</div>
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
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Time in stage</div>
              <div className="text-sm text-ink-dim">{days === null ? '—' : `${days} day${days === 1 ? '' : 's'}`}</div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
