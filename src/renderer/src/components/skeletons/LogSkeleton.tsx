import type { CSSProperties } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import Bar, { widthAt } from './Bar'

const ROWS = 8
const BODY_W = [220, 168, 260, 140, 196, 232, 154, 184] as const

export default function LogSkeleton(): JSX.Element {
  return (
    <div className="ar-pane" aria-busy="true" aria-label="Loading log…">
      <div className="ar-pane__head" style={{ '--ar-head-gap': '18px' } as CSSProperties}>
        <span className="axi-legend__key"><Bar w={88} /></span>
        <span className="axi-legend__key"><Bar w={96} /></span>
        <span className="ar-note--faint ml-auto"><Bar w={110} /></span>
      </div>
      <div className="ar-pane__head">
        <div className="flex gap-1">
          <button disabled aria-pressed className="axi-pill">All</button>
          <button disabled aria-pressed={false} className="axi-pill">GW2</button>
          <button disabled aria-pressed={false} className="axi-pill">Discord</button>
        </div>
        <div className="axi-search flex-1">
          <Search size={14} className="axi-search__icon" />
          <input disabled placeholder="Search name or action…" className="axi-input" />
        </div>
        <button disabled className="axi-btn"><RefreshCw size={14} /> Refresh</button>
      </div>
      <div className="ar-log pointer-events-none">
        <div className="ar-log__day"><Bar w={64} /></div>
        {Array.from({ length: ROWS }, (_, i) => (
          <div key={i} className="ar-log__row">
            <span className="ar-num w-16 flex-none"><Bar w={44} /></span>
            <Bar kind="chip" w={48} />
            <span className="flex min-w-0 flex-1"><Bar w={widthAt(BODY_W, i)} /></span>
          </div>
        ))}
      </div>
    </div>
  )
}
