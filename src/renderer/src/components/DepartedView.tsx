// src/renderer/src/components/DepartedView.tsx
//
// Departed members: the durable history of everyone who left or was kicked from
// the GW2 guild, joined at read time with live Discord state so people who still
// hold the member role are flagged for cleanup. Records live in reserved
// departure:* annotation rows (shared/departures.ts); detection runs on desktop
// after a live pull and on web in refresh-roster.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search, AlertTriangle, Check, Minus, ChevronRight, ChevronDown, UserMinus, Plus, X } from 'lucide-react'
import type { RosterPayload } from '../../../preload/index.d'
import { client } from '../lib/client'
import { toast } from '../lib/toast'
import { fmtRelative, toneVar } from '../lib/status'
import { useGuildData } from '../lib/useGuildData'
import LoadError from './LoadError'
import DepartedSkeleton from './skeletons/DepartedSkeleton'
import Tooltip from './Tooltip'
import Picker from './Picker'
import DepartureDetail from './DepartureDetail'
import { departureKey, parseDepartureDoc, serializeDepartureDoc, type DepartureDoc } from '../../../shared/departures'
import {
  buildDepartedRows, sortDepartedRows, filterDepartedRows, countDeparted, replaceDoc, linkDoc,
  dismissSuggestion, removeRoles, roleActionBlocker, DEPARTED_FILTERS, DEPARTED_META,
  type DepartedFilter, type DepartedRow
} from '../lib/departures'

const fmtExact = (iso: string): string => new Date(iso).toLocaleString()

interface DepartedData {
  payload: RosterPayload | null
  /** The roster build failed; departures still show, matched against nothing. */
  rosterError: string | null
  docs: DepartureDoc[]
  canEdit: boolean
}

async function loadDeparted(): Promise<DepartedData> {
  const [roster, auth] = await Promise.all([client.buildRoster(), client.authStatus().catch(() => null)])
  // Desktop detection runs inside buildRoster, so read departures after it.
  const rows = await client.departuresGet()
  return {
    payload: roster.ok ? roster.data : null,
    rosterError: roster.ok ? null : roster.error,
    docs: rows.map((r) => parseDepartureDoc(r.key, r.notes)),
    canEdit: auth?.role !== 'read'
  }
}

export default function DepartedView(props: { initialFilter?: DepartedFilter }): JSX.Element {
  const q = useGuildData(loadDeparted, { on: ['sync'] })
  if (q.loading) return <DepartedSkeleton />
  if (!q.data) {
    return <LoadError title="Couldn't load departures" error={q.error} onRetry={() => void q.reload()} />
  }
  return <DepartedBody {...props} data={q.data} reload={q.reload} refreshing={q.refreshing} />
}

function DepartedBody({
  initialFilter = 'all', data, reload, refreshing
}: {
  initialFilter?: DepartedFilter
  data: DepartedData
  reload: () => Promise<void>
  refreshing: boolean
}): JSX.Element {
  const payload = data.payload
  const error = data.rosterError
  const canEdit = data.canEdit
  const [docs, setDocs] = useState<DepartureDoc[]>(data.docs)
  useEffect(() => setDocs(data.docs), [data.docs])
  const [filter, setFilter] = useState<DepartedFilter>(initialFilter)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [linkingKey, setLinkingKey] = useState<string | null>(null)
  // undefined = closed; null = "add departure manually"; a key = that record.
  const [openKey, setOpenKey] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  useEffect(() => setFilter(initialFilter), [initialFilter])

  const memberRoleId = payload?.memberRoleId ?? null
  const rows = useMemo(
    () => sortDepartedRows(buildDepartedRows(docs, payload?.members ?? [], memberRoleId)),
    [docs, payload, memberRoleId]
  )
  const shown = useMemo(() => filterDepartedRows(rows, filter, query), [rows, filter, query])
  const counts = useMemo(() => countDeparted(rows), [rows])
  const blocker = roleActionBlocker({
    canEdit,
    discordConfigured: Boolean(payload?.sources.discord.configured && payload?.discordGuildId),
    memberRoleId
  })
  const selectedRows = rows.filter((r) => selected.has(r.key) && r.flagged && r.memberId)

  /** Persist one doc; false when the save failed (already toasted + reloaded). */
  const write = async (doc: DepartureDoc): Promise<boolean> => {
    setDocs((prev) => replaceDoc(prev, doc))
    try {
      const res = await client.upsertAnnotation(departureKey(doc.account), { notes: serializeDepartureDoc(doc) })
      if (res === null) throw new Error('the save was rejected')
      return true
    } catch (e) {
      toast(`Could not save ${doc.account}: ${String((e as Error).message ?? e)}`, 'error')
      await reload()
      return false
    }
  }

  // Every officer edit is a pure transform applied to the freshest stored doc, so
  // a concurrent change (detection, another officer) to another field isn't
  // clobbered by a stale in-memory copy. `current` is the fallback when the
  // record isn't stored yet (or the read fails).
  const update = async (
    current: DepartureDoc,
    transform: (doc: DepartureDoc) => DepartureDoc
  ): Promise<DepartureDoc | null> => {
    const key = departureKey(current.account)
    let base = current
    try {
      const fresh = (await client.departuresGet()).find((r) => r.key === key)
      if (fresh) base = parseDepartureDoc(fresh.key, fresh.notes)
    } catch {
      // fall back to the in-memory doc
    }
    const next = transform(base)
    return (await write(next)) ? next : null
  }

  const removeRole = async (targets: DepartedRow[]): Promise<void> => {
    const list = targets.filter((r) => r.flagged && r.memberId)
    const guildId = payload?.discordGuildId
    if (blocker || !guildId || !memberRoleId || list.length === 0) return
    const name = (r: DepartedRow): string => (r.member?.discordName ? `@${r.member.discordName}` : r.doc.account)
    const ask =
      list.length === 1
        ? `Remove ${name(list[0])}'s member role in Discord?`
        : `Remove the member role from ${list.length} people in Discord?`
    if (!confirm(ask)) return
    setBusy(list.length === 1 ? list[0].key : 'bulk')
    setProgress({ done: 0, total: list.length })
    const res = await removeRoles(
      list.map((r) => ({ key: r.key, memberId: r.memberId as string, label: name(r) })),
      (memberId) => client.discordAction(guildId, 'role_unassign', { member_id: memberId, role_id: memberRoleId }),
      (done, total) => setProgress({ done, total })
    )
    setBusy(null)
    setProgress(null)
    setRowErrors(Object.fromEntries(res.failed.map((f) => [f.key, f.error])))
    if (res.failed.length === 0) toast(`Removed the member role from ${res.removed.length}`)
    else toast(`Removed ${res.removed.length}; ${res.failed.length} failed: ${res.failed.map((f) => f.label).join(', ')}`, 'error')
    setSelected(new Set())
    // Refresh Discord state so the flags clear.
    await reload()
  }

  const toggle = (set: Set<string>, key: string): Set<string> => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  const selectable = shown.filter((r) => r.flagged && r.memberId)
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.key))
  const someSelected = selectable.some((r) => selected.has(r.key))
  const existingKeys = useMemo(() => new Set(docs.map((d) => departureKey(d.account))), [docs])
  const openDoc = openKey ? (docs.find((d) => departureKey(d.account) === openKey) ?? null) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="ar-pane__head">
        <span className="ar-ink">Departed</span>
        <div className="ar-note--faint ml-auto shrink-0">{rows.length} recorded</div>
      </div>

      {error && (
        <div className="ar-banner ar-banner--danger">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      <div className="flex items-center gap-2 px-4 py-3">
        {!blocker && selectable.length > 0 && (
          <button
            onClick={() =>
              setSelected((prev) => {
                const next = new Set(prev)
                for (const r of selectable) (allSelected ? next.delete(r.key) : next.add(r.key))
                return next
              })
            }
            className="axi-btn ar-sm"
          >
            <span className={`ar-check${allSelected ? ' ar-check--on' : someSelected ? ' ar-check--some' : ''}`}>
              {allSelected ? <Check size={11} /> : someSelected ? <Minus size={11} /> : null}
            </span>
            Select flagged
          </button>
        )}
        <div className="axi-search ar-sm max-w-sm flex-1">
          <Search size={15} className="axi-search__icon" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search account, Discord, actor, reason, note…"
            className="axi-input ar-sm"
          />
        </div>
        {canEdit && (
          <button onClick={() => setOpenKey(null)} className="axi-btn ar-sm">
            <Plus size={13} /> Add departure
          </button>
        )}
        <Tooltip text="Refresh">
          <button onClick={() => void reload()} className="ar-icon-btn">
            <RefreshCw size={15} className={refreshing ? 'ar-work' : ''} />
          </button>
        </Tooltip>
      </div>

      <div className="flex flex-wrap gap-2 px-4 pb-4">
        {DEPARTED_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className="axi-pill ar-sm"
            style={f === 'all' ? undefined : ({ '--axi-pill-fill': toneVar(DEPARTED_META[f].tone) } as React.CSSProperties)}
          >
            {f === 'all' ? 'All' : f === 'flagged' ? 'Flagged' : DEPARTED_META[f].label}
            <span className="ar-num">{counts[f]}</span>
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-6">
        {shown.length === 0 ? (
          <div className="ar-note--faint flex flex-1 items-center justify-center px-4 py-12 text-center">
            {rows.length === 0
              ? 'No departures recorded yet. They appear after a roster refresh with the guild leader’s GW2 key.'
              : 'No departures match.'}
          </div>
        ) : (
          <div className="ar-list">
            <div className="ar-list__rows">
              <table className="axi-table axi-table--sticky">
                <colgroup>
                  <col style={{ width: 36 }} />
                  <col style={{ width: 26 }} />
                  <col style={{ width: '18%' }} />
                  <col />
                  <col style={{ width: 110 }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: 96 }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: 44 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th />
                    <th />
                    <th>Account</th>
                    <th>Discord</th>
                    <th>Status</th>
                    <th>By</th>
                    <th>When</th>
                    <th>Reason</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const meta = DEPARTED_META[r.status]
                    const isOpen = expanded.has(r.key)
                    const checked = selected.has(r.key)
                    return (
                      <Fragment key={r.key}>
                        <tr
                          role="button"
                          tabIndex={0}
                          onClick={() => setOpenKey(r.key)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setOpenKey(r.key)
                            }
                          }}
                          className={checked ? 'ar-row--on' : undefined}
                        >
                          <td>
                            {r.flagged && r.memberId && !blocker && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelected((prev) => toggle(prev, r.key))
                                }}
                                title="Select"
                                className={`ar-check${checked ? ' ar-check--on' : ''}`}
                              >
                                {checked && <Check size={11} />}
                              </button>
                            )}
                          </td>
                          <td>
                            {r.doc.episodes.length > 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setExpanded((prev) => toggle(prev, r.key))
                                }}
                                title={isOpen ? 'Hide history' : `Show ${r.doc.episodes.length} departures`}
                                className="ar-icon-btn"
                              >
                                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              </button>
                            )}
                          </td>
                          <td>
                            <div className="ar-row__name">{r.doc.account}</div>
                            {r.flagged && (
                              <span className="axi-chip axi-chip--danger ar-sm mt-1">Still has member role</span>
                            )}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <DiscordCell
                              row={r}
                              canEdit={canEdit}
                              linking={linkingKey === r.key}
                              candidates={payload?.discordCandidates ?? []}
                              onStartLink={() => setLinkingKey(r.key)}
                              onEndLink={() => setLinkingKey(null)}
                              onLink={(id) => void update(r.doc, (d) => linkDoc(d, id))}
                              onDismiss={(id) => void update(r.doc, (d) => dismissSuggestion(d, id))}
                            />
                          </td>
                          <td>
                            <span className={`axi-chip ar-sm${meta.tone === 'idle' ? '' : ` axi-chip--${meta.tone}`}`}>
                              {meta.label}
                            </span>
                          </td>
                          <td className="ar-row__sub">{r.latest.actor ?? '—'}</td>
                          <td>
                            <Tooltip text={fmtExact(r.latest.at)}>
                              <span className="ar-num">{fmtRelative(r.latest.at)}</span>
                            </Tooltip>
                          </td>
                          <td className="ar-row__sub truncate">
                            {r.latest.reason || '—'}
                            {rowErrors[r.key] && <div className="ar-ink-danger">{rowErrors[r.key]}</div>}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            {r.flagged && r.memberId && (
                              <Tooltip text={blocker ?? 'Remove member role'}>
                                <button
                                  onClick={() => void removeRole([r])}
                                  disabled={Boolean(blocker) || busy !== null}
                                  className="ar-icon-btn"
                                >
                                  <UserMinus size={14} className={busy === r.key ? 'ar-work' : ''} />
                                </button>
                              </Tooltip>
                            )}
                          </td>
                        </tr>
                        {isOpen &&
                          r.doc.episodes.slice(1).map((e, i) => {
                            const m = DEPARTED_META[e.rejoinedAt ? 'rejoined' : e.kind]
                            return (
                              <tr key={`${r.key}:${e.at}:${i}`}>
                                <td />
                                <td />
                                <td />
                                <td className="ar-note--faint">{e.source.replace('-', ' ')}</td>
                                <td>
                                  <span className={`axi-chip ar-sm${m.tone === 'idle' ? '' : ` axi-chip--${m.tone}`}`}>{m.label}</span>
                                </td>
                                <td className="ar-row__sub">{e.actor ?? '—'}</td>
                                <td>
                                  <Tooltip text={fmtExact(e.at)}>
                                    <span className="ar-num">{fmtRelative(e.at)}</span>
                                  </Tooltip>
                                </td>
                                <td className="ar-row__sub truncate">{e.reason || '—'}</td>
                                <td />
                              </tr>
                            )
                          })}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {selectedRows.length > 0 && !blocker && (
          <div className="ar-selection">
            <span>
              {progress ? `Removing ${progress.done}/${progress.total}…` : `${selectedRows.length} selected`}
            </span>
            <button onClick={() => void removeRole(selectedRows)} disabled={busy !== null} className="axi-btn ar-sm">
              <UserMinus size={13} /> Remove member role from {selectedRows.length}
            </button>
            <Tooltip text="Clear selection" className="ml-auto inline-flex">
              <button onClick={() => setSelected(new Set())} className="axi-btn ar-sm">
                <X size={13} /> Clear
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      {openKey !== undefined && (openKey !== null || canEdit) && (
        <DepartureDetail
          doc={openDoc}
          canEdit={canEdit}
          existingKeys={existingKeys}
          onSave={update}
          onClose={() => setOpenKey(undefined)}
        />
      )}
    </div>
  )
}

function DiscordCell({
  row,
  canEdit,
  linking,
  candidates,
  onStartLink,
  onEndLink,
  onLink,
  onDismiss
}: {
  row: DepartedRow
  canEdit: boolean
  linking: boolean
  candidates: { id: string; name: string; displayName: string }[]
  onStartLink: () => void
  onEndLink: () => void
  onLink: (memberId: string | null) => void
  onDismiss: (memberId: string) => void
}): JSX.Element {
  if (linking) {
    return (
      <Picker
        autoOpen
        sm
        value={row.doc.memberId ?? ''}
        className="w-full"
        onChange={(v) => onLink(v || null)}
        onDismiss={onEndLink}
        options={[
          { value: '', label: 'No Discord link' },
          ...candidates.map((c) => ({ value: c.id, label: c.displayName === c.name ? c.name : `${c.displayName} (@${c.name})` }))
        ]}
      />
    )
  }
  const linkBtn = canEdit && (
    <button onClick={onStartLink} className="axi-btn ar-sm">
      Link…
    </button>
  )
  if (row.memberId) {
    const who = row.member?.discordName ? `@${row.member.discordName}` : row.memberId
    return (
      <div className="flex items-center gap-2">
        <span className="truncate ar-ink">{row.member?.displayName ?? who}</span>
        <span className="ar-row__sub truncate">{row.member ? who : 'left Discord'}</span>
        {linkBtn}
      </div>
    )
  }
  if (row.suggestion) {
    const s = row.suggestion
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="ar-note">Likely: @{s.name || s.displayName}</span>
        {canEdit && (
          <>
            <button onClick={() => onLink(s.id)} className="axi-btn ar-sm">Confirm</button>
            <button onClick={() => onDismiss(s.id)} className="axi-btn ar-sm">Not them</button>
          </>
        )}
        {linkBtn}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <span className="ar-note--faint">No Discord match</span>
      {linkBtn}
    </div>
  )
}
