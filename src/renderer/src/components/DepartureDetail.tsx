// src/renderer/src/components/DepartureDetail.tsx
//
// One departure record: the officer's note about the person, a reason per
// departure episode, and "Add departure manually". doc === null opens it as a
// brand-new record for an account typed in here. Only officer fields are
// edited — detection owns kind/actor/time for log and diff episodes.
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import Picker from './Picker'
import { useMountTransition } from '../lib/useMountTransition'
import { fmtRelative } from '../lib/status'
import Tooltip from './Tooltip'
import { departureKey, emptyDepartureDoc, type DepartureDoc, type DepartureKind } from '../../../shared/departures'
import { addManualEpisode, setDocNote, setEpisodeReason, DEPARTED_META } from '../lib/departures'

export interface DepartureDetailProps {
  doc: DepartureDoc | null
  canEdit: boolean
  /** departureKey of every loaded doc, to stop the add form clobbering one. */
  existingKeys: ReadonlySet<string>
  onSave: (doc: DepartureDoc) => Promise<void>
  onClose: () => void
}

const pad = (n: number): string => String(n).padStart(2, '0')
const today = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const ACCOUNT_RE = /^.+\.\d{4}$/

export default function DepartureDetail({ doc, canEdit, existingKeys, onSave, onClose }: DepartureDetailProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const closing = useRef(false)
  const t = useMountTransition(open)
  useEffect(() => setOpen(true), [])
  useEffect(() => {
    if (closing.current && !t.mounted) onClose()
  }, [t.mounted, onClose])
  const close = (): void => {
    closing.current = true
    setOpen(false)
  }

  const [current, setCurrent] = useState<DepartureDoc | null>(doc)
  useEffect(() => setCurrent(doc), [doc])
  const [note, setNote] = useState(doc?.note ?? '')
  const [account, setAccount] = useState('')
  const [kind, setKind] = useState<DepartureKind>('left')
  const [actor, setActor] = useState('')
  const [date, setDate] = useState(today())
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setNote(current?.note ?? ''), [current?.note])

  const persist = async (next: DepartureDoc): Promise<void> => {
    setCurrent(next)
    await onSave(next)
  }

  const addEpisode = async (): Promise<void> => {
    if (busy) return
    if (!current && existingKeys.has(departureKey(account))) {
      return setFormError('Already recorded — open it from the list')
    }
    const base = current ?? (ACCOUNT_RE.test(account.trim()) ? emptyDepartureDoc(account) : null)
    if (!base) return setFormError('Enter a GW2 account name like Name.1234')
    if (Number.isNaN(Date.parse(date))) return setFormError('Pick a date')
    if (date > today()) return setFormError("Date can't be in the future")
    setFormError(null)
    // Today gets the real time so it can't land in the future; other days sit at noon UTC.
    const at = date === today() ? new Date().toISOString() : `${date}T12:00:00.000Z`
    setBusy(true)
    try {
      await persist(addManualEpisode(base, { kind, actor: actor || null, at }))
      setActor('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`axi-scrim flex items-center justify-center p-6 transition-opacity duration-150 ease-out ${
        t.shown ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={close}
    >
      <div
        className={`ar-modal__sheet max-w-2xl transition duration-150 ease-out ${
          t.shown ? 'scale-100 opacity-100' : 'scale-[.98] opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ar-modal__head items-start">
          <div className="min-w-0 flex-1">
            <div className="ar-title truncate">{current?.account ?? 'Add a departure'}</div>
            <div className="ar-row__sub">
              {current ? `${current.episodes.length} departure${current.episodes.length === 1 ? '' : 's'} recorded` : 'Record someone the log missed'}
            </div>
          </div>
          <Tooltip text="Close">
            <button onClick={close} className="ar-icon-btn" aria-label="Close"><X size={15} /></button>
          </Tooltip>
        </div>

        <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto p-4">
          {!current && !canEdit && <div className="ar-note--faint">Nothing to show</div>}

          {current && (
            <div className="ar-field">
              <div className="axi-eyebrow">Note about this person</div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={() => current && note !== current.note && void persist(setDocNote(current, note))}
                disabled={!canEdit}
                rows={3}
                placeholder="Anything officers should know if they come back"
                className="axi-input"
              />
            </div>
          )}

          {current && current.episodes.length > 0 && (
            <div className="ar-field">
              <div className="axi-eyebrow">History</div>
              <div className="flex flex-col gap-3">
                {current.episodes.map((e, i) => {
                  const m = DEPARTED_META[e.rejoinedAt ? 'rejoined' : e.kind]
                  return (
                    <div key={`${e.at}:${i}`} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`axi-chip ar-sm${m.tone === 'idle' ? '' : ` axi-chip--${m.tone}`}`}>{m.label}</span>
                        <Tooltip text={new Date(e.at).toLocaleString()}>
                          <span className="ar-num">{fmtRelative(e.at)}</span>
                        </Tooltip>
                        {e.actor && <span className="ar-row__sub">by {e.actor}</span>}
                        <span className="ar-note--faint">{e.source.replace('-', ' ')}</span>
                        {e.rejoinedAt && <span className="ar-note--faint">· back {fmtRelative(e.rejoinedAt)}</span>}
                      </div>
                      <ReasonInput
                        value={e.reason}
                        disabled={!canEdit}
                        onCommit={(reason) => current && void persist(setEpisodeReason(current, i, reason))}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {canEdit && (
            <div className="ar-field">
              <div className="axi-eyebrow">Add departure manually</div>
              <div className="flex flex-wrap items-center gap-2">
                {!current && (
                  <input
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    placeholder="Account.1234"
                    className="axi-input ar-sm"
                  />
                )}
                <Picker
                  sm
                  value={kind}
                  onChange={(v) => setKind(v as DepartureKind)}
                  options={[
                    { value: 'left', label: 'Left' },
                    { value: 'kicked', label: 'Kicked' },
                    { value: 'unknown', label: 'Unknown' }
                  ]}
                />
                {kind === 'kicked' && (
                  <input
                    value={actor}
                    onChange={(e) => setActor(e.target.value)}
                    placeholder="Kicked by (Account.1234)"
                    className="axi-input ar-sm"
                  />
                )}
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="axi-input ar-sm" />
                <button onClick={() => void addEpisode()} disabled={busy} className="axi-btn ar-sm">Add</button>
              </div>
              {formError && <div className="ar-ink-danger mt-1">{formError}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ReasonInput({
  value,
  disabled,
  onCommit
}: {
  value: string
  disabled: boolean
  onCommit: (v: string) => void
}): JSX.Element {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      disabled={disabled}
      placeholder="Reason"
      className="axi-input ar-sm"
    />
  )
}
