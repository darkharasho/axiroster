import { MessageSquare, RefreshCw, Search, Swords } from 'lucide-react'
import axibridgeLogo from '../../assets/axibridge-logo.svg'
import { toneDiamond } from '../../lib/status'
import Picker from '../Picker'
import Bar, { widthAt } from './Bar'

const ROWS = 8
const NAME_W = [118, 86, 134, 64, 102, 92, 126, 74] as const
const SUB_W = [84, 70, 96, 58, 88, 76, 92, 66] as const
const CLASS_W = [72, 60, 84, 66, 78, 54, 70, 62] as const
const STATS = ['Members', 'Linked', 'Tracked (AxiBridge)', 'Avg attendance'] as const
const COLUMNS = ['Member', 'Profession', 'Rank', 'Joined', 'Attendance', 'Last seen'] as const
const noop = (): void => {}

// RosterView's own wrappers and headers with the data replaced by bars, so
// the real view lands in place with nothing moving.
// Skeletons assume an editor (the common case): the select column and
// "Select all" are drawn. `attendance` adds the time-window strip block.
export default function RosterSkeleton({ attendance = false }: { attendance?: boolean }): JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true" aria-label="Loading roster…">
      <div className="ar-pane__head">
        <SourceChip icon={<Swords size={13} />} label="GW2" />
        <SourceChip icon={<MessageSquare size={13} />} label="Discord" />
        <SourceChip icon={<img src={axibridgeLogo} alt="" className="h-3.5 w-3.5" />} label="AxiBridge" />
        <div className="ar-note--faint ml-auto shrink-0"><Bar w={72} /></div>
      </div>

      {attendance && (
        <div className="px-4 pt-4">
          <div className="flex flex-wrap items-center gap-2.5" data-testid="time-window-skeleton">
            <span className="axi-eyebrow" style={{ margin: 0 }}>Time window</span>
            <div className="flex gap-1">
              {['All time', 'Last 30 days', 'Last 90 days'].map((l, i) => (
                <button key={l} disabled aria-pressed={i === 0} className="axi-pill">{l}</button>
              ))}
            </div>
            <Picker value="" onChange={noop} disabled className="min-w-[140px]" options={[{ value: '', label: 'Pick a month…' }]} />
            <span className="axi-stat__k ml-auto"><Bar w={96} /></span>
          </div>
        </div>
      )}

      <div className={`grid grid-cols-4 gap-3 px-4 ${attendance ? 'pt-3' : 'pt-4'}`}>
        {STATS.map((k) => (
          <div key={k} className="axi-stat ar-md ar-raised">
            <span className="axi-stat__n"><Bar kind="figure" w={56} /></span>
            <span className="axi-stat__k">{k}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 px-4 py-3">
        <button disabled className="axi-btn ar-sm">
          <span className="ar-check" />
          Select all
        </button>
        <div className="axi-search ar-sm max-w-sm flex-1">
          <Search size={15} className="axi-search__icon" />
          <input disabled placeholder="Search roster…" className="axi-input ar-sm" />
        </div>
        <Picker value="all" onChange={noop} disabled sm className="min-w-[130px]" options={[{ value: 'all', label: 'All professions' }]} />
        <Picker value="all" onChange={noop} disabled sm className="min-w-[120px]" options={[{ value: 'all', label: 'All ranks' }]} />
        <div className="flex gap-1">
          <button disabled aria-pressed className="axi-pill ar-sm">Table</button>
          <button disabled aria-pressed={false} className="axi-pill ar-sm">Cards</button>
        </div>
        <button disabled className="ar-icon-btn" aria-label="Refresh"><RefreshCw size={15} /></button>
      </div>

      <div className="flex flex-wrap gap-2 px-4 pb-4">
        <button disabled aria-pressed className="axi-pill ar-sm">All <span className="ar-num"><Bar w={14} /></span></button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-6">
        <div className="ar-list pointer-events-none">
          <div className="ar-list__rows">
            <table className="axi-table axi-table--sticky">
              <colgroup>
                <col style={{ width: 36 }} />
                <col style={{ width: 26 }} />
                <col />
                <col style={{ width: '17%' }} />
                <col style={{ width: 124 }} />
                <col style={{ width: 112 }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: 96 }} />
              </colgroup>
              <thead>
                <tr>
                  <th />
                  <th />
                  {COLUMNS.map((c) => (
                    <th key={c}><span className="ar-th">{c}</span></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: ROWS }, (_, i) => (
                  <tr key={i}>
                    <td><span className="ar-check" /></td>
                    <td><Bar kind="tile" /></td>
                    <td>
                      <div className="ar-row__name"><Bar w={widthAt(NAME_W, i)} /></div>
                      <div className="ar-row__sub"><Bar w={widthAt(SUB_W, i)} /></div>
                    </td>
                    <td><span className="ar-row__sub"><Bar w={widthAt(CLASS_W, i)} /></span></td>
                    <td><Bar kind="chip" w={64} /></td>
                    <td><span className="ar-num"><Bar w={70} /></span></td>
                    <td><span className="ar-num"><Bar w={40} /></span></td>
                    <td className="axi-table__num"><Bar w={22} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function SourceChip({ icon, label }: { icon: JSX.Element; label: string }): JSX.Element {
  return (
    <span className="axi-chip min-w-0 max-w-[16rem] flex-nowrap whitespace-nowrap">
      <span className={toneDiamond('idle')} />
      <span className="shrink-0">{icon}</span>
      <span className="shrink-0 ar-ink">{label}</span>
      <Bar w={56} />
    </span>
  )
}
