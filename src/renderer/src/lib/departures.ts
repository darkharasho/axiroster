// src/renderer/src/lib/departures.ts
//
// Pure view model for the Departed tab, the Roster banner and the "Previously
// kicked" badges. Departure docs (shared/departures) are joined with the live
// reconciled roster at read time, so Discord state is never stored stale.
import type { ReconciledMember } from '../../../preload/index.d'
import type { Tone } from './status'
import {
  departureKey,
  latestEpisode,
  sortEpisodes,
  type DepartureDoc,
  type DepartureEpisode,
  type DepartureKind
} from '../../../shared/departures'

export type DepartedFilter = 'all' | 'flagged' | 'left' | 'kicked' | 'unknown' | 'rejoined'
export type DepartedStatus = 'left' | 'kicked' | 'unknown' | 'rejoined'

export const DEPARTED_FILTERS: DepartedFilter[] = ['all', 'flagged', 'left', 'kicked', 'unknown', 'rejoined']

export const DEPARTED_META: Record<Exclude<DepartedFilter, 'all'>, { tone: Tone; label: string }> = {
  // Still holding the role is the thing to act on — a verdict, so danger.
  flagged: { tone: 'danger', label: 'Still has member role' },
  left: { tone: 'idle', label: 'Left' },
  kicked: { tone: 'danger', label: 'Kicked' },
  // Seen to vanish with no log entry: a fact about our records, so meta.
  unknown: { tone: 'meta', label: 'Unknown' },
  rejoined: { tone: 'ok', label: 'Rejoined' }
}

const lc = (s: string): string => s.trim().toLowerCase()

// ---- suggestions -------------------------------------------------------------

export interface RoleHolder {
  id: string
  name: string
  displayName: string
}

/** "Foo.1234" → "foo": the part of a GW2 account people reuse as a handle. */
export const handleOf = (account: string): string => lc(account).replace(/\.\d{4}$/, '')

/** Discord members holding the member role who are NOT in the guild through any
 *  account — someone still in the guild via another account is not a departure. */
export function roleHolders(members: ReconciledMember[]): RoleHolder[] {
  return members
    .filter((m) => m.memberId && m.hasMemberRole && !m.inGuild)
    .map((m) => ({ id: m.memberId as string, name: m.discordName ?? '', displayName: m.displayName ?? '' }))
}

/** Partial matches need at least this much handle, or "al" matches half the server. */
const MIN_PARTIAL = 3

export function suggestMatch(account: string, holders: RoleHolder[], dismissed: string[]): RoleHolder | null {
  const h = handleOf(account)
  if (!h) return null
  const pool = holders.filter((x) => !dismissed.includes(x.id))
  const names = (x: RoleHolder): string[] => [x.name, x.displayName].map(lc).filter(Boolean)
  const exact = pool.filter((x) => names(x).includes(h))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1 || h.length < MIN_PARTIAL) return null
  const partial = pool.filter((x) => names(x).some((n) => n.includes(h)))
  return partial.length === 1 ? partial[0] : null
}

// ---- rows --------------------------------------------------------------------

export interface DepartedRow {
  key: string
  doc: DepartureDoc
  latest: DepartureEpisode
  status: DepartedStatus
  /** Confirmed/linked Discord id: the doc's own, else an account link on the roster. */
  memberId: string | null
  member: ReconciledMember | null
  suggestion: RoleHolder | null
  flagged: boolean
}

export function buildDepartedRows(
  docs: DepartureDoc[],
  members: ReconciledMember[],
  memberRoleId: string | null
): DepartedRow[] {
  const holders = roleHolders(members)
  const out: DepartedRow[] = []
  for (const doc of docs) {
    const latest = latestEpisode(doc)
    if (!latest) continue
    const acct = lc(doc.account)
    const linkedBy = members.find((m) => m.memberId && m.accounts.some((a) => lc(a.account_name) === acct))
    const memberId = doc.memberId ?? linkedBy?.memberId ?? null
    const member = memberId ? (members.find((m) => m.memberId === memberId) ?? null) : null
    out.push({
      key: departureKey(doc.account),
      doc,
      latest,
      status: latest.rejoinedAt ? 'rejoined' : latest.kind,
      memberId,
      member,
      suggestion: memberId ? null : suggestMatch(doc.account, holders, doc.dismissedSuggestions),
      // Someone still in the guild through another account (a departed alt) is not flagged.
      flagged:
        Boolean(memberRoleId) && Boolean(member?.hasMemberRole) && !member?.inGuild && latest.rejoinedAt === null
    })
  }
  return out
}

export function sortDepartedRows(rows: DepartedRow[]): DepartedRow[] {
  return [...rows].sort(
    (a, b) => Number(b.flagged) - Number(a.flagged) || Date.parse(b.latest.at) - Date.parse(a.latest.at)
  )
}

export function filterDepartedRows(rows: DepartedRow[], filter: DepartedFilter, query: string): DepartedRow[] {
  const q = lc(query)
  return rows.filter((r) => {
    if (filter === 'flagged' && !r.flagged) return false
    if (filter !== 'all' && filter !== 'flagged' && r.status !== filter) return false
    if (!q) return true
    const hay = [
      r.doc.account,
      r.doc.note,
      r.member?.discordName,
      r.member?.displayName,
      r.member?.label,
      ...r.doc.episodes.flatMap((e) => [e.actor, e.reason])
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}

export function countDeparted(rows: DepartedRow[]): Record<DepartedFilter, number> {
  const c: Record<DepartedFilter, number> = { all: rows.length, flagged: 0, left: 0, kicked: 0, unknown: 0, rejoined: 0 }
  for (const r of rows) {
    c[r.status]++
    if (r.flagged) c.flagged++
  }
  return c
}

// ---- doc edits (officer fields; each returns a new doc) ----------------------

export function replaceDoc(docs: DepartureDoc[], doc: DepartureDoc): DepartureDoc[] {
  const k = departureKey(doc.account)
  const i = docs.findIndex((d) => departureKey(d.account) === k)
  return i >= 0 ? docs.map((d, j) => (j === i ? doc : d)) : [...docs, doc]
}

export const linkDoc = (doc: DepartureDoc, memberId: string | null): DepartureDoc => ({ ...doc, memberId })

export const dismissSuggestion = (doc: DepartureDoc, id: string): DepartureDoc =>
  doc.dismissedSuggestions.includes(id) ? doc : { ...doc, dismissedSuggestions: [...doc.dismissedSuggestions, id] }

export const setDocNote = (doc: DepartureDoc, note: string): DepartureDoc => ({ ...doc, note })

/** A stable handle on one episode that survives a fresh re-read of the doc
 *  (array positions don't: detection may insert episodes in between). */
export interface EpisodeRef {
  auditUid: string | null
  at: string
  source: DepartureEpisode['source']
}

export const episodeRef = (e: DepartureEpisode): EpisodeRef => ({ auditUid: e.auditUid, at: e.at, source: e.source })

export function matchesEpisode(e: DepartureEpisode, ref: EpisodeRef): boolean {
  if (ref.auditUid) return e.auditUid === ref.auditUid
  return !e.auditUid && e.source === ref.source && Date.parse(e.at) === Date.parse(ref.at)
}

/** Set the reason on the first episode matching `ref`; no match → doc unchanged. */
export function setEpisodeReason(doc: DepartureDoc, ref: EpisodeRef, reason: string): DepartureDoc {
  const i = doc.episodes.findIndex((e) => matchesEpisode(e, ref))
  if (i < 0) return doc
  return { ...doc, episodes: doc.episodes.map((e, j) => (j === i ? { ...e, reason } : e)) }
}

export function addManualEpisode(
  doc: DepartureDoc,
  ep: { kind: DepartureKind; actor: string | null; at: string }
): DepartureDoc {
  return {
    ...doc,
    episodes: sortEpisodes([
      ...doc.episodes,
      {
        kind: ep.kind,
        actor: ep.kind === 'kicked' ? ep.actor?.trim() || null : null,
        at: ep.at,
        source: 'manual',
        auditUid: null,
        reason: '',
        rejoinedAt: null
      }
    ])
  }
}

// ---- "Previously kicked" -----------------------------------------------------

export interface PreviousKick {
  account: string
  episode: DepartureEpisode
}

/** The most recent `kicked` episode for anyone matching these accounts or Discord id. */
export function previousKick(
  docs: DepartureDoc[],
  who: { accounts: string[]; memberId: string | null }
): PreviousKick | null {
  const accts = new Set(who.accounts.filter(Boolean).map(lc))
  let best: PreviousKick | null = null
  for (const d of docs) {
    if (!accts.has(lc(d.account)) && !(who.memberId && d.memberId === who.memberId)) continue
    for (const e of d.episodes) {
      if (e.kind !== 'kicked') continue
      if (!best || Date.parse(e.at) > Date.parse(best.episode.at)) best = { account: d.account, episode: e }
    }
  }
  return best
}

export function kickTooltip(k: PreviousKick): string {
  const date = new Date(k.episode.at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  const by = k.episode.actor ?? 'an officer'
  return `Kicked by ${by} on ${date}${k.episode.reason ? `: ${k.episode.reason}` : ''} (${k.account})`
}

// ---- remove member role ------------------------------------------------------

export function roleActionBlocker(ctx: {
  canEdit: boolean
  discordConfigured: boolean
  memberRoleId: string | null
}): string | null {
  if (!ctx.canEdit) return 'Read-only access to this workspace'
  if (!ctx.discordConfigured) return 'Connect AxiTools and a Discord server in Settings'
  if (!ctx.memberRoleId) return 'Set a member role in guild Settings'
  return null
}

export interface RoleTarget {
  key: string
  memberId: string
  label: string
}

type ActResult = { ok: true; data: unknown } | { ok: false; error: string }

/** One at a time (Discord rate limits), never stopping at a failure. */
export async function removeRoles(
  targets: RoleTarget[],
  act: (memberId: string) => Promise<ActResult>,
  onProgress?: (done: number, total: number) => void
): Promise<{ removed: string[]; failed: { key: string; label: string; error: string }[] }> {
  const removed: string[] = []
  const failed: { key: string; label: string; error: string }[] = []
  let done = 0
  for (const t of targets) {
    try {
      const res = await act(t.memberId)
      if (res.ok) removed.push(t.key)
      else failed.push({ key: t.key, label: t.label, error: res.error })
    } catch (e) {
      failed.push({ key: t.key, label: t.label, error: (e as Error).message })
    }
    onProgress?.(++done, targets.length)
  }
  return { removed, failed }
}
