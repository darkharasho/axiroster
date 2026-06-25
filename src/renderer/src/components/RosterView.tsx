import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search, AlertTriangle, Swords, MessageSquare, Activity } from 'lucide-react'
import type {
  BridgePlayerMetrics,
  ReconciledMember,
  RosterPayload,
  RosterStatus,
  SourceStatus
} from '../../../preload/index.d'
import { STATUS_META, fmtRelative } from '../lib/status'
import { aggregateMemberMetrics } from '../lib/metrics'
import ClassIcon from './ClassIcon'
import MemberDetail from './MemberDetail'

type Filter = 'all' | RosterStatus

export default function RosterView(): JSX.Element {
  const [payload, setPayload] = useState<RosterPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [view, setView] = useState<'table' | 'cards'>('table')

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

  const stats = useMemo(() => {
    const linked = members.filter((m) => m.status === 'verified' || m.status === 'linked').length
    const tracked = members.filter((m) => aggregateMemberMetrics(m.accounts, payload?.metrics ?? {})).length
    const atts = members
      .map((m) => deriveRow(m, payload?.metrics ?? {}).attendance)
      .filter((a): a is number => a !== null)
    const avgAtt = atts.length ? Math.round(atts.reduce((s, a) => s + a, 0) / atts.length) : null
    return { total: members.length, linked, tracked, avgAtt }
  }, [members, payload])

  const filters: Filter[] = ['all', 'verified', 'linked', 'no-key', 'unlinked', 'left-guild']

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* source-status strip — unchanged SourcePill row */}
      <div className="flex items-center gap-2 overflow-hidden border-b border-panel-line px-3 py-2">
        <SourcePill icon={<Swords size={13} />} label="GW2" s={payload?.sources.gw2} unit="members" />
        <SourcePill icon={<MessageSquare size={13} />} label="Discord" s={payload?.sources.discord} unit="members" />
        <SourcePill icon={<Activity size={13} />} label="AxiBridge" s={payload?.sources.bridge} unit="tracked" />
        <div className="ml-auto shrink-0 text-xs text-ink-faint">{members.length} in roster</div>
      </div>

      {selected ? (
        <MemberDetail
          member={selected}
          metrics={payload?.metrics ?? {}}
          discordGuildId={payload?.discordGuildId ?? null}
          discordRoles={payload?.discordRoles ?? []}
          discordCandidates={payload?.discordCandidates ?? []}
          onSelect={setSelectedKey}
          onChanged={load}
          onBack={() => setSelectedKey(null)}
          siblings={filtered.map((m) => m.annotationKey)}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* error + warnings */}
          {error && (
            <div className="flex items-center gap-2 border-b border-panel-line bg-red-500/10 px-4 py-2 text-sm text-red-300">
              <AlertTriangle size={15} /> {error}
            </div>
          )}
          {payload?.warnings.map((w) => (
            <div key={w} className="flex items-center gap-2 border-b border-panel-line bg-amber-500/10 px-4 py-1.5 text-xs text-amber-300">
              <AlertTriangle size={13} /> {w}
            </div>
          ))}

          {/* stat cards */}
          <div className="grid grid-cols-4 gap-3 px-4 pt-4">
            <StatCard k="Members" v={String(stats.total)} />
            <StatCard k="Linked" v={`${stats.linked} / ${stats.total}`} />
            <StatCard k="Tracked (AxiBridge)" v={String(stats.tracked)} />
            <StatCard k="Avg attendance" v={stats.avgAtt !== null ? `${stats.avgAtt}%` : '—'} />
          </div>

          {/* controls */}
          <div className="flex items-center gap-2 px-4 py-3">
            <div className="relative flex-1 max-w-sm">
              <Search size={15} className="absolute left-2.5 top-2.5 text-ink-faint" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search roster…" className="field pl-8" />
            </div>
            <div className="seg">
              <button onClick={() => setView('table')} className={`seg-item ${view === 'table' ? 'seg-item-on' : ''}`}>Table</button>
              <button onClick={() => setView('cards')} className={`seg-item ${view === 'cards' ? 'seg-item-on' : ''}`}>Cards</button>
            </div>
            <button onClick={load} className="btn px-2" title="Refresh">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* filter pills */}
          <div className="flex flex-wrap gap-1 px-4 pb-3">
            {filters.map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-2.5 py-0.5 text-xs transition ${
                filter === f ? 'bg-accent/15 text-accent-soft' : 'text-ink-dim hover:text-ink'
              }`}>
                {f === 'all' ? 'All' : STATUS_META[f].label}
                <span className="ml-1 text-ink-faint">{counts[f] ?? 0}</span>
              </button>
            ))}
          </div>

          {/* table / cards */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {view === 'table' ? (
              <MemberTable rows={filtered} metrics={payload?.metrics ?? {}} onSelect={setSelectedKey} />
            ) : (
              <MemberCards rows={filtered} metrics={payload?.metrics ?? {}} onSelect={setSelectedKey} />
            )}
            {!loading && filtered.length === 0 && (
              <div className="px-4 py-12 text-center text-sm text-ink-faint">
                {members.length === 0 ? 'No roster yet — connect GW2 + Discord in Settings.' : 'No members match.'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Derive the display fields the table/cards need from a member + payload metrics.
function deriveRow(member: ReconciledMember, metrics: Record<string, BridgePlayerMetrics>) {
  const m = aggregateMemberMetrics(member.accounts, metrics)
  const attendance =
    m && m.raidsConsidered > 0 ? Math.round((m.raidsAttended / m.raidsConsidered) * 100) : null
  return {
    mainClass: m?.mainClass ?? null,
    attendance,
    lastSeen: m ? fmtRelative(m.lastSeen) : '—',
    account: member.accounts[0]?.account_name ?? member.discordName ?? '—'
  }
}

function StatCard({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div className="stat-card">
      <div className="text-xs font-medium text-ink-faint">{k}</div>
      <div className="mt-1 font-mono text-2xl font-bold text-ink">{v}</div>
    </div>
  )
}

function MemberTable({
  rows,
  metrics,
  onSelect
}: {
  rows: ReconciledMember[]
  metrics: Record<string, BridgePlayerMetrics>
  onSelect: (k: string) => void
}): JSX.Element {
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[16px_1.6fr_1fr_120px_1fr_90px] gap-3 border-b border-panel-line px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        <div></div><div>Member</div><div>Profession</div><div>Rank</div><div>Attendance</div><div>Last seen</div>
      </div>
      {rows.map((m) => {
        const d = deriveRow(m, metrics)
        const meta = STATUS_META[m.status]
        return (
          <button
            key={m.annotationKey}
            onClick={() => onSelect(m.annotationKey)}
            className="grid w-full grid-cols-[16px_1.6fr_1fr_120px_1fr_90px] items-center gap-3 border-b border-panel-line/60 px-4 py-2.5 text-left transition last:border-0 hover:bg-panel-hover"
          >
            <span className="led" style={{ background: meta.color }} title={meta.label} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">{m.label}</div>
              <div className="truncate text-xs text-ink-faint">{d.account}</div>
            </div>
            <div className="flex min-w-0 items-center gap-2 text-sm text-ink-dim">
              {d.mainClass ? <ClassIcon name={d.mainClass} size={16} /> : null}
              <span className="truncate">{d.mainClass ?? '—'}</span>
            </div>
            <div>
              {m.rank ? <span className="chip">{m.rank}</span> : <span className="text-xs text-ink-faint">—</span>}
            </div>
            <div>
              {d.attendance !== null ? (
                <>
                  <div className="h-1.5 overflow-hidden rounded-full bg-panel-line2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${d.attendance}%` }} />
                  </div>
                  <div className="mt-1 font-mono text-xs text-ink-dim">{d.attendance}%</div>
                </>
              ) : (
                <span className="text-xs text-ink-faint">—</span>
              )}
            </div>
            <div className="text-right font-mono text-xs text-ink-dim">{d.lastSeen}</div>
          </button>
        )
      })}
    </div>
  )
}

function MemberCards(_: { rows: ReconciledMember[]; metrics: Record<string, BridgePlayerMetrics>; onSelect: (k: string) => void }): JSX.Element | null {
  return null // implemented in Task 5
}

function SourcePill({
  icon,
  label,
  s,
  unit
}: {
  icon: JSX.Element
  label: string
  s: SourceStatus | undefined
  unit: string
}): JSX.Element {
  // grey = no key · amber = key but needs a guild selected · red = fetch failed ·
  // green = loaded
  const color = !s
    ? '#78716c'
    : !s.hasKey
      ? '#78716c'
      : s.loaded
        ? '#22c55e'
        : !s.configured
          ? '#f59e0b'
          : '#ef4444'
  // Compact one-liner: count when loaded, short status otherwise. Full detail
  // (incl. guild/server name) is in the tooltip so the pill never needs to wrap.
  const short = !s
    ? 'loading…'
    : s.loaded
      ? `${s.count} ${unit}`
      : (s.error ?? 'loading…')
  const full = !s
    ? `${label}: loading…`
    : s.loaded
      ? `${label}: ${s.count} ${unit}${s.guildName ? ` · ${s.guildName}` : ''}`
      : `${label}: ${s.error ?? 'loading…'}`
  return (
    <span
      className="chip min-w-0 max-w-[16rem] flex-nowrap items-center whitespace-nowrap"
      title={full}
    >
      <span className="led shrink-0" style={{ background: color }} />
      <span className="shrink-0">{icon}</span>
      <span className="shrink-0 text-ink">{label}</span>
      <span className="min-w-0 truncate text-ink-faint">{short}</span>
    </span>
  )
}
