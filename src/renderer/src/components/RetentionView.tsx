// src/renderer/src/components/RetentionView.tsx
//
// Retention radar: ranks members by churn-risk score computed from per-raid
// attendance time-series (lib/retention). Reuses the Wave-1 SelectionBar + bulkTags
// to bulk-tag at-risk members. Read-only members see no selection controls.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import type { ReconciledMember, RosterPayload } from '../../../preload/index.d'
import { computeRetention, DEFAULT_RETENTION_CONFIG, type RetentionResult, type RetentionTier } from '../lib/retention'
import { addTagToMembers, removeTagFromMembers, tagsInSelection } from '../lib/bulkTags'
import { parseRegistry, setTagColor, type TagRegistry, type TagColorId } from '../lib/tagRegistry'
import SelectionBar from './SelectionBar'
import { toast } from '../lib/toast'

const TIER_META: Record<RetentionTier, { label: string; color: string }> = {
  'at-risk': { label: 'At-risk', color: '#f43f5e' },
  watch: { label: 'Watch', color: '#f59e0b' },
  healthy: { label: 'Healthy', color: '#10b981' },
  'insufficient-data': { label: 'No data', color: '#646a73' }
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
    const res = await window.axiroster.buildRoster()
    if (res.ok) setPayload(res.data)
    setLoading(false)
    const s = await window.axiroster.authStatus()
    setCanEdit(s.role !== 'read')
    window.axiroster.getTagRegistry().then((m) => setRegistry(parseRegistry(JSON.stringify(m))))
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
    window.axiroster.logRetention(
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
    await Promise.all(diffs.map((d) => window.axiroster.upsertAnnotation(d.key, { tags: d.nextTags }).catch(() => {})))
    toast(`Tagged ${diffs.length} member${diffs.length === 1 ? '' : 's'}`)
    await load()
  }
  const applyRemove = async (name: string): Promise<void> => {
    const diffs = removeTagFromMembers(members, selectedKeys, name)
    await Promise.all(diffs.map((d) => window.axiroster.upsertAnnotation(d.key, { tags: d.nextTags }).catch(() => {})))
    toast(`Removed from ${diffs.length} member${diffs.length === 1 ? '' : 's'}`)
    await load()
  }
  const recolor = async (name: string, id: TagColorId): Promise<void> => {
    const next = setTagColor(registry, name, id)
    setRegistry(next)
    await window.axiroster.setTagRegistry(next).catch(() => {})
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-panel-line bg-panel-sunk px-4 py-2.5">
        <Activity size={15} className="text-accent-soft" />
        <span className="text-sm font-semibold text-ink">Retention</span>
        <span className="text-xs text-ink-faint">· {payload?.attendance?.length ?? 0} raids · {DEFAULT_RETENTION_CONFIG.recentWindowDays}-day window</span>
        <button onClick={load} className="btn ml-auto px-2" title="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {!retentionOn ? (
        <div className="flex flex-1 items-center justify-center px-6 py-16 text-center text-sm text-ink-faint">
          No attendance data yet — check this guild&apos;s AxiBridge report repo, or that it&apos;s publishing reports/attendance.json.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
          <div className="mb-3 grid grid-cols-3 gap-3">
            <Stat n={counts['at-risk']} label="At-risk" color="#f43f5e" />
            <Stat n={counts.watch} label="Watch" color="#f59e0b" />
            <Stat n={counts.healthy} label="Healthy" color="#10b981" />
          </div>
          <div className="mb-2 flex gap-1.5">
            {(['attention', 'at-risk', 'watch', 'healthy'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`rounded-full px-2.5 py-0.5 text-xs ${filter === f ? 'bg-accent/15 text-accent-soft' : 'text-ink-dim hover:text-ink'}`}>
                {f === 'attention' ? 'Needs attention' : TIER_META[f].label}
              </button>
            ))}
          </div>
          <div className="card min-h-0 flex-1 overflow-y-auto">
            {shown.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-ink-faint">Nobody in this bucket.</div>
            ) : shown.map((r) => {
              const m = byKey.get(r.memberKey)
              if (!m) return null
              const meta = TIER_META[r.tier]
              const checked = selectedKeys.has(r.memberKey)
              return (
                <div key={r.memberKey}
                  className={`flex items-center gap-3 border-b border-panel-line/60 px-4 py-2.5 last:border-0 ${checked ? 'bg-accent/10' : ''}`}>
                  {canEdit && (
                    <button onClick={() => toggle(r.memberKey)}
                      className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${checked ? 'border-accent bg-accent' : 'border-panel-line2'}`}>
                      {checked && <span className="text-[10px] text-white">✓</span>}
                    </button>
                  )}
                  <div className="w-44 min-w-0">
                    <div className="truncate text-sm font-medium text-ink">{m.label}</div>
                    <div className="truncate text-xs text-ink-faint">{m.accounts[0]?.account_name ?? '—'}</div>
                  </div>
                  <div className="w-10 text-center font-mono text-base font-semibold" style={{ color: meta.color }}>{r.tier === 'insufficient-data' ? '–' : r.score}</div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                    style={{ background: `${meta.color}26`, color: meta.color }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />{meta.label}
                  </span>
                  <div className="ml-1 flex items-end gap-[3px]" title="recent raids (filled = attended)">
                    {[...r.timeline].reverse().map((a, i) => (
                      <span key={i} className="w-[6px] rounded-sm" style={{ height: a ? 16 : 5, background: a ? '#10b981' : '#3a3a40' }} />
                    ))}
                  </div>
                  <div className="ml-2 flex flex-1 flex-wrap gap-1">
                    {r.reasons.map((rsn, i) => (
                      <span key={i} className="rounded border border-panel-line bg-panel-raised px-1.5 py-0.5 text-[10.5px] text-ink-dim">{rsn}</span>
                    ))}
                  </div>
                  <div className="w-12 text-right font-mono text-xs text-ink-dim">
                    {r.signals.daysSinceLast !== null ? `${r.signals.daysSinceLast}d` : '—'}
                  </div>
                </div>
              )
            })}
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

function Stat({ n, label, color }: { n: number; label: string; color: string }): JSX.Element {
  return (
    <div className="stat-card">
      <div className="font-mono text-2xl font-bold" style={{ color }}>{n}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</div>
    </div>
  )
}
