// supabase/functions/_shared/departures.ts
//
// Departed-members history: one record per GW2 account that left or was kicked,
// stored as a reserved `departure:<account lc>` annotation row with this JSON in
// `notes`. The canonical home is here so the refresh-roster edge function (Deno)
// can run detection; src/shared/departures.ts re-exports it for desktop + web.
// Keep it dependency-free: no imports, structural types only, pure (no IO).

export type DepartureKind = 'left' | 'kicked' | 'unknown'
export type DepartureSource = 'gw2-log' | 'roster-diff' | 'manual'

export interface DepartureEpisode {
  /** unknown = the roster diff saw them vanish with no matching log event. */
  kind: DepartureKind
  /** GW2 account that kicked them (kicked only). */
  actor: string | null
  /** ISO time: the log time, or the detection time for a roster diff. */
  at: string
  source: DepartureSource
  /** Audit event uid when source = gw2-log; the idempotency key. */
  auditUid: string | null
  /** Officer-entered, per episode. Detection never writes it. */
  reason: string
  rejoinedAt: string | null
}

export interface DepartureDoc {
  /** Display casing, e.g. "Foo.1234". */
  account: string
  /** Discord link: auto, confirmed suggestion, or manual pick. */
  memberId: string | null
  /** Discord ids an officer marked "not them". */
  dismissedSuggestions: string[]
  /** Officer note about the person. */
  note: string
  /** Newest first. */
  episodes: DepartureEpisode[]
}

export const DEPARTURE_PREFIX = 'departure:'

const lc = (s: string): string => s.trim().toLowerCase()

export const departureKey = (account: string): string => DEPARTURE_PREFIX + lc(account)

export const accountFromKey = (key: string): string =>
  key.startsWith(DEPARTURE_PREFIX) ? key.slice(DEPARTURE_PREFIX.length) : key

export function emptyDepartureDoc(account: string): DepartureDoc {
  return { account: account.trim(), memberId: null, dismissedSuggestions: [], note: '', episodes: [] }
}

const KINDS = new Set<string>(['left', 'kicked', 'unknown'])
const SOURCES = new Set<string>(['gw2-log', 'roster-diff', 'manual'])

const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
export const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))

function parseEpisode(raw: unknown): DepartureEpisode | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isIso(r.at)) return null
  return {
    kind: KINDS.has(r.kind as string) ? (r.kind as DepartureKind) : 'unknown',
    actor: strOrNull(r.actor),
    at: r.at,
    source: SOURCES.has(r.source as string) ? (r.source as DepartureSource) : 'manual',
    auditUid: strOrNull(r.auditUid),
    reason: typeof r.reason === 'string' ? r.reason : '',
    rejoinedAt: isIso(r.rejoinedAt) ? r.rejoinedAt : null
  }
}

export function sortEpisodes(eps: DepartureEpisode[]): DepartureEpisode[] {
  return [...eps].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/** Never throws: corrupt/empty JSON yields an empty doc named from the key. */
export function parseDepartureDoc(key: string, notes: string): DepartureDoc {
  const fallback = emptyDepartureDoc(accountFromKey(key))
  if (!notes || !notes.trim()) return fallback
  try {
    const r = JSON.parse(notes) as Record<string, unknown> | null
    if (!r || typeof r !== 'object' || Array.isArray(r)) return fallback
    const episodes = Array.isArray(r.episodes)
      ? r.episodes.map(parseEpisode).filter((e): e is DepartureEpisode => e !== null)
      : []
    return {
      account: typeof r.account === 'string' && r.account.trim() ? r.account.trim() : fallback.account,
      memberId: strOrNull(r.memberId),
      dismissedSuggestions: Array.isArray(r.dismissedSuggestions)
        ? r.dismissedSuggestions.filter((x): x is string => typeof x === 'string' && x.length > 0)
        : [],
      note: typeof r.note === 'string' ? r.note : '',
      episodes: sortEpisodes(episodes)
    }
  } catch {
    return fallback
  }
}

export const serializeDepartureDoc = (doc: DepartureDoc): string => JSON.stringify(doc)

export const latestEpisode = (doc: DepartureDoc): DepartureEpisode | null => doc.episodes[0] ?? null

/** Gone right now: the latest episode has no rejoin. */
export function isOpen(doc: DepartureDoc): boolean {
  const l = latestEpisode(doc)
  return l !== null && l.rejoinedAt === null
}

// ---- merge rules -------------------------------------------------------------

/** A gw2-log episode replaces an `unknown` roster-diff episode within this window. */
export const UPGRADE_WINDOW_MS = 7 * 86_400_000
/** The roster diff is skipped when MORE than this fraction AND more than
 *  MASS_DROP_MIN accounts vanish at once (API hiccup, wrong guild, purge). */
export const MASS_DROP_FRACTION = 0.25
export const MASS_DROP_MIN = 5
/** A presence-based rejoin ignores departures this recent: /members can lag the log. */
export const PRESENCE_REJOIN_MARGIN_MS = 15 * 60 * 1000

/** Minimal roster member (InGameMemberRaw / the edge GuildMember fit this). */
export interface DepartureRosterMember {
  name: string
  joined?: string | null
}

/** Minimal audit event (src/main/auditNormalize.ts AuditEvent fits this). For a
 *  gw2 `kick`, actor = the account removed and target = kicked_by. */
export interface DepartureAuditEvent {
  uid: string
  source: string
  type: string
  time: string
  actor?: string
  target?: string
}

export interface DepartureLink {
  accountName: string
  memberId: string
}

/** Fold one gw2-log episode in. Dedupes by auditUid; upgrades a nearby unknown
 *  roster-diff episode (keeping the officer's reason and any rejoin). */
export function applyLogEpisode(doc: DepartureDoc, ep: DepartureEpisode): boolean {
  if (ep.auditUid && doc.episodes.some((e) => e.auditUid === ep.auditUid)) return false
  const t = Date.parse(ep.at)
  const idx = doc.episodes.findIndex(
    (e) =>
      e.source === 'roster-diff' &&
      e.kind === 'unknown' &&
      (e.rejoinedAt === null || t < Date.parse(e.rejoinedAt)) &&
      Math.abs(Date.parse(e.at) - t) <= UPGRADE_WINDOW_MS
  )
  if (idx >= 0) {
    const old = doc.episodes[idx]
    doc.episodes[idx] = { ...ep, reason: old.reason, rejoinedAt: old.rejoinedAt }
  } else {
    doc.episodes.push(ep)
  }
  doc.episodes = sortEpisodes(doc.episodes)
  return true
}

/** Record a roster-diff departure, unless they are already recorded as gone. */
export function applyDiffEpisode(doc: DepartureDoc, at: string): boolean {
  if (isOpen(doc)) return false
  doc.episodes = sortEpisodes([
    ...doc.episodes,
    { kind: 'unknown', actor: null, at, source: 'roster-diff', auditUid: null, reason: '', rejoinedAt: null }
  ])
  return true
}

/** Close the latest open episode. A rejoin can't predate the departure it closes. */
export function applyRejoin(doc: DepartureDoc, at: string): boolean {
  const l = latestEpisode(doc)
  if (!l || l.rejoinedAt !== null) return false
  if (!(Date.parse(at) > Date.parse(l.at))) return false
  l.rejoinedAt = at
  return true
}

// ---- detection ---------------------------------------------------------------

export interface DetectInput {
  /** Account names seen at the last successful pull; null = no snapshot yet. */
  previous: string[] | null
  /** The fresh in-game roster; [] means the pull failed or was empty. */
  current: DepartureRosterMember[]
  /** Audit events of any age; only gw2 kick/joined are used. */
  auditEvents: DepartureAuditEvent[]
  /** Current records, keyed by departureKey(). Never mutated. */
  existing: Map<string, DepartureDoc>
  links: DepartureLink[]
  now: string
}

export type DiffSkip = 'no-snapshot' | 'empty-pull' | 'mass-drop'

export interface DetectResult {
  /** Only docs that changed, ready to write. */
  changed: DepartureDoc[]
  /** Accounts in `previous` missing from `current` (previous casing). Empty
   *  unless there was a snapshot and a non-empty pull; set even on mass-drop. */
  vanished: string[]
  skipped: DiffSkip | null
}

const clone = (d: DepartureDoc): DepartureDoc => JSON.parse(JSON.stringify(d)) as DepartureDoc

export function detectDepartures(input: DetectInput): DetectResult {
  const work = new Map<string, DepartureDoc>()
  const changed = new Set<string>()
  const known = (account: string): boolean => {
    const k = departureKey(account)
    return work.has(k) || input.existing.has(k)
  }
  const get = (account: string): DepartureDoc => {
    const k = departureKey(account)
    let d = work.get(k)
    if (!d) {
      const ex = input.existing.get(k)
      d = ex ? clone(ex) : emptyDepartureDoc(account)
      work.set(k, d)
    }
    return d
  }
  const mark = (account: string): void => void changed.add(departureKey(account))

  // 1. Audit fold, oldest first so kick → joined → kick sequences replay in order.
  //    The first run over the stored log IS the backfill.
  const events = input.auditEvents
    .filter((e) => e.source === 'gw2' && (e.type === 'kick' || e.type === 'joined') && e.actor && isIso(e.time))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
  for (const e of events) {
    const account = (e.actor as string).trim()
    if (e.type === 'kick') {
      const by = e.target?.trim() || null
      const kind: DepartureKind = by === null ? 'unknown' : lc(by) === lc(account) ? 'left' : 'kicked'
      const ep: DepartureEpisode = {
        kind,
        actor: kind === 'kicked' ? by : null,
        at: e.time,
        source: 'gw2-log',
        auditUid: e.uid,
        reason: '',
        rejoinedAt: null
      }
      if (applyLogEpisode(get(account), ep)) mark(account)
    } else if (known(account) && applyRejoin(get(account), e.time)) {
      mark(account)
    }
  }

  // 2. Roster diff, behind the safety guards.
  let skipped: DiffSkip | null = null
  let vanished: string[] = []
  if (input.previous === null) skipped = 'no-snapshot'
  else if (input.current.length === 0) skipped = 'empty-pull'
  else {
    const present = new Set(input.current.map((m) => lc(m.name)))
    const seen = new Set<string>()
    const prevUnique = new Set(input.previous.map(lc).filter(Boolean))
    vanished = input.previous.filter((n) => {
      const k = lc(n)
      if (!k || present.has(k) || seen.has(k)) return false
      seen.add(k)
      return true
    })
    const massDrop =
      vanished.length > MASS_DROP_MIN && vanished.length > prevUnique.size * MASS_DROP_FRACTION
    if (massDrop) skipped = 'mass-drop'
    else for (const name of vanished) if (applyDiffEpisode(get(name), input.now)) mark(name)
  }

  // 3. Rejoin by roster presence.
  for (const m of input.current) {
    if (!known(m.name)) continue
    const d = get(m.name)
    const l = latestEpisode(d)
    if (!l || l.rejoinedAt !== null) continue
    if (Date.parse(input.now) - Date.parse(l.at) < PRESENCE_REJOIN_MARGIN_MS) continue
    const at = isIso(m.joined) && Date.parse(m.joined) > Date.parse(l.at) ? m.joined : input.now
    if (applyRejoin(d, at)) mark(m.name)
  }

  // 4. Auto-link: fill memberId only while it is null.
  const linkBy = new Map(input.links.map((l) => [lc(l.accountName), l.memberId]))
  for (const k of new Set([...input.existing.keys(), ...work.keys()])) {
    const current = work.get(k) ?? input.existing.get(k)
    if (!current || current.memberId || current.episodes.length === 0) continue
    const id = linkBy.get(lc(current.account))
    if (!id) continue
    get(current.account).memberId = id
    changed.add(k)
  }

  const out = [...changed]
    .map((k) => work.get(k))
    .filter((d): d is DepartureDoc => Boolean(d && d.episodes.length > 0))
  return { changed: out, vanished, skipped }
}
