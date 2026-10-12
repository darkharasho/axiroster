import type { CSSProperties } from 'react'
import { RefreshCw, Users2 } from 'lucide-react'
import { DEFAULT_STAGES, stageSeries } from '../../lib/pipeline'
import Bar, { widthAt } from './Bar'

const CARDS = [3, 2, 2, 1, 1] as const
const NAME_W = [104, 86, 120, 72, 96, 110, 80, 92, 64] as const

export default function RecruitmentSkeleton(): JSX.Element {
  let n = 0
  return (
    <div className="ar-pane" aria-busy="true" aria-label="Loading recruitment…">
      <div className="ar-pane__head">
        <Users2 className="ar-ink-accent" size={15} />
        <span className="ar-title">Recruitment</span>
        <span className="ar-note--faint"><Bar w={80} /></span>
        <button disabled className="ar-icon-btn ml-auto" aria-label="Refresh"><RefreshCw size={14} /></button>
      </div>
      <div className="ar-pane__body overflow-x-auto pointer-events-none">
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${DEFAULT_STAGES.length}, minmax(200px, 1fr))` }}>
          {DEFAULT_STAGES.map((stage, col) => (
            <div key={stage.id} className="ar-col">
              <div className="ar-col__head">
                <span
                  className="axi-diamond axi-diamond--series"
                  style={{ '--axi-series': stageSeries(stage.color) } as CSSProperties}
                />
                <span>{stage.label}</span>
                <span className="ml-auto"><Bar kind="chip" w={26} /></span>
              </div>
              {Array.from({ length: CARDS[col] ?? 1 }, () => {
                const i = n++
                return (
                  <div key={i} className="ar-card">
                    <div className="ar-card__name"><Bar w={widthAt(NAME_W, i)} /></div>
                    <div className="ar-row__sub"><Bar w={72} /></div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
