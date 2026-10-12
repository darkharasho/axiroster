import { Activity, RefreshCw } from 'lucide-react'
import Bar, { widthAt } from './Bar'

const ROWS = 8
const NAME_W = [112, 84, 128, 70, 98, 90, 120, 76] as const
const WHY_W = [180, 140, 210, 120, 160, 196, 132, 170] as const
const TIERS = [
  ['At-risk', 'danger'],
  ['Watch', 'warn'],
  ['Healthy', 'ok']
] as const

export default function RetentionSkeleton(): JSX.Element {
  return (
    <div className="ar-pane" aria-busy="true" aria-label="Loading retention…">
      <div className="ar-pane__head">
        <Activity className="ar-ink-accent" size={15} />
        <span className="ar-title">Retention</span>
        <span className="ar-note--faint"><Bar w={120} /></span>
        <button disabled className="ar-icon-btn ml-auto" aria-label="Refresh"><RefreshCw size={14} /></button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 pb-6">
        <div className="grid grid-cols-3 gap-3">
          {TIERS.map(([label, tone]) => (
            <div key={label} className={`axi-stat ar-md ar-raised axi-stat--${tone}`}>
              <span className="axi-stat__n"><Bar kind="figure" w={36} /></span>
              <span className="axi-stat__k">{label}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled aria-pressed className="axi-pill ar-sm">Needs attention</button>
        </div>
        <div className="ar-list ar-list--read pointer-events-none">
          <div className="ar-list__rows">
            <table className="axi-table axi-table--sticky">
              <colgroup>
                <col />
                <col style={{ width: 58 }} />
                <col style={{ width: 96 }} />
                <col style={{ width: 96 }} />
                <col style={{ width: '34%' }} />
                <col style={{ width: 88 }} />
              </colgroup>
              <thead>
                <tr><th>Member</th><th>Risk</th><th>Tier</th><th>Recent</th><th>Why</th><th>Last seen</th></tr>
              </thead>
              <tbody>
                {Array.from({ length: ROWS }, (_, i) => (
                  <tr key={i}>
                    <td>
                      <div className="ar-row__name"><Bar w={widthAt(NAME_W, i)} /></div>
                      <div className="ar-row__sub"><Bar w={72} /></div>
                    </td>
                    <td className="axi-table__num"><Bar w={24} /></td>
                    <td><Bar kind="chip" w={60} /></td>
                    <td><Bar w={48} /></td>
                    <td><Bar w={widthAt(WHY_W, i)} /></td>
                    <td className="axi-table__num"><Bar w={40} /></td>
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
