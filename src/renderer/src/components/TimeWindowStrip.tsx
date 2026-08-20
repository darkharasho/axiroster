// src/renderer/src/components/TimeWindowStrip.tsx
//
// Time-window filter strip for attendance (Roster + Member Detail). Mirrors
// AxiBridge's rollup strip: preset pills · month picker · raid count.
import { availableMonths, monthLabel, windowFromMonthValue, type TimeWindow } from '../lib/attendanceWindow'

const PRESETS: { label: string; window: TimeWindow }[] = [
  { label: 'All time', window: { kind: 'all' } },
  { label: 'Last 30 days', window: { kind: 'days', days: 30 } },
  { label: 'Last 90 days', window: { kind: 'days', days: 90 } }
]

export default function TimeWindowStrip({
  window: win,
  onChange,
  raids,
  raidCount
}: {
  window: TimeWindow
  onChange: (w: TimeWindow) => void
  /** Full (unwindowed) series — used to list the months that have raids. */
  raids: { date: string }[]
  /** Raids inside the current window. */
  raidCount: number
}): JSX.Element {
  const months = availableMonths(raids)
  const monthValue = win.kind === 'month' ? `${win.year}-${win.month}` : ''
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        Time window
      </span>
      <div className="seg">
        {PRESETS.map((p) => {
          const on =
            (p.window.kind === 'all' && win.kind === 'all') ||
            (p.window.kind === 'days' && win.kind === 'days' && win.days === p.window.days)
          return (
            <button
              key={p.label}
              onClick={() => onChange(p.window)}
              className={`seg-item ${on ? 'seg-item-on' : ''}`}
            >
              {p.label}
            </button>
          )
        })}
      </div>
      <select
        value={monthValue}
        onChange={(e) => onChange(windowFromMonthValue(e.target.value))}
        title="Show a single month"
        className={`field h-8 w-auto min-w-[130px] py-0 text-xs ${
          win.kind === 'month' ? 'border-accent/60 text-accent-soft' : ''
        }`}
      >
        <option value="">Pick a month…</option>
        {months.map(({ year, month }) => (
          <option key={`${year}-${month}`} value={`${year}-${month}`}>
            {monthLabel(year, month)}
          </option>
        ))}
      </select>
      <span className="ml-auto text-xs text-ink-faint">
        <span className="font-semibold text-ink-dim">
          {raidCount} raid{raidCount === 1 ? '' : 's'}
        </span>{' '}
        in window
      </span>
    </div>
  )
}
