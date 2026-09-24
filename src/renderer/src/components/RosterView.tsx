import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject
} from 'react'
import Picker from './Picker'
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
import { STATUS_META, fmtRelative, toneDiamond, toneVar, type Tone } from '../lib/status'
import { aggregateMemberMetrics } from '../lib/metrics'
import ClassIcon from './ClassIcon'
import MemberDetail from './MemberDetail'
import axibridgeLogo from '../assets/axibridge-logo.svg'
import { addTagToMembers, removeTagFromMembers, tagsInSelection } from '../lib/bulkTags'
import { parseRegistry, setTagColor, type TagRegistry, type TagColorId } from '../lib/tagRegistry'
import { client } from '../lib/client'
import SelectionBar from './SelectionBar'
import { toast } from '../lib/toast'
import TimeWindowStrip from './TimeWindowStrip'
import {
  filterRaids,
  memberAttendance,
  type TimeWindow,
  type WindowedAttendance
} from '../lib/attendanceWindow'
import Tooltip from './Tooltip'

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
  // Attendance time window — shared by the table, stat card, and MemberDetail.
  const [timeWindow, setTimeWindow] = useState<TimeWindow>({ kind: 'all' })
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

  // Opening a member unmounts the list, so its scroll position dies with the
  // DOM node. Save it on open and restore it when the list remounts on back.
  const listScrollRef = useRef<HTMLDivElement | null>(null)
  // Discrete changes that justify re-animating the list (not free-text search).
  const listKey = `${view}|${filter}|${JSON.stringify(timeWindow)}`
  const savedScroll = useRef(0)

  // Nav actions (re-clicking the guild or Roster tab, or switching guilds) bump
  // resetToken to drop out of the member detail back to the list (at the top).
  useEffect(() => {
    savedScroll.current = 0
    setSelectedKey(null)
  }, [resetToken])
  const openMember = useCallback((key: string) => {
    savedScroll.current = listScrollRef.current?.scrollTop ?? 0
    setSelectedKey(key)
  }, [])
  useLayoutEffect(() => {
    if (selectedKey === null && listScrollRef.current)
      listScrollRef.current.scrollTop = savedScroll.current
  }, [selectedKey])

  const members = payload?.members ?? []
  const selected = members.find((m) => m.annotationKey === selectedKey) ?? null

  const attendanceSeries = payload?.attendance ?? []
  const hasAttendance = attendanceSeries.length > 0
  const windowedRaids = useMemo(
    () => filterRaids(attendanceSeries, timeWindow, Date.now()),
    // payload identity covers attendanceSeries (fresh [] each render when null)
    [payload, timeWindow] // eslint-disable-line react-hooks/exhaustive-deps
  )
  // Per-member windowed attendance; null when the guild publishes no series —
  // deriveRow/sortValue then fall back to the rollup numbers.
  const windowed = useMemo(() => {
    if (!hasAttendance) return null
    const map = new Map<string, WindowedAttendance>()
    for (const m of members)
      map.set(
        m.annotationKey,
        memberAttendance(
          windowedRaids,
          m.accounts.map((a) => a.account_name)
        )
      )
    return map
  }, [hasAttendance, windowedRaids, payload]) // eslint-disable-line react-hooks/exhaustive-deps

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
      .map((m) => deriveRow(m, payload?.metrics ?? {}, windowed).attendance)
      .filter((a): a is number => a !== null)
    const avgAtt = atts.length ? Math.round(atts.reduce((s, a) => s + a, 0) / atts.length) : null
    return { total: members.length, linked, tracked, avgAtt }
  }, [members, payload, windowed])

  // Table-only sort applied on top of the filtered list. Array.sort is stable,
  // so equal rows keep their filtered order; missing values sink to the bottom.
  const sorted = useMemo(() => {
    if (!sort) return filtered
    const metrics = payload?.metrics ?? {}
    const rankOrder = payload?.rankOrder ?? {}
    return [...filtered].sort((a, b) => compareBy(a, b, metrics, rankOrder, windowed, sort))
  }, [filtered, sort, payload, windowed])

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
      <div className="ar-pane__head">
        <SourcePill icon={<Swords size={13} />} label="GW2" s={payload?.sources.gw2} unit="members" />
        <SourcePill icon={<MessageSquare size={13} />} label="Discord" s={payload?.sources.discord} unit="members" />
        <SourcePill icon={<img src={axibridgeLogo} alt="" className="h-3.5 w-3.5" />} label="AxiBridge" s={payload?.sources.bridge} unit="tracked" />
        <div className="ar-note--faint ml-auto shrink-0">{members.length} in roster</div>
      </div>

      {selected ? (
        <div key={selected.annotationKey} className="pane-enter flex min-h-0 flex-1 flex-col">
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
          attendanceSeries={attendanceSeries}
          timeWindow={timeWindow}
          onTimeWindowChange={setTimeWindow}
        />
        </div>
      ) : (
        <div key="__roster-list__" className="pane-enter flex min-h-0 flex-1 flex-col">
          {/* error + warnings */}
          {error && (
            <div className="ar-banner ar-banner--danger">
              <AlertTriangle size={15} /> {error}
            </div>
          )}
          {payload?.warnings.map((w) => (
            <div key={w} className="ar-banner ar-banner--warn">
              <AlertTriangle size={13} /> {w}
            </div>
          ))}

          {/* attendance time window */}
          {hasAttendance && (
            <div className="px-4 pt-4">
              <TimeWindowStrip
                window={timeWindow}
                onChange={setTimeWindow}
                raids={attendanceSeries}
                raidCount={windowedRaids.length}
              />
            </div>
          )}

          {/* stat cards */}
          <div className={`grid grid-cols-4 gap-3 px-4 ${hasAttendance ? 'pt-3' : 'pt-4'}`}>
            <StatCard k="Members" v={String(stats.total)} />
            <StatCard k="Linked" v={`${stats.linked} / ${stats.total}`} />
            <StatCard k="Tracked (AxiBridge)" v={String(stats.tracked)} />
            <StatCard
              k="Avg attendance"
              v={stats.avgAtt !== null ? `${stats.avgAtt}%` : '—'}
              sub={
                hasAttendance
                  ? `${windowedRaids.length} raid${windowedRaids.length === 1 ? '' : 's'}`
                  : undefined
              }
            />
          </div>

          {/* controls */}
          <div className="flex items-center gap-2 px-4 py-3">
            {canEdit && (
              <button
                onClick={toggleSelectAll}
                title={allDisplayedSelected ? 'Clear all' : 'Select all'}
                className="axi-btn ar-sm"
              >
                <span
                  className={`ar-check${
                    allDisplayedSelected ? ' ar-check--on' : someDisplayedSelected ? ' ar-check--some' : ''
                  }`}
                >
                  {allDisplayedSelected ? <Check size={11} /> : someDisplayedSelected ? <Minus size={11} /> : null}
                </span>
                Select all
              </button>
            )}
            <div className="axi-search ar-sm max-w-sm flex-1">
              <Search size={15} className="axi-search__icon" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search roster…"
                className="axi-input ar-sm"
              />
            </div>
            <Picker
              value={profFilter}
              onChange={setProfFilter}
              title="Filter by profession"
              sm
              className="min-w-[130px]"
              options={[
                { value: 'all', label: 'All professions' },
                ...professions.map((p) => ({ value: p, label: p }))
              ]}
            />
            <Picker
              value={rankFilter}
              onChange={setRankFilter}
              title="Filter by rank"
              sm
              className="min-w-[120px]"
              options={[
                { value: 'all', label: 'All ranks' },
                ...ranks.map((r) => ({ value: r, label: r }))
              ]}
            />
            {/* Two pills rather than a segmented control: "which of these is on"
                is what a pressed pill already says, and it needs no third form. */}
            <div className="flex gap-1">
              <button
                onClick={() => setView('table')}
                aria-pressed={view === 'table'}
                className="axi-pill ar-sm"
              >
                Table
              </button>
              <button
                onClick={() => setView('cards')}
                aria-pressed={view === 'cards'}
                className="axi-pill ar-sm"
              >
                Cards
              </button>
            </div>
            <Tooltip text="Refresh">
              <button onClick={load} className="ar-icon-btn">
                <RefreshCw size={15} className={loading ? 'ar-work' : ''} />
              </button>
            </Tooltip>
          </div>

          {/* filter pills */}
          {/* A pressed pill fills with the status it filters to, so the control
              reads as the thing it selects rather than as a generic "on" — that
              is what --axi-pill-fill is for. */}
          <div className="flex flex-wrap gap-2 px-4 pb-4">
            {filters.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className="axi-pill ar-sm"
                style={
                  f === 'all'
                    ? undefined
                    : ({ '--axi-pill-fill': toneVar(STATUS_META[f].tone) } as React.CSSProperties)
                }
              >
                {f === 'all' ? 'All' : STATUS_META[f].label}
                <span className="ar-num">{counts[f] ?? 0}</span>
              </button>
            ))}
          </div>

          {/* table / cards */}
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-6">
            {loading && members.length === 0 ? (
              <div className="ar-note--faint flex flex-1 flex-col items-center justify-center gap-3 px-4 py-12">
                <RefreshCw size={18} className="ar-work" />
                Building roster…
              </div>
            ) : !loading && filtered.length === 0 ? (
              <div className="ar-note--faint flex flex-1 items-center justify-center px-4 py-12 text-center">
                {members.length === 0 ? 'No roster yet — connect GW2 + Discord in Settings.' : 'No members match.'}
              </div>
            ) : view === 'table' ? (
              <div key={listKey} className="list-enter flex min-h-0 flex-1 flex-col">
              <MemberTable
                rows={sorted}
                metrics={payload?.metrics ?? {}}
                windowed={windowed}
                onSelect={openMember}
                scrollRef={listScrollRef}
                sort={sort}
                onSort={toggleSort}
                selectable={canEdit}
                selectedKeys={selectedKeys}
                onToggle={toggleRow}
              />
              </div>
            ) : (
              <div key={listKey} ref={listScrollRef} className="list-enter min-h-0 flex-1 overflow-y-auto">
                <MemberCards
                  rows={filtered}
                  metrics={payload?.metrics ?? {}}
                  windowed={windowed}
                  onSelect={openMember}
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

// Derive the display fields the table/cards need from a member + payload
// metrics. When a windowed-attendance map is present it is the single source
// of truth for attendance; otherwise fall back to the rollup aggregate.
function deriveRow(
  member: ReconciledMember,
  metrics: Record<string, BridgePlayerMetrics>,
  windowed: Map<string, WindowedAttendance> | null
) {
  const m = aggregateMemberMetrics(member.accounts, metrics)
  const w = windowed?.get(member.annotationKey)
  const attendance = windowed
    ? (w?.pct ?? null)
    : m && m.raidsConsidered > 0
      ? Math.round((m.raidsAttended / m.raidsConsidered) * 100)
      : null
  return {
    mainClass: m?.mainClass ?? null,
    attendance,
    attendanceFraction: w && w.pct !== null ? `${w.attended}/${w.total}` : null,
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
  windowed: Map<string, WindowedAttendance> | null,
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
    case 'attendance': {
      if (windowed) {
        const w = windowed.get(member.annotationKey)
        return w && w.pct !== null && w.total > 0 ? w.attended / w.total : null
      }
      return m && m.raidsConsidered > 0 ? m.raidsAttended / m.raidsConsidered : null
    }
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
  windowed: Map<string, WindowedAttendance> | null,
  sort: SortState
): number {
  const va = sortValue(a, metrics, rankOrder, windowed, sort.key)
  const vb = sortValue(b, metrics, rankOrder, windowed, sort.key)
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

// One number and its name, drawn flat on the ground inside its pane: content,
// not something raised off the surface it sits on. The figure stays in the
// plain ink — a tile coloured for emphasis is decoration impersonating status.
function StatCard({ k, v, sub }: { k: string; v: string; sub?: string }): JSX.Element {
  return (
    <div className="axi-stat ar-md ar-raised">
      <span className="axi-stat__n">{v}</span>
      {/* The qualifier rides the key's line instead of taking one of its own:
          a card that runs to three lines sets the height of all four, so one
          caption would cost the whole strip. */}
      <span className="axi-stat__k">{sub ? `${k} · ${sub}` : k}</span>
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
  windowed,
  onSelect,
  sort,
  onSort,
  selectable,
  selectedKeys,
  onToggle,
  scrollRef
}: {
  rows: ReconciledMember[]
  metrics: Record<string, BridgePlayerMetrics>
  windowed: Map<string, WindowedAttendance> | null
  onSelect: (k: string) => void
  sort: SortState | null
  onSort: (k: SortKey) => void
  selectable: boolean
  selectedKeys: Set<string>
  onToggle: (key: string, index: number, shift: boolean) => void
  scrollRef?: MutableRefObject<HTMLDivElement | null>
}): JSX.Element {
  // Rule 8: the eye runs down the attendance column comparing members, so this
  // is the table kind — rules between rows, no outlines and no blocks, with the
  // panel around it carrying the only block. .axi-table draws all of that, and
  // right-aligns the numeric columns without being asked.
  return (
    <div className="ar-list">
      <div ref={scrollRef} className="ar-list__rows">
        <table className="axi-table">
          {/* Fixed layout, so a long account name widens its own cell's
              ellipsis rather than the whole table — the column positions are
              what make the run down a column readable in the first place. */}
          <colgroup>
            {selectable && <col style={{ width: 36 }} />}
            <col style={{ width: 26 }} />
            <col />
            <col style={{ width: '17%' }} />
            <col style={{ width: 124 }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: 96 }} />
          </colgroup>
          <thead>
            <tr>
              {selectable && <th />}
              <th />
              {SORT_COLUMNS.map((c) => {
                const active = sort?.key === c.key
                return (
                  <th key={c.key}>
                    <button
                      onClick={() => onSort(c.key)}
                      title={`Sort by ${c.label.toLowerCase()}`}
                      className={`ar-th${active ? ' ar-th--on' : ''}`}
                    >
                      {c.label}
                      {active &&
                        (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((m, index) => {
              const d = deriveRow(m, metrics, windowed)
              const meta = STATUS_META[m.status]
              const checked = selectedKeys.has(m.annotationKey)
              return (
                <tr
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
                  className={checked ? 'ar-row--on' : undefined}
                >
                  {selectable && (
                    <td>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggle(m.annotationKey, index, e.shiftKey)
                        }}
                        title="Select"
                        className={`ar-check${checked ? ' ar-check--on' : ''}`}
                      >
                        {checked && <Check size={11} />}
                      </button>
                    </td>
                  )}
                  <td>
                    <span className={toneDiamond(meta.tone)} title={meta.label} />
                  </td>
                  <td>
                    <div className="ar-row__name">{m.label}</div>
                    <div className="ar-row__sub">{d.account}</div>
                  </td>
                  <td>
                    <span className="axi-table__who ar-row__sub">
                      {d.mainClass ? <ClassIcon name={d.mainClass} size={16} /> : null}
                      <span className="truncate">{d.mainClass ?? '—'}</span>
                    </span>
                  </td>
                  <td>
                    {m.rank ? (
                      <span className="axi-chip ar-sm">{m.rank}</span>
                    ) : (
                      <span className="ar-num">—</span>
                    )}
                  </td>
                  <td>
                    {/* A proportion is a length, and the fill is one ink at full
                        strength (rule 9) — never a bar faded to mean its own value. */}
                    {d.attendance !== null ? (
                      <>
                        <div className="axi-meter">
                          <span
                            className="axi-meter__fill"
                            style={{ '--axi-meter-v': `${d.attendance}%` } as React.CSSProperties}
                          />
                        </div>
                        <div className="ar-num mt-1">
                          {d.attendance}%
                          {d.attendanceFraction && <span> ({d.attendanceFraction})</span>}
                        </div>
                      </>
                    ) : (
                      <span className="ar-num">—</span>
                    )}
                  </td>
                  <td className="axi-table__num">{d.lastSeen}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MemberCards({
  rows,
  metrics,
  windowed,
  onSelect,
  selectable,
  selectedKeys,
  onToggle
}: {
  rows: ReconciledMember[]
  metrics: Record<string, BridgePlayerMetrics>
  windowed: Map<string, WindowedAttendance> | null
  onSelect: (k: string) => void
  selectable: boolean
  selectedKeys: Set<string>
  onToggle: (key: string, index: number, shift: boolean) => void
}): JSX.Element {
  return (
    <div className="axi-grid" style={{ '--axi-grid-min': '280px' } as React.CSSProperties}>
      {rows.map((m, index) => {
        const d = deriveRow(m, metrics, windowed)
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
            /* The reconciliation status caps the card (rule 5): a short bar
               across the head, over the reading it is a verdict on — never a
               full-height stripe down the edge. */
            className={`axi-card axi-card--strip${checked ? ' ar-card--selected' : ''}`}
            style={{ '--axi-card-strip': toneVar(meta.tone) } as React.CSSProperties}
          >
            {selectable && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle(m.annotationKey, index, e.shiftKey)
                }}
                title="Select"
                className={`ar-check absolute right-2 top-4 z-10${checked ? ' ar-check--on' : ''}`}
              >
                {checked && <Check size={11} />}
              </button>
            )}
            <div className="axi-card__head">
              <span className="axi-card__glyph">
                {d.mainClass ? (
                  <ClassIcon name={d.mainClass} size={20} />
                ) : (
                  (m.label || '?').slice(0, 2).toUpperCase()
                )}
              </span>
              <span className="axi-card__title">
                <span className="axi-card__name">{m.label}</span>
                <span className="axi-card__kind">{d.mainClass ?? d.account}</span>
              </span>
              {m.rank ? <span className="axi-chip">{m.rank}</span> : null}
            </div>
            <div className="flex items-center justify-between">
              <span className="axi-stat__k">Attendance</span>
              <span className="ar-num">{d.attendance !== null ? `${d.attendance}%` : '—'}</span>
            </div>
            <div className="axi-meter" style={{ '--axi-meter-h': '10px' } as React.CSSProperties}>
              <span
                className="axi-meter__fill"
                style={{ '--axi-meter-v': `${d.attendance ?? 0}%` } as React.CSSProperties}
              />
            </div>
            <div className="axi-card__meta">
              <span className="axi-legend__key">
                <span className={toneDiamond(meta.tone)} /> {meta.label}
              </span>
              <span className="ar-num ml-auto">{d.lastSeen}</span>
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
  // neutral = no key · warn = key but needs a guild selected · danger = fetch
  // failed · ok = loaded
  const tone: Tone = !s || !s.hasKey ? 'idle' : s.loaded ? 'ok' : !s.configured ? 'warn' : 'danger'
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
    <span className="axi-chip min-w-0 max-w-[16rem] flex-nowrap whitespace-nowrap" title={full}>
      <span className={toneDiamond(tone)} />
      <span className="shrink-0">{icon}</span>
      <span className="shrink-0 ar-ink">
        {label}
      </span>
      <span className="min-w-0 truncate ar-ink-faint">
        {short}
      </span>
    </span>
  )
}
