import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, ScrollText, Search, Loader2 } from 'lucide-react'
import type { AuditEvent, AuditFilter, AuditStatus, AuditSourceStatus } from '../../../preload/index.d'
import { client } from '../lib/client'
import {
  buildIdentityIndex,
  describeEvent,
  type IdentityIndex
} from '../lib/auditIdentities'
import IdentityChip from './IdentityChip'

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
      <span className="flex items-center gap-1.5 text-ink-dim">
        <Loader2 size={11} className="animate-spin text-amber-400" /> {name} · syncing
      </span>
    )
  }
  const dot =
    state === 'ok'
      ? 'bg-emerald-400'
      : state === 'error'
        ? 'bg-red-400'
        : state === 'skipped'
          ? 'bg-stone-500'
          : 'bg-stone-600'
  const text =
    state === 'ok'
      ? `${name} · ${s?.count ?? 0} events`
      : state === 'error'
        ? `${name} · ${s?.error ?? 'error'}`
        : state === 'skipped'
          ? `${name} · no key`
          : name
  return (
    <span
      className={`flex items-center gap-1.5 ${state === 'error' ? 'text-red-400' : 'text-ink-dim'}`}
      title={state === 'error' ? s?.error : undefined}
    >
      <span className={`h-[7px] w-[7px] flex-none rounded-full ${dot}`} />
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
    return client.onWorkspaceChanged(() => void loadIdentities())
  }, [loadIdentities])

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
    <div className="flex min-h-0 flex-1 flex-col">
      {/* sync status strip */}
      <div className="flex items-center gap-4 border-b border-panel-line bg-panel-sunk px-4 py-2 text-xs">
        <SourcePill name="GW2" s={status?.gw2} />
        <SourcePill name="Discord" s={status?.discord} />
        <span className="ml-auto text-[11px] text-ink-faint">
          {anySyncing
            ? 'Syncing…'
            : lastSynced
              ? `Last synced ${new Date(lastSynced).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
              : 'Not synced yet'}
        </span>
      </div>

      {/* controls */}
      <div className="flex items-center gap-2 border-b border-panel-line px-4 py-2.5">
        <div className="flex rounded-md bg-panel-sunk p-0.5">
          {SOURCES.map((s) => (
            <button
              key={s.id || 'all'}
              onClick={() => setSource(s.id)}
              className={`rounded px-2.5 py-1 text-xs ${
                source === s.id ? 'bg-accent/16 text-accent' : 'text-ink-dim hover:text-ink'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="flex flex-1 items-center gap-1.5 rounded-md bg-panel-sunk px-2.5 py-1.5">
          <Search size={14} className="text-ink-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or action…"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
        </label>
        <button
          onClick={() => void refresh()}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-md bg-panel-sunk px-2.5 py-1.5 text-xs text-ink-dim hover:text-ink disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {events.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-sm text-ink-faint">
            <div className="flex flex-col items-center gap-2">
              <ScrollText size={20} />
              No log entries yet. Click <span className="text-ink">Refresh</span> to pull the latest.
            </div>
          </div>
        ) : (
          groups.map((g) => {
            const { rel, full } = dayLabel(g.day)
            return (
              <div key={g.day} className="mb-1">
                <div className="sticky top-0 z-[2] bg-gradient-to-b from-panel from-70% to-transparent px-1 pb-1.5 pt-3.5">
                  <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink">
                    <span className="h-3.5 w-1 rounded-sm bg-accent" />
                    {rel}
                    {full && <span className="font-normal normal-case tracking-normal text-ink-faint">{full}</span>}
                  </span>
                </div>
                {g.rows.map((e) => (
                  <EventRow key={e.uid} event={e} index={index} />
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
  if (channel.name) {
    return (
      <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-xs text-sky-300">
        #{channel.name}
      </span>
    )
  }
  // Unresolvable (e.g. a deleted channel): keep the raw id dimmed, never drop it.
  return (
    <span className="rounded border border-panel-line bg-panel-sunk px-1.5 py-0.5 font-mono text-xs text-ink-faint">
      #{channel.id ?? 'unknown'}
    </span>
  )
}

function EventRow({ event, index }: { event: AuditEvent; index: IdentityIndex }): JSX.Element {
  const m = describeEvent(event, index)
  return (
    <div className="flex items-center gap-2.5 border-b border-panel-line/55 px-1.5 py-1.5 text-sm hover:bg-panel-hover">
      <span className="w-16 flex-none whitespace-nowrap text-xs tabular-nums text-ink-faint">
        {timeOf(event.time)}
      </span>
      <span
        className={`flex-none rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
          event.source === 'gw2'
            ? 'bg-emerald-500/13 text-emerald-400'
            : 'bg-indigo-500/16 text-indigo-300'
        }`}
      >
        {event.source}
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
        {m.fallback ? (
          <span className="text-ink">{m.fallback}</span>
        ) : (
          <>
            {m.lead && <IdentityChip chip={m.lead} />}
            {m.action.length > 0 && (
              <span className="text-ink-dim">
                {m.action.map((s, i) => (
                  <span key={i} className={s.b ? 'font-medium text-ink' : undefined}>
                    {s.t}
                  </span>
                ))}
              </span>
            )}
            {m.channel && <ChannelTag channel={m.channel} />}
            {m.trail && <IdentityChip chip={m.trail} />}
          </>
        )}
      </span>
    </div>
  )
}
