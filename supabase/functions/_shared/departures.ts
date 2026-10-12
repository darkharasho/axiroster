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
