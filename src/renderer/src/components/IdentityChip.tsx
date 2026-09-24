import { Link2 } from 'lucide-react'
import type { ChipModel } from '../lib/auditIdentities'

function Half({ kind, name }: { kind: 'discord' | 'gw2'; name: string }): JSX.Element {
  return (
    <span className="ar-ident__half">
      <span className="ar-ident__kind">{kind === 'discord' ? 'D' : 'G'}</span>
      <span className="truncate">{name}</span>
    </span>
  )
}

/** Renders one resolved identity. Shows both Discord + GW2 halves joined by a
 *  link glyph when the tie is known; a single half otherwise; a dashed muted
 *  chip for a name not found in the roster. */
export default function IdentityChip({ chip }: { chip: ChipModel }): JSX.Element {
  if (!chip.known) {
    const name = chip.discordName || chip.gw2Account || '—'
    return (
      <span className="ar-ident ar-ident--unknown">
        <span className="truncate ar-ink-dim">
          {name}
        </span>
      </span>
    )
  }

  if (chip.discordName && chip.gw2Account) {
    return (
      <span className="ar-ident">
        <Half kind="discord" name={chip.discordName} />
        <span className="ar-ident__link">
          <Link2 size={11} />
        </span>
        <Half kind="gw2" name={chip.gw2Account} />
      </span>
    )
  }

  const kind = chip.discordName ? 'discord' : 'gw2'
  return (
    <span className="ar-ident">
      <Half kind={kind} name={chip.discordName || chip.gw2Account || '—'} />
    </span>
  )
}
