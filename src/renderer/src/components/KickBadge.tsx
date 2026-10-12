// A previously kicked person is back (roster or recruitment): a danger chip,
// with who/when/why in the portaled tooltip.
import Tooltip from './Tooltip'
import { kickTooltip, type PreviousKick } from '../lib/departures'

export default function KickBadge({ kick }: { kick: PreviousKick }): JSX.Element {
  return (
    <Tooltip text={kickTooltip(kick)}>
      <span className="axi-chip axi-chip--danger ar-sm shrink-0">Previously kicked</span>
    </Tooltip>
  )
}
