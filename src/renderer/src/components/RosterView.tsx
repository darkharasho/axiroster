import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search, AlertTriangle } from 'lucide-react'
import type {
  ReconciledMember,
  RosterPayload,
  RosterStatus
} from '../../../preload/index.d'
import { STATUS_META } from '../lib/status'
import MemberDetail from './MemberDetail'

type Filter = 'all' | RosterStatus

export default function RosterView(): JSX.Element {
  const [payload, setPayload] = useState<RosterPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await window.axiroster.buildRoster()
    if (res.ok) setPayload(res.data)
    else setError(res.error)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const off = window.axiroster.onSyncChanged(load)
    return off
  }, [load])

  const members = payload?.members ?? []
  const selected = members.find((m) => m.annotationKey === selectedKey) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return members.filter((m) => {
      if (filter !== 'all' && m.status !== filter) return false
      if (!q) return true
      const hay = [
        m.label,
        m.nickname,
        m.discordName,
        m.displayName,
        ...m.aliases,
        ...m.tags,
        ...m.accounts.map((a) => a.account_name)
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [members, query, filter])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: members.length }
    for (const m of members) c[m.status] = (c[m.status] ?? 0) + 1
    return c
  }, [members])

  const filters: Filter[] = ['all', 'verified', 'linked', 'no-key', 'unlinked', 'left-guild']

  return (
    <div className="flex h-full min-h-0">
      {/* list */}
      <div className="flex w-80 shrink-0 flex-col border-r border-panel-line">
        <div className="flex items-center gap-2 border-b border-panel-line px-3 py-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-2.5 top-2.5 text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search roster…"
              className="field pl-8"
            />
          </div>
          <button onClick={load} className="btn px-2" title="Refresh">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-panel-line px-3 py-2">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-2 py-0.5 text-xs transition ${
                filter === f
                  ? 'bg-accent/20 text-accent-soft'
                  : 'text-ink-dim hover:text-ink'
              }`}
            >
              {f === 'all' ? 'All' : STATUS_META[f].label}
              <span className="ml-1 text-ink-faint">{counts[f] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.map((m) => (
            <MemberRow
              key={m.annotationKey}
              member={m}
              selected={m.annotationKey === selectedKey}
              onClick={() => setSelectedKey(m.annotationKey)}
            />
          ))}
          {!loading && filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-ink-faint">
              {members.length === 0
                ? 'No roster yet — connect GW2 + Discord in Settings.'
                : 'No members match.'}
            </div>
          )}
        </div>
      </div>

      {/* detail */}
      <div className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div className="flex items-center gap-2 border-b border-panel-line bg-red-500/10 px-4 py-2 text-sm text-red-300">
            <AlertTriangle size={15} /> {error}
          </div>
        )}
        {payload?.warnings.map((w) => (
          <div
            key={w}
            className="flex items-center gap-2 border-b border-panel-line bg-amber-500/10 px-4 py-1.5 text-xs text-amber-300"
          >
            <AlertTriangle size={13} /> {w}
          </div>
        ))}
        {selected ? (
          <MemberDetail
            member={selected}
            metrics={payload?.metrics ?? {}}
            allMembers={members}
            onChanged={load}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-ink-faint">
            Select a member to view details.
          </div>
        )}
      </div>
    </div>
  )
}

function MemberRow({
  member,
  selected,
  onClick
}: {
  member: ReconciledMember
  selected: boolean
  onClick: () => void
}): JSX.Element {
  const meta = STATUS_META[member.status]
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 border-b border-panel-line/60 px-3 py-2 text-left transition ${
        selected ? 'bg-panel-raised' : 'hover:bg-panel-raised/50'
      }`}
    >
      <span className="led shrink-0" style={{ background: meta.color }} title={meta.label} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-ink">{member.label}</div>
        <div className="truncate text-xs text-ink-faint">
          {member.accounts[0]?.account_name ?? member.discordName ?? '—'}
        </div>
      </div>
      {member.tags.slice(0, 2).map((t) => (
        <span key={t} className="chip shrink-0 px-1.5 py-0">
          {t}
        </span>
      ))}
    </button>
  )
}
