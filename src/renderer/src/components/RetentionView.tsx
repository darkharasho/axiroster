// src/renderer/src/components/RetentionView.tsx
//
// Retention radar: ranks members by churn-risk score computed from per-raid
// attendance time-series (lib/retention). Reuses the Wave-1 SelectionBar + bulkTags
// to bulk-tag at-risk members. Read-only members see no selection controls.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Check, RefreshCw } from 'lucide-react'
import type { ReconciledMember, RosterPayload } from '../../../preload/index.d'
import { client } from '../lib/client'
import { computeRetention, DEFAULT_RETENTION_CONFIG, type RetentionResult, type RetentionTier } from '../lib/retention'
import { addTagToMembers, removeTagFromMembers, tagsInSelection } from '../lib/bulkTags'
import { parseRegistry, setTagColor, type TagRegistry, type TagColorId } from '../lib/tagRegistry'
import SelectionBar from './SelectionBar'
import { toast } from '../lib/toast'
import { toneInk, toneVar, type Tone } from '../lib/status'
import Tooltip from './Tooltip'

// Churn risk is a verdict, so each tier maps onto a status ink by name. "No
// data" is the absence of one and sits on the neutral ramp instead.
const TIER_META: Record<RetentionTier, { label: string; tone: Tone }> = {
  'at-risk': { label: 'At-risk', tone: 'danger' },
  watch: { label: 'Watch', tone: 'warn' },
  healthy: { label: 'Healthy', tone: 'ok' },
  'insufficient-data': { label: 'No data', tone: 'idle' }
}

export default function RetentionView(): JSX.Element {
  const [payload, setPayload] = useState<RosterPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [registry, setRegistry] = useState<TagRegistry>({})
  const [canEdit, setCanEdit] = useState(true)
  const [filter, setFilter] = useState<'attention' | RetentionTier>('attention')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const res = await client.buildRoster()
    if (res.ok) setPayload(res.data)
    setLoading(false)
    const s = await client.authStatus()
    setCanEdit(s.role !== 'read')
    client.getTagRegistry().then((m) => setRegistry(parseRegistry(JSON.stringify(m))))
  }, [])
  useEffect(() => { load() }, [load])

  const members = useMemo<ReconciledMember[]>(() => payload?.members ?? [], [payload])
  const results = useMemo(() => {
    if (!payload) return [] as RetentionResult[]
    return computeRetention({
      raids: payload.attendance ?? [],
      members: members.map((m) => ({
        annotationKey: m.annotationKey,
        accounts: m.accounts.map((a) => a.account_name),
        tags: m.tags
      })),
      now: Date.now(),
      config: DEFAULT_RETENTION_CONFIG
    })
  }, [payload, members])

  const byKey = useMemo(() => new Map(members.map((m) => [m.annotationKey, m])), [members])
  const counts = useMemo(() => ({
    'at-risk': results.filter((r) => r.tier === 'at-risk').length,
    watch: results.filter((r) => r.tier === 'watch').length,
    healthy: results.filter((r) => r.tier === 'healthy').length
  }), [results])

  // Log a daily snapshot whenever results change.
  useEffect(() => {
    if (results.length === 0) return
    const date = new Date().toISOString().slice(0, 10)
    client.logRetention(
      results.filter((r) => r.tier !== 'insufficient-data').map((r) => ({ date, memberKey: r.memberKey, score: r.score, tier: r.tier }))
    )
  }, [results])

  const shown = results.filter((r) =>
    filter === 'attention' ? r.tier === 'at-risk' || r.tier === 'watch' : r.tier === filter
  )

  const toggle = (key: string): void =>
    setSelectedKeys((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })
  const clearSel = (): void => setSelectedKeys(new Set())

  const applyAdd = async (name: string): Promise<void> => {
    const diffs = addTagToMembers(members, selectedKeys, name)
    await Promise.all(diffs.map((d) => client.upsertAnnotation(d.key, { tags: d.nextTags }).catch(() => {})))
    toast(`Tagged ${diffs.length} member${diffs.length === 1 ? '' : 's'}`)
    await load()
  }
  const applyRemove = async (name: string): Promise<void> => {
    const diffs = removeTagFromMembers(members, selectedKeys, name)
    await Promise.all(diffs.map((d) => client.upsertAnnotation(d.key, { tags: d.nextTags }).catch(() => {})))
    toast(`Removed from ${diffs.length} member${diffs.length === 1 ? '' : 's'}`)
    await load()
  }
  const recolor = async (name: string, id: TagColorId): Promise<void> => {
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
  const removeKnownTags = useMemo(() => tagsInSelection(members, selectedKeys), [members, selectedKeys])

  const retentionOn = (payload?.attendance?.length ?? 0) > 0 || results.some((r) => r.tier !== 'insufficient-data')

  return (
    <div className="ar-pane">
      <div className="ar-pane__head">
        <Activity className="ar-ink-accent" size={15} />
        <span className="ar-title">Retention</span>
        <span className="ar-note--faint">
          {payload?.attendance?.length ?? 0} raids · {DEFAULT_RETENTION_CONFIG.recentWindowDays}-day window
        </span>
        <Tooltip text="Refresh" className="ml-auto inline-flex">
          <button onClick={load} className="ar-icon-btn">
            <RefreshCw size={14} className={loading ? 'ar-work' : ''} />
          </button>
        </Tooltip>
      </div>

      {!retentionOn ? (
        <div className="ar-note--faint flex flex-1 items-center justify-center px-6 py-16 text-center">
          No attendance data yet — check this guild&apos;s AxiBridge report repo, or that it&apos;s publishing reports/attendance.json.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 pb-6">
          {/* These three tiles are the one case where a figure takes an ink:
              the number *is* the count of a status (rule 5). */}
          <div className="grid grid-cols-3 gap-3">
            <Stat n={counts['at-risk']} label="At-risk" tier="at-risk" />
            <Stat n={counts.watch} label="Watch" tier="watch" />
            <Stat n={counts.healthy} label="Healthy" tier="healthy" />
          </div>
          <div className="flex flex-wrap gap-2">
            {(['attention', 'at-risk', 'watch', 'healthy'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className="axi-pill ar-sm"
                style={
                  f === 'attention'
                    ? undefined
                    : ({ '--axi-pill-fill': toneVar(TIER_META[f].tone) } as React.CSSProperties)
                }
              >
                {f === 'attention' ? 'Needs attention' : TIER_META[f].label}
              </button>
            ))}
          </div>
          {/* Rule 8: twenty rows whose whole point is the run down the score
              column, so this is the table kind — rules between the rows, the
              panel around them carrying the block, and a real <table> so the
              chips in one row line up with the chips in the next. The old
              flex rows put every column where the row before it happened to
              end. */}
          <div className="ar-list ar-list--read">
            <div className="ar-list__rows">
            {shown.length === 0 ? (
              <div className="ar-note--faint px-4 py-10 text-center">Nobody in this bucket.</div>
            ) : (
            <table className="axi-table">
              <colgroup>
                {canEdit && <col style={{ width: 36 }} />}
                <col />
                <col style={{ width: 58 }} />
                <col style={{ width: 96 }} />
                <col style={{ width: 96 }} />
                <col style={{ width: '34%' }} />
                <col style={{ width: 88 }} />
              </colgroup>
              <thead>
                <tr>
                  {canEdit && <th />}
                  <th>Member</th>
                  <th>Risk</th>
                  <th>Tier</th>
                  <th>Recent</th>
                  <th>Why</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const m = byKey.get(r.memberKey)
                  if (!m) return null
                  const meta = TIER_META[r.tier]
                  const checked = selectedKeys.has(r.memberKey)
                  return (
                    <tr key={r.memberKey} className={checked ? 'ar-row--on' : undefined}>
                      {canEdit && (
                        <td>
                          <button
                            onClick={() => toggle(r.memberKey)}
                            title="Select"
                            className={`ar-check${checked ? ' ar-check--on' : ''}`}
                          >
                            {checked && <Check size={11} />}
                          </button>
                        </td>
                      )}
                      <td>
                        <div className="ar-row__name">{m.label}</div>
                        <div className="ar-row__sub">{m.accounts[0]?.account_name ?? '—'}</div>
                      </td>
                      {/* The chip beside it already delivers the verdict, so the
                          score is only the measured number (.axi-table__num).
                          Toning it as well painted every at-risk row red twice
                          over, and twenty rows of that is a red screen with a
                          number in it rather than a column you can read down. */}
                      <td className="axi-table__num">
                        {r.tier === 'insufficient-data' ? '–' : r.score}
                      </td>
                      <td>
                        <span
                          className={`axi-chip${meta.tone === 'idle' ? '' : ` axi-chip--${meta.tone}`}`}
                        >
                          {meta.label}
                        </span>
                      </td>
                      {/* Attended or missed is a run of facts, not a run of
                          quantities — one mark per raid, the ink saying which
                          (rule 9's corollary, .axi-ticks). It used to be bars
                          stubbed to 28% for a miss, which drew "didn't show"
                          as a small amount of showing up. */}
                      <td>
                        <span className="axi-ticks" title="Recent raids — filled = attended">
                          {[...r.timeline].reverse().map((a, i) => (
                            <span
                              key={i}
                              className={`axi-ticks__tick${a ? ' axi-ticks__tick--on' : ''}`}
                            />
                          ))}
                        </span>
                      </td>
                      {/* Why the score reads the way it does: commentary about
                          the member, so the outlined meta chip (rules 5/6). */}
                      <td title={r.reasons.join(' · ')}>
                        <span className="inline-flex items-center gap-1.5">
                          {r.reasons.map((rsn, i) => (
                            <span key={i} className="axi-chip axi-chip--meta ar-sm">
                              {rsn}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="axi-table__num">
                        {r.signals.daysSinceLast !== null ? `${r.signals.daysSinceLast}d` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            )}
            </div>
          </div>
          {canEdit && selectedKeys.size > 0 && (
            <SelectionBar count={selectedKeys.size} registry={registry}
              addKnownTags={addKnownTags} removeKnownTags={removeKnownTags}
              onAdd={applyAdd} onRemove={applyRemove} onRecolor={recolor} onClear={clearSel} />
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ n, label, tier }: { n: number; label: string; tier: RetentionTier }): JSX.Element {
  return (
    <div className={`axi-stat ar-md ar-raised axi-stat--${TIER_META[tier].tone}`}>
      <span className="axi-stat__n">{n}</span>
      <span className="axi-stat__k">{label}</span>
    </div>
  )
}
