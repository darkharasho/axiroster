import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Plus, Link2, Swords, Clock, CalendarDays, Shield, UserX, Crown, Star, ChevronLeft, ChevronUp, ChevronDown, ExternalLink } from 'lucide-react'
import axibridgeLogo from '../assets/axibridge-logo.svg'
import type {
  AttendanceRaidDTO,
  BridgePlayerMetrics,
  DiscordCandidate,
  DiscordRole,
  ReconciledMember
} from '../../../preload/index.d'
import { STATUS_META, fmtDuration, fmtRelative } from '../lib/status'
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
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-panel-line bg-panel-sunk/95 px-4 py-2 shadow-[0_6px_12px_-6px_rgba(0,0,0,.5)] backdrop-blur">
        <button onClick={onBack} className="btn px-2 py-1 text-xs"><ChevronLeft size={14} /> Roster</button>
        <div
          aria-hidden={!nameInBar}
          className={`flex min-w-0 flex-1 items-center gap-2 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
            nameInBar ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'
          }`}
        >
          {m?.mainClass && <ClassIcon name={m.mainClass} size={16} />}
          <span className="truncate text-[13px] font-semibold text-white">{member.label}</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <span className="mr-2 text-xs text-ink-faint">{idx >= 0 ? idx + 1 : '–'} / {siblings.length}</span>
          <button onClick={() => prevKey && onSelect(prevKey)} disabled={!prevKey} className="btn px-2 py-1"><ChevronUp size={14} /></button>
          <button onClick={() => nextKey && onSelect(nextKey)} disabled={!nextKey} className="btn px-2 py-1"><ChevronDown size={14} /></button>
        </div>
      </div>
      {hasSeries && (
        <div className="border-b border-panel-line bg-panel-sunk/60 px-4 py-2">
          <TimeWindowStrip
            window={timeWindow}
            onChange={onTimeWindowChange}
            raids={attendanceSeries}
            raidCount={windowedRaids.length}
          />
        </div>
      )}
      <div ref={headerRef} className="flex items-center gap-4 border-b border-panel-line px-6 py-5">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-panel-line2 bg-raise shadow-raise">
          {m?.mainClass ? <ClassIcon name={m.mainClass} size={30} /> : <span className="led h-3 w-3" style={{ background: meta.color }} />}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-lg font-semibold text-white">{member.label}</h1>
            <span className="chip">{meta.label}</span>
            {member.linkSource && <span className="chip">{member.linkSource} link</span>}
          </div>
          <div className="mt-1 text-sm text-ink-dim">
            {member.discordName ? `@${member.discordName}` : 'No Discord match'}
            {member.rank ? ` · ${member.rank}` : ''}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 px-6 py-5 lg:grid-cols-2">
        {/* annotations */}
        <section className="space-y-4">
          {!canEdit && (
            <div className="rounded-md border border-panel-line bg-panel-sunk px-3 py-1.5 text-xs text-ink-faint">
              Read-only — you have view access to this workspace.
            </div>
          )}
          <Field label="Nickname">
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onBlur={() => nickname !== member.nickname && save({ nickname })}
              placeholder="Preferred name"
              disabled={!canEdit}
              className="field disabled:opacity-60"
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
        <section className="space-y-4">
          <Field label="GW2 accounts">
            <div className="space-y-1.5">
              {member.accounts.length === 0 && (
                <div className="text-sm text-ink-faint">No GW2 account linked.</div>
              )}
              {member.accounts.map((a) => (
                <div
                  key={a.account_name}
                  className="flex items-start gap-2.5 rounded-md border border-panel-line bg-raise shadow-raise px-3 py-2"
                >
                  {/* star = main indicator + set-main control */}
                  {(() => {
                    const canSetMain = canEdit && !a.main && member.accounts.length > 1
                    return (
                      <button
                        disabled={!canSetMain}
                        onClick={canSetMain ? () => save({ mainAccount: a.account_name }) : undefined}
                        title={a.main ? 'Main account' : canSetMain ? 'Set as main' : ''}
                        className={`mt-0.5 shrink-0 ${
                          a.main
                            ? 'text-accent-soft'
                            : canSetMain
                              ? 'text-ink-faint hover:text-accent-soft'
                              : 'text-ink-faint/30'
                        }`}
                      >
                        <Star size={14} fill={a.main ? 'currentColor' : 'none'} />
                      </button>
                    )
                  })()}

                  <div className="min-w-0 flex-1">
                    <div className="break-all text-sm text-ink">{a.account_name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-faint">
                      <span className="flex items-center gap-1">
                        <span
                          className="led h-1.5 w-1.5"
                          style={{ background: a.inGuild ? '#22c55e' : '#78716c' }}
                        />
                        {a.inGuild ? `in guild${a.rank ? ` · ${a.rank}` : ''}` : 'not in guild'}
                      </span>
                      {a.manual &&
                        (canEdit ? (
                          <button
                            onClick={async () => {
                              await client.removeLink(a.account_name)
                              toast('Account unlinked')
                              onChanged()
                            }}
                            className="group flex items-center gap-1 hover:text-red-400"
                            title="Unlink this account"
                          >
                            manual link
                            <X size={11} className="opacity-60 group-hover:opacity-100" />
                          </button>
                        ) : (
                          <span className="text-ink-faint">manual link</span>
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
              <div className="grid grid-cols-2 gap-2">
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
                    <div className="mb-1 text-xs text-ink-faint">Class spread</div>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(m.classSpread)
                        .sort((a, b) => b[1] - a[1])
                        .map(([cls, n]) => (
                          <span key={cls} className="chip">
                            <ClassIcon name={cls} size={13} />
                            {cls} <span className="text-ink-faint">{n}</span>
                          </span>
                        ))}
                    </div>
                  </div>
                )}

                {m.commander && (
                  <div className="col-span-2 mt-1 rounded-md border border-accent/30 bg-accent/5 px-3 py-2">
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-accent-soft">
                      <Crown size={13} /> Commander · {m.commander.runs} raids led
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center text-sm">
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
                    <div className="mb-1 text-xs text-ink-faint">
                      Per account ({m.perAccount.length} accounts combined)
                    </div>
                    <div className="space-y-1">
                      {m.perAccount.map(({ account, m: am }) => (
                        <div
                          key={account}
                          className="flex items-center gap-2 rounded border border-panel-line bg-panel px-2.5 py-1 text-xs"
                        >
                          <span className="min-w-0 flex-1 truncate text-ink" title={account}>
                            {account}
                          </span>
                          <span className="flex shrink-0 items-center gap-1 text-ink-faint">
                            <ClassIcon name={am.mainClass} size={12} />
                            {am.mainClass ?? '—'}
                          </span>
                          <span className="shrink-0 text-ink-faint">{am.raidsAttended} raids</span>
                          <span className="shrink-0 text-ink-faint">{fmtDuration(am.combatTimeMs)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : hasSeries ? (
              <div className="grid grid-cols-2 gap-2">
                <Stat
                  icon={<img src={axibridgeLogo} alt="" className="h-3.5 w-3.5" />}
                  label="Attendance"
                  value={
                    windowedAtt.pct !== null
                      ? `${windowedAtt.pct}% (${windowedAtt.attended}/${windowedAtt.total})`
                      : '—'
                  }
                />
                <div className="col-span-2 text-sm text-ink-faint">
                  No other AxiBridge data for this person's accounts.
                </div>
              </div>
            ) : (
              <div className="text-sm text-ink-faint">
                No AxiBridge data for this person's accounts. Configure report repos in Settings.
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

      <div className="px-6 pb-6 text-xs text-ink-faint">
        {member.aliases.length > 0 && <>Aliases: {member.aliases.join(', ')}</>}
      </div>
    </div>
  )
}

const CONFIDENCE_COLOR: Record<MatchSuggestion['confidence'], string> = {
  strong: '#22c55e',
  likely: '#f59e0b',
  possible: '#78716c'
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
    <div className="mt-2 space-y-2">
      {/* auto-suggested matches */}
      {suggestions.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-ink-faint">Suggested matches</div>
          {suggestions.map((s) => (
            <button
              key={s.candidate.id}
              onClick={() => link(s.candidate.id)}
              className="flex w-full items-center gap-2 rounded-md border border-panel-line bg-raise shadow-raise px-3 py-1.5 text-left text-sm hover:border-accent/50"
            >
              <span
                className="led shrink-0"
                style={{ background: CONFIDENCE_COLOR[s.confidence] }}
                title={s.confidence}
              />
              <span className="min-w-0 truncate text-ink">{s.candidate.displayName}</span>
              {s.candidate.name && s.candidate.name !== s.candidate.displayName && (
                <span className="shrink-0 truncate text-xs text-ink-faint">@{s.candidate.name}</span>
              )}
              <span className="ml-auto shrink-0 chip px-1.5 py-0">
                {s.confidence} · {Math.round(s.score * 100)}%
              </span>
            </button>
          ))}
        </div>
      )}

      {/* manual typeahead */}
      <div className="relative">
        <div className="flex items-center gap-2">
          <Link2 size={13} className="shrink-0 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            placeholder="Or search any Discord user…"
            className="field h-8 py-0 text-sm"
          />
        </div>
        {open && matches.length > 0 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-panel-line bg-panel-raised shadow-lg">
            {matches.map((c) => (
              <button
                key={c.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => link(c.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-panel-line/40"
              >
                <span className="text-ink">{c.displayName}</span>
                {c.name && c.name !== c.displayName && (
                  <span className="text-xs text-ink-faint">@{c.name}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {open && q && matches.length === 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-panel-line bg-panel-raised px-3 py-1.5 text-xs text-ink-faint">
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
          <div className="text-[11px] text-ink-faint">
            Matching <span className="text-ink-dim">{accountName}</span> against{' '}
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

function RoleGlyph({
  role,
  color
}: {
  role: DiscordRole | undefined
  color: string | undefined
}): JSX.Element {
  const icon = roleIcon(role)
  if (icon && /^https?:\/\//.test(icon)) {
    return <img src={icon} alt="" className="h-3 w-3 rounded-sm" />
  }
  if (icon) return <span className="text-[11px] leading-none">{icon}</span>
  return <span className="led h-2 w-2" style={{ background: color ?? '#a8a29e' }} />
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
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {assigned.length === 0 && <span className="text-sm text-ink-faint">No roles.</span>}
        {assigned.map((id) => {
          const role = roleById(id)
          const color = roleColor(role) ?? undefined
          return (
            <span
              key={id}
              className={`chip ${color ? '' : 'text-ink'}`}
              style={
                color
                  ? { borderColor: `${color}80`, background: `${color}1f`, color }
                  : undefined
              }
            >
              <RoleGlyph role={role} color={color} />
              {role?.name ?? id}
              {canEdit && (
                <button
                  onClick={() => act('role_unassign', id)}
                  disabled={busy === id}
                  className="opacity-70 hover:text-red-400 hover:opacity-100 disabled:opacity-40"
                  title="Remove role"
                >
                  <X size={12} />
                </button>
              )}
            </span>
          )
        })}
      </div>

      {canEdit && assignable.length > 0 && (
        <div className="flex gap-2">
          <select
            value={addId}
            onChange={(e) => setAddId(e.target.value)}
            className="field h-8 flex-1 py-0 text-sm"
          >
            <option value="">Add a role…</option>
            {assignable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => addId && act('role_assign', addId).then(() => setAddId(''))}
            disabled={!addId || busy !== null}
            className="btn"
          >
            <Plus size={13} /> Add
          </button>
        </div>
      )}

      {canEdit && (
        <button
          onClick={kick}
          disabled={busy !== null}
          className="btn border-red-500/30 text-red-300 hover:border-red-500/60 hover:text-red-200"
        >
          <UserX size={13} /> Kick from Discord
        </button>
      )}

      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  )
}

function winRate(wins: number, losses: number): number {
  const total = wins + losses
  return total > 0 ? Math.round((wins / total) * 100) : 0
}

function Mini({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-sm font-semibold text-ink">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</div>
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
    <div className="rounded-md border border-panel-line bg-raise shadow-raise px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-ink-faint">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm text-ink">{value}</div>
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
  if (raids.length === 0) return <div className="text-sm text-ink-faint">No raids in this window.</div>
  // raids arrive newest-first; render oldest→newest left→right
  const chrono = [...raids].reverse()
  const shown = chrono.slice(-TIMELINE_CAP)
  const earlier = chrono.length - shown.length
  return (
    <div>
      <div className="flex items-end gap-[3px]">
        {shown.map((r) => {
          const ts = Date.parse(r.date)
          const went = memberEntry(r, accounts) !== null
          return (
            <span
              key={r.id}
              title={`${Number.isNaN(ts) ? r.date : fmtDay(ts)} — ${went ? 'attended' : 'missed'}`}
              className="w-[6px] rounded-sm"
              style={{ height: went ? 24 : 8, background: went ? '#10b981' : '#3a3a40' }}
            />
          )
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-ink-faint">
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
  if (raids.length === 0) return <div className="text-sm text-ink-faint">No raids in this window.</div>
  const rowCls = 'flex w-full items-center gap-2.5 border-b border-panel-line/60 px-3 py-2 last:border-0'
  return (
    <div className="max-h-64 overflow-y-auto rounded-md border border-panel-line">
      {raids.map((r) => {
        const ts = Date.parse(r.date)
        const entry = memberEntry(r, accounts)
        const cells = (
          <>
            <span className="w-24 shrink-0 font-mono text-xs text-ink">
              {Number.isNaN(ts) ? r.date : fmtDay(ts)}
            </span>
            <span className="w-9 shrink-0 text-xs text-ink-faint">
              {Number.isNaN(ts) ? '' : fmtWeekday(ts)}
            </span>
            {entry ? (
              <span className="shrink-0 whitespace-nowrap rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent-soft">
                ✓ Attended
              </span>
            ) : (
              <span className="shrink-0 whitespace-nowrap rounded-full bg-panel-line/40 px-2 py-0.5 text-[11px] font-semibold text-ink-faint">
                — Missed
              </span>
            )}
            {entry?.professions && entry.professions.length > 0 && (
              <span className="flex shrink-0 items-center gap-1">
                {entry.professions.slice(0, 3).map((p) => (
                  <ClassIcon key={p} name={p} size={14} />
                ))}
              </span>
            )}
            <span
              className="ml-auto truncate font-mono text-[11px] text-ink-dim"
              title={entry ? 'combat time · squad time' : undefined}
            >
              {entry ? `${fmtDuration(entry.combatTimeMs)} · ${fmtDuration(entry.squadTimeMs)}` : ''}
            </span>
            {r.reportUrl && <ExternalLink size={12} className="shrink-0 text-ink-faint" />}
          </>
        )
        return r.reportUrl ? (
          <button
            key={r.id}
            onClick={() => void client.openExternal(r.reportUrl!)}
            title="Open the AxiBridge report for this raid"
            className={`${rowCls} text-left transition hover:bg-panel-hover`}
          >
            {cells}
          </button>
        ) : (
          <div key={r.id} className={rowCls}>
            {cells}
          </div>
        )
      })}
    </div>
  )
}
