// src/renderer/src/components/TimeWindowStrip.tsx
//
// Time-window filter strip for attendance (Roster + Member Detail). Mirrors
// AxiBridge's rollup strip: preset pills · month picker · raid count.
import { availableMonths, monthLabel, windowFromMonthValue, type TimeWindow } from '../lib/attendanceWindow'
import Picker from './Picker'

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
    <div className="flex flex-wrap items-center gap-2.5">
      <span className="axi-eyebrow" style={{ margin: 0 }}>
        Time window
      </span>
      <div className="flex gap-1">
        {PRESETS.map((p) => {
          const on =
            (p.window.kind === 'all' && win.kind === 'all') ||
            (p.window.kind === 'days' && win.kind === 'days' && win.days === p.window.days)
          return (
            <button
              key={p.label}
              onClick={() => onChange(p.window)}
              aria-pressed={on}
              className="axi-pill"
            >
              {p.label}
            </button>
          )
        })}
      </div>
      <Picker
        value={monthValue}
        onChange={(v) => onChange(windowFromMonthValue(v))}
        title="Show a single month"
        className="min-w-[140px]"
        options={[
          { value: '', label: 'Pick a month…' },
          ...months.map(({ year, month }) => ({
            value: `${year}-${month}`,
            label: monthLabel(year, month)
          }))
        ]}
      />
      <span className="axi-stat__k ml-auto">
        {raidCount} raid{raidCount === 1 ? '' : 's'} in window
      </span>
    </div>
  )
}
