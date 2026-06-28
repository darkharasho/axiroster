import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  RefreshCw,
  Search,
  AlertTriangle,
  Swords,
  MessageSquare,
  ChevronUp,
  ChevronDown,
  Check,
  Minus
} from 'lucide-react'
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
import axibridgeLogo from '../assets/axibridge-logo.svg'
import { addTagToMembers, removeTagFromMembers, tagsInSelection } from '../lib/bulkTags'
import { parseRegistry, setTagColor, type TagRegistry, type TagColorId } from '../lib/tagRegistry'
import { client } from '../lib/client'
import SelectionBar from './SelectionBar'
import { toast } from '../lib/toast'

type Filter = 'all' | RosterStatus
type SortKey = 'member' | 'profession' | 'rank' | 'attendance' | 'lastSeen'
type SortState = { key: SortKey; dir: 'asc' | 'desc' }

export default function RosterView({ resetToken }: { resetToken?: number }): JSX.Element {
  const [payload, setPayload] = useState<RosterPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [profFilter, setProfFilter] = useState<string>('all')
  const [rankFilter, setRankFilter] = useState<string>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [view, setView] = useState<'table' | 'cards'>('table')
  const [sort, setSort] = useState<SortState | null>(null)
  // Read members of a shared workspace can't edit annotations/links.
  const [canEdit, setCanEdit] = useState(true)

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [lastIdx, setLastIdx] = useState<number | null>(null)
  const [registry, setRegistry] = useState<TagRegistry>({})

  useEffect(() => {
    let alive = true
    client.getTagRegistry().then((m) => alive && setRegistry(parseRegistry(JSON.stringify(m))))
    return () => { alive = false }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await client.buildRoster()
    if (res.ok) setPayload(res.data)
    else setError(res.error)
    setLoading(false)
  }, [])

  const refreshRole = useCallback(async () => {
    const s = await client.authStatus()
    setCanEdit(s.role !== 'read')
  }, [])

  useEffect(() => {
    load()
    void refreshRole()
    // setActiveGuild fires sync:changed AND workspace:changed back-to-back, and
    // the membership poll can pile on — debounce so they coalesce into one build.
    let timer: ReturnType<typeof setTimeout> | null = null
    const debouncedLoad = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void load(), 200)
    }
    const offSync = client.onSyncChanged(debouncedLoad)
    const offWs = client.onWorkspaceChanged(() => {
      debouncedLoad()
      void refreshRole()
    })
    return () => {
      if (timer) clearTimeout(timer)
      offSync()
      offWs()
    }
  }, [load, refreshRole])

  // Nav actions (re-clicking the guild or Roster tab, or switching guilds) bump
  // resetToken to drop out of the member detail back to the list.
  useEffect(() => {
    setSelectedKey(null)
  }, [resetToken])

  const members = payload?.members ?? []
  const selected = members.find((m) => m.annotationKey === selectedKey) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const metrics = payload?.metrics ?? {}
    return members.filter((m) => {
      if (filter !== 'all' && m.status !== filter) return false
      if (rankFilter !== 'all' && m.rank !== rankFilter) return false
      if (profFilter !== 'all' && aggregateMemberMetrics(m.accounts, metrics)?.mainClass !== profFilter)
        return false
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
  }, [members, query, filter, profFilter, rankFilter, payload])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: members.length }
    for (const m of members) c[m.status] = (c[m.status] ?? 0) + 1
    return c
  }, [members])

  // Distinct professions present in the roster (main class per member), A→Z.
  const professions = useMemo(() => {
    const metrics = payload?.metrics ?? {}
    const set = new Set<string>()
    for (const m of members) {
      const cls = aggregateMemberMetrics(m.accounts, metrics)?.mainClass
      if (cls) set.add(cls)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [members, payload])

  // Distinct ranks present, ordered by the guild hierarchy (rankOrder) so the
  // dropdown reads top-down like the Rank column sort.
  const ranks = useMemo(() => {
    const order = payload?.rankOrder ?? {}
    const set = new Set<string>()
    for (const m of members) if (m.rank) set.add(m.rank)
    return [...set].sort(
      (a, b) => (order[a] ?? 999) - (order[b] ?? 999) || a.localeCompare(b)
    )
  }, [members, payload])

  const stats = useMemo(() => {
    const linked = members.filter((m) => m.status === 'verified' || m.status === 'linked').length
    const tracked = members.filter((m) => aggregateMemberMetrics(m.accounts, payload?.metrics ?? {})).length
    const atts = members
      .map((m) => deriveRow(m, payload?.metrics ?? {}).attendance)
      .filter((a): a is number => a !== null)
    const avgAtt = atts.length ? Math.round(atts.reduce((s, a) => s + a, 0) / atts.length) : null
    return { total: members.length, linked, tracked, avgAtt }
  }, [members, payload])

  // Table-only sort applied on top of the filtered list. Array.sort is stable,
  // so equal rows keep their filtered order; missing values sink to the bottom.
  const sorted = useMemo(() => {
    if (!sort) return filtered
    const metrics = payload?.metrics ?? {}
    const rankOrder = payload?.rankOrder ?? {}
    return [...filtered].sort((a, b) => compareBy(a, b, metrics, rankOrder, sort))
  }, [filtered, sort, payload])

  const toggleSort = (key: SortKey): void =>
    setSort((prev) =>
      prev && prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    )

  const displayed = view === 'table' ? sorted : filtered

  // Drop selections that are no longer present (e.g. after a roster rebuild).
  useEffect(() => {
    setSelectedKeys((prev) => {
      const valid = new Set(members.map((m) => m.annotationKey))
      let changed = false
      const next = new Set<string>()
      for (const k of prev) (valid.has(k) ? next.add(k) : (changed = true))
      return changed ? next : prev
    })
  }, [members])

  const toggleRow = (key: string, index: number, shift: boolean): void => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (shift && lastIdx !== null) {
        const [lo, hi] = lastIdx < index ? [lastIdx, index] : [index, lastIdx]
        const select = !prev.has(key) // match the clicked row's resulting state
        for (let i = lo; i <= hi; i++) {
          const k = displayed[i]?.annotationKey
          if (!k) continue
          if (select) next.add(k)
          else next.delete(k)
        }
      } else if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setLastIdx(index)
  }

  const allDisplayedSelected =
    displayed.length > 0 && displayed.every((m) => selectedKeys.has(m.annotationKey))
  const someDisplayedSelected = displayed.some((m) => selectedKeys.has(m.annotationKey))

  const toggleSelectAll = (): void => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (allDisplayedSelected) for (const m of displayed) next.delete(m.annotationKey)
      else for (const m of displayed) next.add(m.annotationKey)
      return next
    })
    setLastIdx(null)
  }

  const clearSelection = (): void => {
    setSelectedKeys(new Set())
    setLastIdx(null)
  }

  const applyAdd = async (name: string): Promise<void> => {
    const diffs = addTagToMembers(members, selectedKeys, name)
    await Promise.all(
      diffs.map((d) => client.upsertAnnotation(d.key, { tags: d.nextTags }).catch(() => {}))
    )
    toast(`Tagged ${diffs.length} member${diffs.length === 1 ? '' : 's'}`)
    await load()
  }

  const applyRemove = async (name: string): Promise<void> => {
    const diffs = removeTagFromMembers(members, selectedKeys, name)
    await Promise.all(
      diffs.map((d) => client.upsertAnnotation(d.key, { tags: d.nextTags }).catch(() => {}))
    )
    toast(`Removed from ${diffs.length} member${diffs.length === 1 ? '' : 's'}`)
    await load()
  }

  const recolorTag = async (name: string, id: TagColorId): Promise<void> => {
    const next = setTagColor(registry, name, id)
    setRegistry(next)
    await client.setTagRegistry(next).catch(() => {})
  }

  const addKnownTags = useMemo(() => {
    const names = new Map<string, string>()
    for (const k of Object.keys(registry)) names.set(k, k)
    for (const m of members) for (const t of m.tags) if (!names.has(t.toLowerCase())) names.set(t.toLowerCase(), t)
    return [...names.values()]
  }, [registry, members])
  const removeKnownTags = useMemo(
    () => tagsInSelection(members, selectedKeys),
    [members, selectedKeys]
  )

  const filters: Filter[] = ['all', 'verified', 'linked', 'no-key', 'unlinked', 'left-guild']

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* source-status strip — unchanged SourcePill row */}
      <div className="flex items-center gap-2 overflow-hidden border-b border-panel-line bg-panel-sunk px-3 py-2">
        <SourcePill icon={<Swords size={13} />} label="GW2" s={payload?.sources.gw2} unit="members" />
        <SourcePill icon={<MessageSquare size={13} />} label="Discord" s={payload?.sources.discord} unit="members" />
        <SourcePill icon={<img src={axibridgeLogo} alt="" className="h-3.5 w-3.5" />} label="AxiBridge" s={payload?.sources.bridge} unit="tracked" />
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
          siblings={(view === 'table' ? sorted : filtered).map((m) => m.annotationKey)}
          canEdit={canEdit}
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
            {canEdit && (
              <button
                onClick={toggleSelectAll}
                title={allDisplayedSelected ? 'Clear all' : 'Select all'}
                className="flex h-9 items-center gap-1.5 rounded-md border border-panel-line2 px-2.5 text-xs text-ink-dim hover:bg-panel-hover"
              >
                <span
                  className={`grid h-4 w-4 place-items-center rounded border ${
                    someDisplayedSelected ? 'border-accent bg-accent text-white' : 'border-panel-line2'
                  }`}
                >
                  {allDisplayedSelected ? <Check size={11} /> : someDisplayedSelected ? <Minus size={11} /> : null}
                </span>
                Select all
              </button>
            )}
            <div className="relative flex-1 max-w-sm">
              <Search size={15} className="absolute left-2.5 top-2.5 text-ink-faint" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search roster…" className="field pl-8" />
            </div>
            <select
              value={profFilter}
              onChange={(e) => setProfFilter(e.target.value)}
              title="Filter by profession"
              className={`field h-9 w-auto min-w-[120px] py-0 text-sm ${profFilter !== 'all' ? 'border-accent/60 text-accent-soft' : ''}`}
            >
              <option value="all">All professions</option>
              {professions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              value={rankFilter}
              onChange={(e) => setRankFilter(e.target.value)}
              title="Filter by rank"
              className={`field h-9 w-auto min-w-[110px] py-0 text-sm ${rankFilter !== 'all' ? 'border-accent/60 text-accent-soft' : ''}`}
            >
              <option value="all">All ranks</option>
              {ranks.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
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
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
            {loading && members.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-12 text-sm text-ink-faint">
                <RefreshCw size={18} className="animate-spin" />
                Building roster…
              </div>
            ) : !loading && filtered.length === 0 ? (
              <div className="flex flex-1 items-center justify-center px-4 py-12 text-center text-sm text-ink-faint">
                {members.length === 0 ? 'No roster yet — connect GW2 + Discord in Settings.' : 'No members match.'}
              </div>
            ) : view === 'table' ? (
              <MemberTable
                rows={sorted}
                metrics={payload?.metrics ?? {}}
                onSelect={setSelectedKey}
                sort={sort}
                onSort={toggleSort}
                selectable={canEdit}
                selectedKeys={selectedKeys}
                onToggle={toggleRow}
              />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <MemberCards
                  rows={filtered}
                  metrics={payload?.metrics ?? {}}
                  onSelect={setSelectedKey}
                  selectable={canEdit}
                  selectedKeys={selectedKeys}
                  onToggle={toggleRow}
                />
              </div>
            )}
            {canEdit && selectedKeys.size > 0 && (
              <SelectionBar
                count={selectedKeys.size}
                registry={registry}
                addKnownTags={addKnownTags}
                removeKnownTags={removeKnownTags}
                onAdd={applyAdd}
                onRemove={applyRemove}
                onRecolor={recolorTag}
                onClear={clearSelection}
              />
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

// The comparable value for a column. Returns null for missing data so it can
// always be sorted to the bottom regardless of direction.
function sortValue(
  member: ReconciledMember,
  metrics: Record<string, BridgePlayerMetrics>,
  rankOrder: Record<string, number>,
  key: SortKey
): string | number | null {
  const m = aggregateMemberMetrics(member.accounts, metrics)
  switch (key) {
    case 'member':
      return member.label.toLowerCase()
    case 'profession':
      return m?.mainClass?.toLowerCase() ?? null
    case 'rank': {
      if (!member.rank) return null
      const ord = rankOrder[member.rank]
      if (ord !== undefined) return ord
      // No hierarchy at all → alphabetical; partial hierarchy → unknown ranks last.
      return Object.keys(rankOrder).length === 0 ? member.rank.toLowerCase() : null
    }
    case 'attendance':
      return m && m.raidsConsidered > 0 ? m.raidsAttended / m.raidsConsidered : null
    case 'lastSeen': {
      const t = m?.lastSeen ? Date.parse(m.lastSeen) : NaN
      return Number.isNaN(t) ? null : t
    }
  }
}

function compareBy(
  a: ReconciledMember,
  b: ReconciledMember,
  metrics: Record<string, BridgePlayerMetrics>,
  rankOrder: Record<string, number>,
  sort: SortState
): number {
  const va = sortValue(a, metrics, rankOrder, sort.key)
  const vb = sortValue(b, metrics, rankOrder, sort.key)
  // Missing values always sink to the bottom, never flipped by direction.
  if (va === null && vb === null) return 0
  if (va === null) return 1
  if (vb === null) return -1
  const cmp =
    typeof va === 'number' && typeof vb === 'number'
      ? va - vb
      : String(va).localeCompare(String(vb))
  return sort.dir === 'asc' ? cmp : -cmp
}

function StatCard({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div className="stat-card">
      <div className="text-xs font-medium text-ink-faint">{k}</div>
      <div className="mt-1 font-mono text-2xl font-bold text-ink">{v}</div>
    </div>
  )
}

const SORT_COLUMNS: { key: SortKey; label: string; alignEnd?: boolean }[] = [
  { key: 'member', label: 'Member' },
  { key: 'profession', label: 'Profession' },
  { key: 'rank', label: 'Rank' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'lastSeen', label: 'Last seen', alignEnd: true }
]

function MemberTable({
  rows,
  metrics,
  onSelect,
  sort,
  onSort,
  selectable,
  selectedKeys,
  onToggle
}: {
  rows: ReconciledMember[]
  metrics: Record<string, BridgePlayerMetrics>
  onSelect: (k: string) => void
  sort: SortState | null
  onSort: (k: SortKey) => void
  selectable: boolean
  selectedKeys: Set<string>
  onToggle: (key: string, index: number, shift: boolean) => void
}): JSX.Element {
  const cols = selectable
    ? 'grid-cols-[20px_16px_1.6fr_1fr_120px_1fr_90px]'
    : 'grid-cols-[16px_1.6fr_1fr_120px_1fr_90px]'
  return (
    <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className={`relative z-10 grid shrink-0 ${cols} gap-3 border-b border-panel-line px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint shadow-[0_6px_12px_-6px_rgba(0,0,0,.5)]`}
      >
        {selectable && <div></div>}
        <div></div>
        {SORT_COLUMNS.map((c) => {
          const active = sort?.key === c.key
          return (
            <button
              key={c.key}
              onClick={() => onSort(c.key)}
              title={`Sort by ${c.label.toLowerCase()}`}
              className={`flex items-center gap-1 uppercase tracking-wider transition hover:text-ink ${
                c.alignEnd ? 'justify-end' : ''
              } ${active ? 'text-ink' : ''}`}
            >
              {c.label}
              {active && (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
            </button>
          )
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((m, index) => {
          const d = deriveRow(m, metrics)
          const meta = STATUS_META[m.status]
          const checked = selectedKeys.has(m.annotationKey)
          return (
            <div
              key={m.annotationKey}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(m.annotationKey)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(m.annotationKey)
                }
              }}
              className={`grid w-full ${cols} cursor-pointer items-center gap-3 border-b border-panel-line/60 px-4 py-2.5 text-left transition last:border-0 hover:bg-panel-hover ${
                checked ? 'bg-accent/10' : ''
              }`}
            >
              {selectable && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggle(m.annotationKey, index, e.shiftKey)
                  }}
                  title="Select"
                  className={`grid h-4 w-4 place-items-center rounded border ${
                    checked ? 'border-accent bg-accent text-white' : 'border-panel-line2 hover:border-ink-faint'
                  }`}
                >
                  {checked && <Check size={11} />}
                </button>
              )}
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
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MemberCards({
  rows,
  metrics,
  onSelect,
  selectable,
  selectedKeys,
  onToggle
}: {
  rows: ReconciledMember[]
  metrics: Record<string, BridgePlayerMetrics>
  onSelect: (k: string) => void
  selectable: boolean
  selectedKeys: Set<string>
  onToggle: (key: string, index: number, shift: boolean) => void
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
      {rows.map((m, index) => {
        const d = deriveRow(m, metrics)
        const meta = STATUS_META[m.status]
        const checked = selectedKeys.has(m.annotationKey)
        return (
          <div
            key={m.annotationKey}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(m.annotationKey)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(m.annotationKey)
              }
            }}
            className={`relative card cursor-pointer p-4 text-left transition hover:border-panel-line2 hover:bg-panel-hover ${
              checked ? 'border-accent/60 bg-accent/10' : ''
            }`}
          >
            {selectable && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle(m.annotationKey, index, e.shiftKey)
                }}
                title="Select"
                className={`absolute right-2 top-2 grid h-4 w-4 place-items-center rounded border ${
                  checked ? 'border-accent bg-accent text-white' : 'border-panel-line2 hover:border-ink-faint'
                }`}
              >
                {checked && <Check size={11} />}
              </button>
            )}
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-panel-line2 bg-panel-raised">
                {d.mainClass ? <ClassIcon name={d.mainClass} size={20} /> : <span className="led" style={{ background: meta.color }} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{m.label}</div>
                <div className="truncate text-xs text-ink-faint">{d.mainClass ?? d.account}</div>
              </div>
              {m.rank ? <span className="chip shrink-0">{m.rank}</span> : null}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="text-ink-faint">Attendance</span>
              <span className="font-mono text-ink-dim">{d.attendance !== null ? `${d.attendance}%` : '—'}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-line2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${d.attendance ?? 0}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-ink-faint">
                <span className="led" style={{ background: meta.color }} /> {meta.label}
              </span>
              <span className="font-mono text-ink-faint">{d.lastSeen}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
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
