import { useEffect, useMemo, useRef, useState } from 'react'
import Picker from './Picker'
import { X, Plus, Link2, Swords, Clock, CalendarDays, Shield, UserX, Crown, Star, ChevronLeft, ChevronUp, ChevronDown, ExternalLink } from 'lucide-react'
import axibridgeLogo from '../assets/axibridge-logo.svg'
import type {
  AttendanceRaidDTO,
  BridgePlayerMetrics,
  DiscordCandidate,
  DiscordRole,
  ReconciledMember
} from '../../../preload/index.d'
import { STATUS_META, fmtDuration, fmtRelative, toneDiamond, type Tone } from '../lib/status'
import { aggregateMemberMetrics } from '../lib/metrics'
import { suggestMatches, bestMatch, type MatchSuggestion } from '../lib/matching'
import ClassIcon from './ClassIcon'
import { roleColor, roleIcon } from '../lib/roleStyle'
import { toast } from '../lib/toast'
import NotesEditor from './NotesEditor'
import TagPicker from './TagPicker'
import { parseRegistry, setTagColor, type TagRegistry, type TagColorId } from '../lib/tagRegistry'
import { client } from '../lib/client'
import TimeWindowStrip from './TimeWindowStrip'
import Tooltip from './Tooltip'
import {
  filterRaids,
  memberAttendance,
  memberEntry,
  type TimeWindow
} from '../lib/attendanceWindow'

export default function MemberDetail({
  member,
  metrics,
  discordGuildId,
  discordRoles,
  discordCandidates,
  onSelect,
  onChanged,
  onBack,
  siblings,
  canEdit = true,
  attendanceSeries,
  timeWindow,
  onTimeWindowChange
}: {
  member: ReconciledMember
  metrics: Record<string, BridgePlayerMetrics>
  discordGuildId: string | null
  discordRoles: DiscordRole[]
  discordCandidates: DiscordCandidate[]
  onSelect: (annotationKey: string) => void
  onChanged: () => void
  onBack: () => void
  siblings: string[]
  /** False for read-only members — disables all annotation/link editing. */
  canEdit?: boolean
  attendanceSeries: AttendanceRaidDTO[]
  timeWindow: TimeWindow
  onTimeWindowChange: (w: TimeWindow) => void
}): JSX.Element {
  const [nickname, setNickname] = useState(member.nickname)
  const [notes, setNotes] = useState(member.notes)
  const [tags, setTags] = useState<string[]>(member.tags)
  const [registry, setRegistry] = useState<TagRegistry>({})
  // The big name header scrolls away -> hand the name off to the sticky bar.
  const headerRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [nameInBar, setNameInBar] = useState(false)

  useEffect(() => {
    let alive = true
    client.getTagRegistry().then((m) => alive && setRegistry(parseRegistry(JSON.stringify(m))))
    return () => { alive = false }
  }, [])

  // Show the name in the top bar once the header row passes under it. Observer
  // rather than a scroll listener: no per-frame work, and re-running on member
  // change keeps it correct when the up/down nav swaps who is shown.
  useEffect(() => {
    const header = headerRef.current
    const root = scrollRef.current
    if (!header || !root) return
    const io = new IntersectionObserver(
      ([e]) => setNameInBar(!e.isIntersecting),
      { root, rootMargin: '-40px 0px 0px 0px' }
    )
    io.observe(header)
    return () => io.disconnect()
  }, [member.annotationKey])

  // Reset local edit state whenever a different member is selected.
  useEffect(() => {
    setNickname(member.nickname)
    setNotes(member.notes)
    setTags(member.tags)
  }, [member.annotationKey])

  const meta = STATUS_META[member.status]

  const save = async (patch: Record<string, unknown>): Promise<void> => {
    if (!canEdit) return
    await client.upsertAnnotation(member.annotationKey, patch)
    toast('Saved')
    onChanged()
  }

  // Bridge metrics keyed by lc(account); use the member's main/first account.
  // Aggregate AxiBridge stats across ALL of this person's GW2 accounts.
  const m = aggregateMemberMetrics(member.accounts, metrics)
  const attendance =
    m && m.raidsConsidered > 0 ? Math.round((m.raidsAttended / m.raidsConsidered) * 100) : null

  const accountNames = member.accounts.map((a) => a.account_name)
  const hasSeries = attendanceSeries.length > 0
  const windowedRaids = useMemo(
    () => filterRaids(attendanceSeries, timeWindow, Date.now()),
    [attendanceSeries, timeWindow]
  )
  const windowedAtt = useMemo(
    () => memberAttendance(windowedRaids, accountNames),
    [windowedRaids, member] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const idx = siblings.indexOf(member.annotationKey)
  const prevKey = idx > 0 ? siblings[idx - 1] : null
  const nextKey = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="ar-detail__bar">
        <button onClick={onBack} className="axi-btn ar-sm">
          <ChevronLeft size={14} /> Roster
        </button>
        <div
          aria-hidden={!nameInBar}
          className={`flex min-w-0 flex-1 items-center gap-2 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
            nameInBar ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'
          }`}
        >
          {m?.mainClass && <ClassIcon name={m.mainClass} size={16} />}
          <span className="ar-row__name">{member.label}</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="ar-num">
            {idx >= 0 ? idx + 1 : '–'} / {siblings.length}
          </span>
          <button onClick={() => prevKey && onSelect(prevKey)} disabled={!prevKey} className="ar-icon-btn">
            <ChevronUp size={14} />
          </button>
          <button onClick={() => nextKey && onSelect(nextKey)} disabled={!nextKey} className="ar-icon-btn">
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
      {hasSeries && (
        <div className="ar-pane__head">
          <TimeWindowStrip
            window={timeWindow}
            onChange={onTimeWindowChange}
            raids={attendanceSeries}
            raidCount={windowedRaids.length}
          />
        </div>
      )}
      <div ref={headerRef} className="ar-detail__head">
        <span className="ar-detail__avatar">
          {m?.mainClass ? (
            <ClassIcon name={m.mainClass} size={30} />
          ) : (
            <span className={toneDiamond(meta.tone)} style={{ width: 12, height: 12 }} />
          )}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="ar-title truncate">{member.label}</h1>
            {/* The reconciliation status is a verdict on the member, so it is a
                filled chip; the link source is a fact about our records, which
                is what the reserved meta ink is for (rules 5/6). */}
            <span className={`axi-chip${meta.tone === 'idle' ? '' : ` axi-chip--${meta.tone}`}`}>
              {meta.label}
            </span>
            {member.linkSource && <span className="axi-chip axi-chip--meta">{member.linkSource} link</span>}
          </div>
          <div className="ar-note mt-1">
            {member.discordName ? `@${member.discordName}` : 'No Discord match'}
            {member.rank ? ` · ${member.rank}` : ''}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-2">
        {/* annotations */}
        <section className="flex flex-col gap-4">
          {!canEdit && (
            <div className="axi-chip axi-chip--meta self-start">
              Read-only — view access to this workspace
            </div>
          )}
          <Field label="Nickname">
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onBlur={() => nickname !== member.nickname && save({ nickname })}
              placeholder="Preferred name"
              disabled={!canEdit}
              className="axi-input"
            />
          </Field>

          <Field label="Tags">
            <TagPicker
              tags={tags}
              registry={registry}
              editable={canEdit}
              onAssign={(name) => {
                if (tags.some((t) => t.toLowerCase() === name.toLowerCase())) return
                const next = [...tags, name]
                setTags(next)
                save({ tags: next })
              }}
              onRemove={(name) => {
                const next = tags.filter((t) => t !== name)
                setTags(next)
                save({ tags: next })
              }}
              onRecolor={async (name, id: TagColorId) => {
                const next = setTagColor(registry, name, id)
                setRegistry(next)
                await client.setTagRegistry(next).catch(() => {})
              }}
            />
          </Field>

          <Field label="Notes">
            <NotesEditor
              key={member.annotationKey}
              value={notes}
              editable={canEdit}
              onSave={(serialized) => {
                setNotes(serialized)
                if (serialized !== member.notes) save({ notes: serialized })
              }}
            />
          </Field>
        </section>

        {/* gw2 + bridge metrics */}
        <section className="flex flex-col gap-4">
          <Field label="GW2 accounts">
            <div className="flex flex-col gap-2">
              {member.accounts.length === 0 && (
                <div className="ar-note--faint">No GW2 account linked.</div>
              )}
              {member.accounts.map((a) => (
                <div key={a.account_name} className="ar-tile">
                  {/* star = main indicator + set-main control */}
                  {(() => {
                    const canSetMain = canEdit && !a.main && member.accounts.length > 1
                    return (
                      <button
                        disabled={!canSetMain}
                        onClick={canSetMain ? () => save({ mainAccount: a.account_name }) : undefined}
                        title={a.main ? 'Main account' : canSetMain ? 'Set as main' : ''}
                        className="ar-star mt-px shrink-0"
                        data-main={a.main ? 'true' : undefined}
                      >
                        <Star size={14} fill={a.main ? 'currentColor' : 'none'} />
                      </button>
                    )
                  })()}

                  <div className="min-w-0 flex-1">
                    <div className="break-all">{a.account_name}</div>
                    <div className="ar-note--faint mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="axi-legend__key">
                        <span className={a.inGuild ? 'axi-diamond axi-diamond--ok' : 'axi-diamond ar-diamond--idle'} />
                        {a.inGuild ? `in guild${a.rank ? ` · ${a.rank}` : ''}` : 'not in guild'}
                      </span>
                      {a.manual &&
                        (canEdit ? (
                          <Tooltip text="Unlink this account">
                            <button
                              onClick={async () => {
                                await client.removeLink(a.account_name)
                                toast('Account unlinked')
                                onChanged()
                              }}
                              className="ar-unlink axi-legend__key"
                            >
                              manual link
                              <X size={11} />
                            </button>
                          </Tooltip>
                        ) : (
                          <span className="axi-legend__key">manual link</span>
                        ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* An unlinked in-game account: offer to attach it to any Discord user. */}
            {canEdit && member.status === 'unlinked' && member.accountName && (
              <LinkToMemberPicker
                accountName={member.accountName}
                candidates={discordCandidates}
                onLinked={(memberId) => {
                  onChanged()
                  onSelect(memberId)
                }}
              />
            )}
          </Field>

          <Field label="WvW activity (AxiBridge)">
            {m ? (
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  icon={
                    m.mainClass ? (
                      <ClassIcon name={m.mainClass} size={14} />
                    ) : (
                      <Swords size={14} />
                    )
                  }
                  label="Main class"
                  value={m.mainClass ?? '—'}
                />
                <Stat
                  icon={<img src={axibridgeLogo} alt="" className="h-3.5 w-3.5" />}
                  label="Attendance"
                  value={
                    hasSeries
                      ? windowedAtt.pct !== null
                        ? `${windowedAtt.pct}% (${windowedAtt.attended}/${windowedAtt.total})`
                        : '—'
                      : attendance !== null
                        ? `${attendance}% (${m.raidsAttended}/${m.raidsConsidered})`
                        : '—'
                  }
                />
                <Stat
                  icon={<Clock size={14} />}
                  label="Combat time"
                  value={fmtDuration(m.combatTimeMs)}
                />
                <Stat
                  icon={<CalendarDays size={14} />}
                  label="Last seen"
                  value={fmtRelative(m.lastSeen)}
                />
                {Object.keys(m.classSpread).length > 0 && (
                  <div className="col-span-2">
                    <div className="axi-eyebrow mb-2">Class spread</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(m.classSpread)
                        .sort((a, b) => b[1] - a[1])
                        .map(([cls, n]) => (
                          <span key={cls} className="axi-chip">
                            <ClassIcon name={cls} size={13} />
                            {cls} <span className="ar-num">{n}</span>
                          </span>
                        ))}
                    </div>
                  </div>
                )}

                {m.commander && (
                  <div className="ar-section col-span-2">
                    <div className="ar-section__head" style={{ marginBottom: 8 }}>
                      <span className="axi-chip axi-chip--accent">
                        <Crown size={13} /> Commander · {m.commander.runs} raids led
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-3 text-center">
                      <Mini label="KDR" value={m.commander.kdr.toFixed(2)} />
                      <Mini
                        label="Win rate"
                        value={`${winRate(m.commander.wins, m.commander.losses)}%`}
                      />
                      <Mini label="Fights led" value={String(m.commander.fightsLed)} />
                      <Mini label="Kills" value={String(m.commander.kills)} />
                    </div>
                  </div>
                )}

                {m.perAccount.length > 1 && (
                  <div className="col-span-2">
                    <div className="axi-eyebrow mb-2">
                      Per account ({m.perAccount.length} accounts combined)
                    </div>
                    <div className="ar-rows">
                      {m.perAccount.map(({ account, m: am }) => (
                        <div key={account}>
                          <span className="ar-ink min-w-0 flex-1 truncate" title={account}>
                            {account}
                          </span>
                          <span className="axi-legend__key shrink-0">
                            <ClassIcon name={am.mainClass} size={12} />
                            {am.mainClass ?? '—'}
                          </span>
                          <span className="ar-num shrink-0">{am.raidsAttended} raids</span>
                          <span className="ar-num shrink-0">{fmtDuration(am.combatTimeMs)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : hasSeries ? (
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  icon={<img src={axibridgeLogo} alt="" className="h-3.5 w-3.5" />}
                  label="Attendance"
                  value={
                    windowedAtt.pct !== null
                      ? `${windowedAtt.pct}% (${windowedAtt.attended}/${windowedAtt.total})`
                      : '—'
                  }
                />
                <div className="ar-note--faint col-span-2">
                  No other AxiBridge data for this person&apos;s accounts.
                </div>
              </div>
            ) : (
              <div className="ar-note--faint">
                No AxiBridge data for this person&apos;s accounts. Configure report repos in
                Settings.
              </div>
            )}
          </Field>

          {hasSeries && (
            <Field label="Attendance timeline">
              <AttendanceTimeline raids={windowedRaids} accounts={accountNames} />
            </Field>
          )}

          {hasSeries && (
            <Field label="Raid log">
              <RaidLog raids={windowedRaids} accounts={accountNames} />
            </Field>
          )}

          {member.memberId && discordGuildId && (
            <Field label="Discord roles">
              <DiscordRolesPanel
                guildId={discordGuildId}
                memberId={member.memberId}
                memberLabel={member.label}
                memberRoleIds={member.roles}
                allRoles={discordRoles}
                onChanged={onChanged}
                canEdit={canEdit}
              />
            </Field>
          )}
        </section>
      </div>

      <div className="ar-note--faint p-5 pt-0">
        {member.aliases.length > 0 && <>Aliases: {member.aliases.join(', ')}</>}
      </div>
    </div>
  )
}

// How sure the matcher is, named by what it asserts. "possible" is a shrug, so
// it sits on the neutral ramp rather than borrowing a status ink.
const CONFIDENCE_TONE: Record<MatchSuggestion['confidence'], Tone> = {
  strong: 'ok',
  likely: 'warn',
  possible: 'idle'
}

function LinkToMemberPicker({
  accountName,
  candidates,
  onLinked
}: {
  accountName: string
  candidates: DiscordCandidate[]
  onLinked: (memberId: string) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  // Auto-suggested matches (name reuse between GW2 and Discord) when not typing.
  const suggestions = useMemo(
    () => suggestMatches(accountName, candidates),
    [accountName, candidates]
  )

  const q = query.trim().toLowerCase()
  const matches = q
    ? candidates
        .filter(
          (c) =>
            c.displayName.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
        )
        .slice(0, 8)
    : []

  const link = async (memberId: string): Promise<void> => {
    await client.setLink(accountName, memberId)
    toast('Account linked')
    setQuery('')
    setOpen(false)
    onLinked(memberId)
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      {/* auto-suggested matches */}
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="axi-eyebrow">Suggested matches</div>
          {suggestions.map((s) => (
            <button
              key={s.candidate.id}
              onClick={() => link(s.candidate.id)}
              className="ar-tile"
            >
              <span
                className={toneDiamond(CONFIDENCE_TONE[s.confidence])}
                title={s.confidence}
              />
              <span className="min-w-0 truncate">{s.candidate.displayName}</span>
              {s.candidate.name && s.candidate.name !== s.candidate.displayName && (
                <span className="ar-note--faint shrink-0 truncate">@{s.candidate.name}</span>
              )}
              <span className="axi-chip ml-auto shrink-0">
                {s.confidence} · {Math.round(s.score * 100)}%
              </span>
            </button>
          ))}
        </div>
      )}

      {/* manual typeahead */}
      <div className="axi-menu">
        <div className="flex items-center gap-2">
          <Link2 size={13} className="shrink-0 ar-ink-faint" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            placeholder="Or search any Discord user…"
            className="axi-input"
          />
        </div>
        {open && matches.length > 0 && (
          <div className="axi-menu__pop" style={{ '--axi-menu-width': '100%' } as React.CSSProperties}>
            {matches.map((c) => (
              <button
                key={c.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => link(c.id)}
                className="ar-pop__item"
              >
                <span className="ar-ink">{c.displayName}</span>
                {c.name && c.name !== c.displayName && (
                  <span className="ar-note--faint">@{c.name}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {open && q && matches.length === 0 && (
          <div
            className="axi-menu__pop ar-note--faint"
            style={{ '--axi-menu-width': '100%' } as React.CSSProperties}
          >
            No Discord user matches “{query}”.
          </div>
        )}
      </div>

      {/* diagnostic: how many Discord users we can match against, and the closest
          one. If the right person isn't even the closest, they're not in the
          pool (Discord source incomplete); if they are but score low, it's the
          matcher. */}
      {(() => {
        const best = bestMatch(accountName, candidates)
        return (
          <div className="ar-note--faint">
            Matching <span className="ar-ink-dim">{accountName}</span> against{' '}
            {candidates.length} Discord user{candidates.length === 1 ? '' : 's'}
            {candidates.length === 0
              ? ' — none loaded (check the Discord source)'
              : best
                ? ` · top: ${best.candidate.displayName}${
                    best.candidate.name ? ` (@${best.candidate.name})` : ''
                  } ${Math.round(best.score * 100)}%`
                : ''}
          </div>
        )
      })()}
    </div>
  )
}

// A Discord role's colour is the server's, not ours, so it arrives per-instance
// through --axi-series (rule 10); a role with no colour falls back to the
// neutral ramp rather than borrowing a status ink.
function RoleGlyph({
  role,
  color
}: {
  role: DiscordRole | undefined
  color: string | undefined
}): JSX.Element {
  const icon = roleIcon(role)
  if (icon && /^https?:\/\//.test(icon)) {
    return <img src={icon} alt="" className="h-3 w-3" />
  }
  if (icon) return <span className="leading-none">{icon}</span>
  return (
    /* A Discord role's colour is the server's, not the language's, so it
       arrives per-instance as --axi-series (rule 10); a role with none set
       falls back to the neutral ramp rather than borrowing a status ink. */
    <span
      className={color ? 'axi-diamond axi-diamond--series' : 'axi-diamond ar-diamond--idle'}
      style={{ '--axi-series': color, width: 9, height: 9 } as React.CSSProperties}
    />
  )
}

function DiscordRolesPanel({
  guildId,
  memberId,
  memberLabel,
  memberRoleIds,
  allRoles,
  onChanged,
  canEdit
}: {
  guildId: string
  memberId: string
  memberLabel: string
  memberRoleIds: string[]
  allRoles: DiscordRole[]
  onChanged: () => void
  canEdit: boolean
}): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addId, setAddId] = useState('')

  const roleById = (id: string): DiscordRole | undefined => allRoles.find((r) => r.id === id)
  const assigned = memberRoleIds.filter((id) => roleById(id)?.name !== '@everyone')
  const assignable = allRoles.filter(
    (r) => !memberRoleIds.includes(r.id) && r.name !== '@everyone'
  )

  const act = async (action: 'role_assign' | 'role_unassign', roleId: string): Promise<void> => {
    setBusy(roleId)
    setError(null)
    const res = await client.discordAction(guildId, action, {
      member_id: memberId,
      role_id: roleId
    })
    setBusy(null)
    if (!res.ok) setError(res.error)
    else {
      toast(action === 'role_assign' ? 'Role added' : 'Role removed')
      onChanged()
    }
  }

  const kick = async (): Promise<void> => {
    if (!confirm(`Kick ${memberLabel} from the Discord server? This cannot be undone.`)) return
    setBusy('kick')
    setError(null)
    const res = await client.discordAction(guildId, 'member_kick', { member_id: memberId })
    setBusy(null)
    if (!res.ok) setError(res.error)
    else {
      toast('Member kicked')
      onChanged()
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {assigned.length === 0 && <span className="ar-note--faint">No roles.</span>}
        {assigned.map((id) => {
          const role = roleById(id)
          const color = roleColor(role) ?? undefined
          return (
            <span
              key={id}
              className={color ? 'ar-tag' : 'axi-chip'}
              style={color ? ({ '--axi-series': color } as React.CSSProperties) : undefined}
            >
              <RoleGlyph role={role} color={color} />
              {role?.name ?? id}
              {canEdit && (
                <Tooltip text="Remove role">
                  <button
                    onClick={() => act('role_unassign', id)}
                    disabled={busy === id}
                    className="ar-tag__x"
                  >
                    <X size={12} />
                  </button>
                </Tooltip>
              )}
            </span>
          )
        })}
      </div>

      {canEdit && assignable.length > 0 && (
        <div className="flex gap-2">
          <Picker
            value={addId}
            onChange={setAddId}
            className="flex-1"
            options={[
              { value: '', label: 'Add a role…' },
              ...assignable.map((r) => ({ value: r.id, label: r.name }))
            ]}
          />
          <button
            onClick={() => addId && act('role_assign', addId).then(() => setAddId(''))}
            disabled={!addId || busy !== null}
            className="axi-btn"
          >
            <Plus size={13} /> Add
          </button>
        </div>
      )}

      {canEdit && (
        <button
          onClick={kick}
          disabled={busy !== null}
          className="axi-btn ar-btn--danger self-start"
        >
          <UserX size={13} /> Kick from Discord
        </button>
      )}

      {error && <div className="ar-banner ar-banner--danger">{error}</div>}
    </div>
  )
}

function winRate(wins: number, losses: number): number {
  const total = wins + losses
  return total > 0 ? Math.round((wins / total) * 100) : 0
}

// A figure and its name with no box around it — the box is the panel it sits
// in. The type is .axi-stat's, so it lines up with the tiles beside it.
function Mini({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="axi-stat ar-sm ar-bare">
      <span className="axi-stat__k">{label}</span>
      <span className="axi-stat__n">{value}</span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="ar-field">
      <div className="axi-eyebrow">{label}</div>
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
    <div className="axi-stat ar-sm">
      <span className="axi-stat__k ar-row-k">
        {icon}
        {label}
      </span>
      <span className="axi-stat__n">{value}</span>
    </div>
  )
}

const fmtDay = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const fmtWeekday = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, { weekday: 'short' })

const TIMELINE_CAP = 40

function AttendanceTimeline({
  raids,
  accounts
}: {
  raids: AttendanceRaidDTO[]
  accounts: string[]
}): JSX.Element {
  if (raids.length === 0) return <div className="ar-note--faint">No raids in this window.</div>
  // raids arrive newest-first; render oldest→newest left→right
  const chrono = [...raids].reverse()
  const shown = chrono.slice(-TIMELINE_CAP)
  const earlier = chrono.length - shown.length
  return (
    <div>
      {/* Attended/missed is drawn as length, not intensity (rule 9): a tall
          column in the ok ink, a stub on the neutral ramp. */}
      <div
        className="axi-bars"
        style={{ '--axi-plot-h': '32px', '--axi-bars-gap': '3px' } as React.CSSProperties}
      >
        {shown.map((r) => {
          const ts = Date.parse(r.date)
          const went = memberEntry(r, accounts) !== null
          return (
            <span
              key={r.id}
              title={`${Number.isNaN(ts) ? r.date : fmtDay(ts)} — ${went ? 'attended' : 'missed'}`}
              className="axi-bars__col"
              style={
                {
                  '--axi-bar-v': went ? '100%' : '28%',
                  '--axi-series': went ? 'var(--axi-ok)' : 'var(--axi-rule)'
                } as React.CSSProperties
              }
            />
          )
        })}
      </div>
      <div className="axi-axis">
        <span>
          {earlier > 0
            ? `+${earlier} earlier`
            : shown[0]
              ? fmtDay(Date.parse(shown[0].date))
              : ''}
        </span>
        <span>newest →</span>
      </div>
    </div>
  )
}

function RaidLog({
  raids,
  accounts
}: {
  raids: AttendanceRaidDTO[]
  accounts: string[]
}): JSX.Element {
  if (raids.length === 0) return <div className="ar-note--faint">No raids in this window.</div>
  return (
    <div className="ar-rows max-h-64 overflow-y-auto">
      {raids.map((r) => {
        const ts = Date.parse(r.date)
        const entry = memberEntry(r, accounts)
        const cells = (
          <>
            <span className="ar-num w-24 shrink-0 ar-ink">
              {Number.isNaN(ts) ? r.date : fmtDay(ts)}
            </span>
            <span className="ar-num w-9 shrink-0">{Number.isNaN(ts) ? '' : fmtWeekday(ts)}</span>
            {/* Attendance is the verdict on the row, so it is a filled chip;
                a miss is the absence of one and stays plain (rule 5). */}
            {entry ? (
              <span className="axi-chip axi-chip--ok shrink-0">Attended</span>
            ) : (
              <span className="axi-chip shrink-0">Missed</span>
            )}
            {entry?.professions && entry.professions.length > 0 && (
              <span className="flex shrink-0 items-center gap-1">
                {entry.professions.slice(0, 3).map((p) => (
                  <ClassIcon key={p} name={p} size={14} />
                ))}
              </span>
            )}
            <span
              className="ar-num ml-auto truncate"
              title={entry ? 'combat time · squad time' : undefined}
            >
              {entry ? `${fmtDuration(entry.combatTimeMs)} · ${fmtDuration(entry.squadTimeMs)}` : ''}
            </span>
            {r.reportUrl && <ExternalLink size={12} className="shrink-0" />}
          </>
        )
        return r.reportUrl ? (
          <button
            key={r.id}
            onClick={() => void client.openExternal(r.reportUrl!)}
            title="Open the AxiBridge report for this raid"
          >
            {cells}
          </button>
        ) : (
          <div key={r.id}>{cells}</div>
        )
      })}
    </div>
  )
}
