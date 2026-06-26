import { Link2 } from 'lucide-react'
import type { ChipModel } from '../lib/auditIdentities'

function Half({ kind, name }: { kind: 'discord' | 'gw2'; name: string }): JSX.Element {
  return (
    <span className="flex h-full items-center gap-1.5 whitespace-nowrap px-2">
      <span
        className={`grid h-3.5 w-3.5 flex-none place-items-center rounded-[3px] text-[9px] font-bold text-black ${
          kind === 'discord' ? 'bg-indigo-400' : 'bg-emerald-400'
        }`}
      >
        {kind === 'discord' ? 'D' : 'G'}
      </span>
      <span className="truncate text-[12px] text-ink">{name}</span>
    </span>
  )
}

/** Renders one resolved identity. Shows both Discord + GW2 halves joined by a
 *  link glyph when the tie is known; a single half otherwise; a dashed muted
 *  chip for a name not found in the roster. */
export default function IdentityChip({ chip }: { chip: ChipModel }): JSX.Element {
  const base = 'inline-flex h-6 max-w-full items-center overflow-hidden rounded-md align-middle'

  if (!chip.known) {
    const name = chip.discordName || chip.gw2Account || '—'
    return (
      <span className={`${base} border border-dashed border-panel-line px-2`}>
        <span className="truncate text-[12px] text-ink-dim">{name}</span>
      </span>
    )
  }

  if (chip.discordName && chip.gw2Account) {
    return (
      <span className={`${base} border border-panel-line2 bg-panel-raised`}>
        <Half kind="discord" name={chip.discordName} />
        <span className="flex h-full items-center bg-accent/10 px-1 text-ink-faint">
          <Link2 size={11} />
        </span>
        <Half kind="gw2" name={chip.gw2Account} />
      </span>
    )
  }

  const kind = chip.discordName ? 'discord' : 'gw2'
  return (
    <span className={`${base} border border-panel-line2 bg-panel-raised`}>
      <Half kind={kind} name={chip.discordName || chip.gw2Account || '—'} />
    </span>
  )
}
