import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, ScrollText, Search, Loader2, ChevronRight } from 'lucide-react'
import type { AuditEvent, AuditFilter, AuditStatus, AuditSourceStatus } from '../../../preload/index.d'
import { client } from '../lib/client'
import {
  buildIdentityIndex,
  describeEvent,
  type IdentityIndex
} from '../lib/auditIdentities'
import { detailBlocks, detailPreview, type DetailBlock, type DetailModel } from '../lib/auditDetails'
import IdentityChip from './IdentityChip'
import { toneDiamond, type Tone } from '../lib/status'

const SOURCES: { id: '' | 'gw2' | 'discord'; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'gw2', label: 'GW2' },
  { id: 'discord', label: 'Discord' }
]

const EMPTY_INDEX: IdentityIndex = { byDiscordId: new Map(), byAccount: new Map(), channels: new Map() }

function dayKey(iso: string): string {
  return iso.slice(0, 10) || 'unknown'
}

function timeOf(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Relative ("Today"/"Yesterday") + the full weekday-date for a YYYY-MM-DD key. */
function dayLabel(key: string): { rel: string; full: string } {
  const d = new Date(`${key}T00:00:00`)
  if (Number.isNaN(d.getTime())) return { rel: key, full: '' }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000)
  const full = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
  if (diff === 0) return { rel: 'Today', full }
  if (diff === 1) return { rel: 'Yesterday', full }
  return { rel: full, full: '' }
}

function SourcePill({ name, s }: { name: string; s?: AuditSourceStatus }): JSX.Element {
  const state = s?.state ?? 'idle'
  if (state === 'syncing') {
    return (
      <span className="axi-legend__key">
        {/* The blink is opacity only, so it keeps reporting liveness even while
            the sync it reports on holds the main thread (rule 11). */}
        <Loader2 size={11} className="ar-work ar-ink-warn" /> {name} ·
        syncing
      </span>
    )
  }
  const tone: Tone = state === 'ok' ? 'ok' : state === 'error' ? 'danger' : 'idle'
  const text =
    state === 'ok'
      ? `${name} · ${s?.count ?? 0} events`
      : state === 'error'
        ? `${name} · ${s?.error ?? 'error'}`
        : state === 'skipped'
          ? `${name} · no key`
          : name
  return (
    <span className="axi-legend__key" title={state === 'error' ? s?.error : undefined}>
      <span className={toneDiamond(tone)} />
      <span className="max-w-[260px] truncate">{text}</span>
    </span>
  )
}

export default function GuildLog(): JSX.Element {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [status, setStatus] = useState<AuditStatus | null>(null)
  const [index, setIndex] = useState<IdentityIndex>(EMPTY_INDEX)
  const [source, setSource] = useState<'' | 'gw2' | 'discord'>('')
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  // Expanded row uids. Survives list refreshes; stale uids (filtered/switched
  // away) are harmless — absent rows render nothing.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggleRow = useCallback((uid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }, [])

  const load = useCallback(async () => {
    const filter: AuditFilter = {}
    if (source) filter.source = source
    if (search.trim()) filter.search = search.trim()
    const res = await client.auditList(filter)
    setEvents(res.events)
  }, [source, search])

  const loadIdentities = useCallback(async () => {
    try {
      const res = await client.buildRoster()
      if (res.ok) setIndex(buildIdentityIndex(res.data.members))
    } catch {
      /* keep the empty index — chips fall back to raw names */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadIdentities()
    // A workspace/guild switch swaps the audit store underneath us — refetch the
    // events too, or the previous guild's rows linger until something new lands.
    return client.onWorkspaceChanged(() => {
      void loadIdentities()
      void load()
    })
  }, [loadIdentities, load])

  // Live sync status for the strip.
  useEffect(() => {
    void client.auditStatus().then((s) => s && setStatus(s))
    return client.onAuditStatus(setStatus)
  }, [])

  // Re-fetch the list whenever the poller reports new events.
  useEffect(() => {
    return client.onAuditUpdated(() => void load())
  }, [load])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await client.auditRefresh()
      await load()
    } finally {
      setRefreshing(false)
    }
  }, [load])

  const groups = useMemo(() => {
    const out: { day: string; rows: AuditEvent[] }[] = []
    for (const e of events) {
      const k = dayKey(e.time)
      const last = out[out.length - 1]
      if (last && last.day === k) last.rows.push(e)
      else out.push({ day: k, rows: [e] })
    }
    return out
  }, [events])

  const lastSynced = status?.updatedAt
  const anySyncing = status?.running

  return (
    <div className="ar-pane">
      {/* sync status strip */}
      <div className="ar-pane__head" style={{ '--ar-head-gap': '18px' } as React.CSSProperties}>
        <SourcePill name="GW2" s={status?.gw2} />
        <SourcePill name="Discord" s={status?.discord} />
        <span className="ar-note--faint ml-auto">
          {anySyncing
            ? 'Syncing…'
            : lastSynced
              ? `Last synced ${new Date(lastSynced).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
              : 'Not synced yet'}
        </span>
      </div>

      {/* controls */}
      <div className="ar-pane__head">
        <div className="flex gap-1">
          {SOURCES.map((s) => (
            <button
              key={s.id || 'all'}
              onClick={() => setSource(s.id)}
              aria-pressed={source === s.id}
              className="axi-pill"
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="axi-search flex-1">
          <Search size={14} className="axi-search__icon" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or action…"
            className="axi-input"
          />
        </div>
        <button onClick={() => void refresh()} disabled={refreshing} className="axi-btn">
          <RefreshCw size={14} className={refreshing ? 'ar-work' : ''} />
          Refresh
        </button>
      </div>

      {/* list */}
      <div className="ar-log">
        {events.length === 0 ? (
          <div className="ar-note--faint grid h-full place-items-center text-center">
            <div className="flex flex-col items-center gap-3">
              <ScrollText size={20} />
              No log entries yet. Click{' '}
              <span className="ar-ink">Refresh</span> to pull the latest.
            </div>
          </div>
        ) : (
          groups.map((g) => {
            const { rel, full } = dayLabel(g.day)
            return (
              <div key={g.day}>
                <div className="ar-log__day">
                  {rel}
                  {full && <span className="ar-note--faint">{full}</span>}
                </div>
                {g.rows.map((e) => (
                  <EventRow
                    key={e.uid}
                    event={e}
                    index={index}
                    open={expanded.has(e.uid)}
                    onToggle={toggleRow}
                  />
                ))}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function ChannelTag({ channel }: { channel: { name?: string; id?: string } }): JSX.Element {
  // Where something happened is metadata about the event, which is exactly what
  // the reserved cool ink marks — outlined, never a status (rules 5/6).
  if (channel.name) {
    return <span className="axi-chip axi-chip--meta">#{channel.name}</span>
  }
  // Unresolvable (e.g. a deleted channel): keep the raw id dimmed, never drop it.
  return <span className="axi-chip">#{channel.id ?? 'unknown'}</span>
}

function DetailLabel({ text, tone }: { text: string; tone?: 'danger' | 'ok' }): JSX.Element {
  return (
    <div className={`ar-label mb-1${tone ? ` ar-ink-${tone}` : ''}`}>{text}</div>
  )
}

function DetailBlockView({ b }: { b: DetailBlock }): JSX.Element {
  switch (b.kind) {
    case 'diff':
      return (
        <>
          <div>
            <DetailLabel text="Before" tone="danger" />
            <div className="ar-log__body ar-log__body--before">{b.before.value}</div>
          </div>
          <div>
            <DetailLabel text="After" tone="ok" />
            <div className="ar-log__body ar-log__body--after">{b.after.value}</div>
          </div>
        </>
      )
    case 'tags':
      return (
        <div>
          <DetailLabel text={b.op === 'add' ? 'Added' : 'Removed'} />
          <div className="flex flex-wrap gap-1.5">
            {b.items.map((it, i) => (
              <span
                key={i}
                className={
                  it.unresolved
                    ? 'axi-chip'
                    : `axi-chip axi-chip--${b.op === 'add' ? 'ok' : 'danger'}`
                }
              >
                {b.op === 'add' ? '+' : '−'} {it.label}
              </span>
            ))}
          </div>
        </div>
      )
    case 'unavailable':
      return (
        <div className="ar-note--faint italic" title={b.field.value}>
          {b.field.key} unavailable
        </div>
      )
    case 'block':
      return (
        <div>
          <DetailLabel text={b.field.key} />
          <div className="ar-log__body">{b.field.value}</div>
        </div>
      )
    case 'arrow':
      return (
        <div className="flex items-baseline gap-2">
          <span className="ar-label w-24 flex-none">{b.key}</span>
          <span className="ar-note">
            <span className="ar-ink-faint">{b.from}</span>
            <span className="ar-ink-faint"> → </span>
            <span className="ar-ink">{b.to}</span>
          </span>
        </div>
      )
    case 'kv':
      return (
        <div className="flex items-baseline gap-2">
          <span className="ar-label w-24 flex-none">{b.key}</span>
          <span className="ar-note">{b.value}</span>
        </div>
      )
  }
}

function DetailCard({ model }: { model: DetailModel }): JSX.Element {
  return (
    <div className="ar-log__detail">
      {detailBlocks(model).map((b, i) => (
        <DetailBlockView key={i} b={b} />
      ))}
    </div>
  )
}

function EventRow({
  event,
  index,
  open,
  onToggle
}: {
  event: AuditEvent
  index: IdentityIndex
  open: boolean
  onToggle: (uid: string) => void
}): JSX.Element {
  const m = describeEvent(event, index)
  const preview = m.details ? detailPreview(m.details) : []
  const expandable = m.details !== undefined
  return (
    <>
      <div
        className="ar-log__row"
        style={expandable ? { cursor: 'pointer' } : undefined}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onClick={expandable ? () => onToggle(event.uid) : undefined}
        onKeyDown={
          expandable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onToggle(event.uid)
                }
              }
            : undefined
        }
      >
        <span className="ar-num w-16 flex-none whitespace-nowrap">{timeOf(event.time)}</span>
        {/* Which system reported the event is provenance, not a verdict on it. */}
        <span className="axi-chip flex-none">{event.source}</span>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
          {m.fallback ? (
            <span className="ar-ink">{m.fallback}</span>
          ) : (
            <>
              {m.lead && <IdentityChip chip={m.lead} />}
              {m.action.length > 0 && (
                <span>
                  {m.action.map((s, i) => (
                    <span key={i} style={s.b ? { color: 'var(--axi-text)', fontWeight: 700 } : undefined}>
                      {s.t}
                    </span>
                  ))}
                </span>
              )}
              {m.channel && <ChannelTag channel={m.channel} />}
              {m.trail && <IdentityChip chip={m.trail} />}
              {preview.length > 0 && (
                <span className="ar-note--faint min-w-0 max-w-full flex-shrink truncate">
                  {preview.map((s) => s.t).join('')}
                </span>
              )}
            </>
          )}
        </span>
        {expandable && (
          <ChevronRight
            size={13}
            className={`flex-none transition-transform ${open ? 'rotate-90' : ''}`}
          />
        )}
      </div>
      {open && m.details && <DetailCard model={m.details} />}
    </>
  )
}
