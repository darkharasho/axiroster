import { useCallback, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { AuditPerson } from '../../../preload/index.d'
import { client } from '../lib/client'
import { errorMessage, useGuildData } from '../lib/useGuildData'
import { EMPTY_INDEX, EventRow } from './GuildLog'

// Everything the audit log recorded happening to one person, in game and on
// Discord, newest first — so officers can see when and why someone was kicked
// without searching the whole Log. Rows render exactly as the Log tab's do.

export const HISTORY_PREVIEW = 50

function dateOf(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function MemberHistory({ accounts, discordIds }: AuditPerson): JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggleRow = useCallback((uid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }, [])

  const key = `${accounts.join('\n')}\u0000${discordIds.join('\n')}`
  const q = useGuildData(async () => (await client.auditList({ person: { accounts, discordIds } })).events, {
    on: ['audit', 'workspace'],
    deps: [key]
  })
  const events = q.data ?? []
  const shown = showAll ? events : events.slice(0, HISTORY_PREVIEW)

  const groups = useMemo(() => {
    const out: { day: string; rows: typeof shown }[] = []
    for (const e of shown) {
      const d = dateOf(e.time)
      const last = out[out.length - 1]
      if (last && last.day === d) last.rows.push(e)
      else out.push({ day: d, rows: [e] })
    }
    return out
  }, [shown])

  return (
    <div className="ar-field">
      <div className="axi-eyebrow">Audit log</div>
      {q.loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <div className="axi-skeleton" />
          <div className="axi-skeleton" />
          <div className="axi-skeleton" />
        </div>
      ) : q.error != null ? (
        <div className="flex flex-wrap items-center gap-2" role="alert">
          <span className="ar-ink-danger">Couldn&apos;t load the audit log: {errorMessage(q.error)}</span>
          <button onClick={() => void q.reload()} className="axi-btn ar-sm">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      ) : events.length === 0 ? (
        <div className="ar-note--faint">Nothing in the audit log for this person yet.</div>
      ) : (
        <div>
          {groups.map((g) => (
            <div key={g.day}>
              <div className="ar-row__sub pt-2">{g.day}</div>
              {g.rows.map((e) => (
                <EventRow key={e.uid} event={e} index={EMPTY_INDEX} open={expanded.has(e.uid)} onToggle={toggleRow} />
              ))}
            </div>
          ))}
          {!showAll && events.length > HISTORY_PREVIEW && (
            <button onClick={() => setShowAll(true)} className="axi-btn ar-sm mt-2">
              Show all {events.length}
            </button>
          )}
        </div>
      )}
      {discordIds.length === 0 && (
        <div className="ar-note--faint">Link a Discord account to include Discord actions.</div>
      )}
    </div>
  )
}
