import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, ScrollText, Search } from 'lucide-react'
import type { AuditEvent, AuditFilter } from '../../../preload/index.d'

const SOURCES: { id: '' | 'gw2' | 'discord'; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'gw2', label: 'GW2' },
  { id: 'discord', label: 'Discord' }
]

function dayKey(iso: string): string {
  return iso.slice(0, 10) || 'unknown'
}

function timeOf(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function GuildLog(): JSX.Element {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [updatedAt, setUpdatedAt] = useState('')
  const [source, setSource] = useState<'' | 'gw2' | 'discord'>('')
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const filter: AuditFilter = {}
    if (source) filter.source = source
    if (search.trim()) filter.search = search.trim()
    const res = await window.axiroster.auditList(filter)
    setEvents(res.events)
    setUpdatedAt(res.updatedAt)
  }, [source, search])

  useEffect(() => {
    void load()
  }, [load])

  // Re-fetch whenever the poller reports new events; pull immediately on mount.
  useEffect(() => {
    return window.axiroster.onAuditUpdated(() => void load())
  }, [load])

  useEffect(() => {
    return window.axiroster.onAuditError((msg) => setError(msg))
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    const res = await window.axiroster.auditRefresh()
    if (!res.ok) setError(res.error)
    await load()
    setRefreshing(false)
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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

      {error && (
        <div className="border-b border-panel-line bg-red-500/10 px-4 py-1.5 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {events.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-sm text-ink-faint">
            <div className="flex flex-col items-center gap-2">
              <ScrollText size={20} />
              No log entries yet. Click <span className="text-ink">Refresh</span> to pull the latest.
            </div>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.day} className="mb-3">
              <div className="sticky top-0 bg-panel py-1 text-xs font-medium text-ink-faint">
                {g.day}
              </div>
              {g.rows.map((e) => (
                <div
                  key={e.uid}
                  className="flex items-start gap-2 border-b border-panel-line/60 py-1.5 text-sm"
                >
                  <span className="w-12 shrink-0 text-xs text-ink-faint">{timeOf(e.time)}</span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${
                      e.source === 'gw2'
                        ? 'bg-emerald-500/14 text-emerald-400'
                        : 'bg-indigo-500/16 text-indigo-300'
                    }`}
                  >
                    {e.source}
                  </span>
                  <span className="text-ink">{e.summary}</span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {updatedAt && (
        <div className="border-t border-panel-line px-4 py-1.5 text-right text-[11px] text-ink-faint">
          Last synced {new Date(updatedAt).toLocaleString()}
        </div>
      )}
    </div>
  )
}
