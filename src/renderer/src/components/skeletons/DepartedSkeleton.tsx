import { RefreshCw, Search } from 'lucide-react'
import Bar, { widthAt } from './Bar'

const ROWS = 6
const ACCOUNT_W = [104, 82, 120, 70, 96, 88] as const
const DISCORD_W = [76, 92, 64, 84, 58, 72] as const
const REASON_W = [90, 120, 70, 104, 84, 60] as const
const HEAD = ['', '', 'Account', 'Discord', 'Status', 'By', 'When', 'Reason', ''] as const

export default function DepartedSkeleton(): JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true" aria-label="Loading departures…">
      <div className="ar-pane__head">
        <span className="ar-ink">Departed</span>
        <div className="ar-note--faint ml-auto shrink-0"><Bar w={64} /></div>
      </div>
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="axi-search ar-sm max-w-sm flex-1">
          <Search size={15} className="axi-search__icon" />
          <input disabled placeholder="Search account, Discord, actor, reason, note…" className="axi-input ar-sm" />
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
                <col style={{ width: 48 }} />
                <col style={{ width: '18%' }} />
                <col />
                <col style={{ width: 110 }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: 96 }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: 48 }} />
              </colgroup>
              <thead>
                <tr>{HEAD.map((h, i) => <th key={i}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {Array.from({ length: ROWS }, (_, i) => (
                  <tr key={i}>
                    <td />
                    <td><Bar kind="tile" /></td>
                    <td><div className="ar-row__name"><Bar w={widthAt(ACCOUNT_W, i)} /></div></td>
                    <td><div className="ar-row__sub"><Bar w={widthAt(DISCORD_W, i)} /></div></td>
                    <td><Bar kind="chip" w={72} /></td>
                    <td><Bar w={56} /></td>
                    <td><span className="ar-num"><Bar w={64} /></span></td>
                    <td><Bar w={widthAt(REASON_W, i)} /></td>
                    <td />
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
