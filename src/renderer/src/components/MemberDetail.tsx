import { useEffect, useState } from 'react'
import { X, Plus, Link2, Swords, Clock, CalendarDays, Activity } from 'lucide-react'
import type {
  BridgePlayerMetrics,
  ReconciledMember
} from '../../../preload/index.d'
import { STATUS_META, fmtDuration, fmtRelative } from '../lib/status'

export default function MemberDetail({
  member,
  metrics,
  allMembers,
  onChanged
}: {
  member: ReconciledMember
  metrics: Record<string, BridgePlayerMetrics>
  allMembers: ReconciledMember[]
  onChanged: () => void
}): JSX.Element {
  const [nickname, setNickname] = useState(member.nickname)
  const [notes, setNotes] = useState(member.notes)
  const [tags, setTags] = useState<string[]>(member.tags)
  const [tagInput, setTagInput] = useState('')

  // Reset local edit state whenever a different member is selected.
  useEffect(() => {
    setNickname(member.nickname)
    setNotes(member.notes)
    setTags(member.tags)
    setTagInput('')
  }, [member.annotationKey])

  const meta = STATUS_META[member.status]

  const save = async (patch: Record<string, unknown>): Promise<void> => {
    await window.axiroster.upsertAnnotation(member.annotationKey, patch)
    onChanged()
  }

  const addTag = (): void => {
    const t = tagInput.trim()
    if (!t || tags.includes(t)) return setTagInput('')
    const next = [...tags, t]
    setTags(next)
    setTagInput('')
    save({ tags: next })
  }
  const removeTag = (t: string): void => {
    const next = tags.filter((x) => x !== t)
    setTags(next)
    save({ tags: next })
  }

  // Bridge metrics keyed by lc(account); use the member's main/first account.
  const mainAccount =
    member.accounts.find((a) => a.main)?.account_name ?? member.accounts[0]?.account_name
  const m = mainAccount ? metrics[mainAccount.toLowerCase()] : undefined
  const attendance =
    m && m.raidsConsidered > 0 ? Math.round((m.raidsAttended / m.raidsConsidered) * 100) : null

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-panel-line px-6 py-5">
        <div className="flex items-center gap-3">
          <span className="led h-2.5 w-2.5" style={{ background: meta.color }} />
          <h1 className="text-lg font-semibold text-white">{member.label}</h1>
          <span className="chip">{meta.label}</span>
          {member.linkSource && <span className="chip">{member.linkSource} link</span>}
        </div>
        <div className="mt-1 text-sm text-ink-dim">
          {member.discordName ? `@${member.discordName}` : 'No Discord match'}
          {member.rank ? ` · ${member.rank}` : ''}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 px-6 py-5 lg:grid-cols-2">
        {/* annotations */}
        <section className="space-y-4">
          <Field label="Nickname">
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onBlur={() => nickname !== member.nickname && save({ nickname })}
              placeholder="Preferred name"
              className="field"
            />
          </Field>

          <Field label="Tags">
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((t) => (
                <span key={t} className="chip">
                  {t}
                  <button onClick={() => removeTag(t)} className="text-ink-faint hover:text-white">
                    <X size={12} />
                  </button>
                </span>
              ))}
              <span className="inline-flex items-center gap-1">
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTag()}
                  placeholder="add tag"
                  className="field h-7 w-24 px-2 py-0"
                />
                <button onClick={addTag} className="btn px-1.5 py-1">
                  <Plus size={13} />
                </button>
              </span>
            </div>
          </Field>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== member.notes && save({ notes })}
              placeholder="Role, playstyle, timezone, anything…"
              rows={5}
              className="field resize-y"
            />
          </Field>
        </section>

        {/* gw2 + bridge metrics */}
        <section className="space-y-4">
          <Field label="GW2 accounts">
            <div className="space-y-1.5">
              {member.accounts.length === 0 && (
                <div className="text-sm text-ink-faint">No GW2 account linked.</div>
              )}
              {member.accounts.map((a) => (
                <div
                  key={a.account_name}
                  className="flex items-center gap-2 rounded-md border border-panel-line bg-panel-raised px-3 py-2 text-sm"
                >
                  <Link2 size={13} className="text-ink-faint" />
                  <span className="text-ink">{a.account_name}</span>
                  {a.main && <span className="chip px-1.5 py-0">main</span>}
                  {a.inGuild && (
                    <span className="chip px-1.5 py-0 text-green-400">in&nbsp;guild</span>
                  )}
                  {a.manual && <span className="chip px-1.5 py-0">manual</span>}
                </div>
              ))}
            </div>
          </Field>

          <Field label="WvW activity (AxiBridge)">
            {m ? (
              <div className="grid grid-cols-2 gap-2">
                <Stat icon={<Swords size={14} />} label="Main class" value={m.mainClass ?? '—'} />
                <Stat
                  icon={<Activity size={14} />}
                  label="Attendance"
                  value={attendance !== null ? `${attendance}% (${m.raidsAttended}/${m.raidsConsidered})` : '—'}
                />
                <Stat
                  icon={<Clock size={14} />}
                  label="Time in raids"
                  value={fmtDuration(m.squadTimeMs || m.combatTimeMs)}
                />
                <Stat
                  icon={<CalendarDays size={14} />}
                  label="Last seen"
                  value={fmtRelative(m.lastSeen)}
                />
                {Object.keys(m.classSpread).length > 0 && (
                  <div className="col-span-2">
                    <div className="mb-1 text-xs text-ink-faint">Class spread</div>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(m.classSpread)
                        .sort((a, b) => b[1] - a[1])
                        .map(([cls, n]) => (
                          <span key={cls} className="chip">
                            {cls} <span className="text-ink-faint">{n}</span>
                          </span>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-ink-faint">
                No AxiBridge data for this account. Configure report repos in Settings.
              </div>
            )}
          </Field>
        </section>
      </div>

      <div className="px-6 pb-6 text-xs text-ink-faint">
        {member.aliases.length > 0 && <>Aliases: {member.aliases.join(', ')}</>}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</div>
      {children}
    </div>
  )
}

function Stat({
  icon,
  label,
  value
}: {
  icon: React.ReactNode
  label: string
  value: string
}): JSX.Element {
  return (
    <div className="rounded-md border border-panel-line bg-panel-raised px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-ink-faint">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm text-ink">{value}</div>
    </div>
  )
}
