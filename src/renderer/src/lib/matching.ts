import type { DiscordCandidate } from '../../../preload/index.d'

// Suggest likely Discord users for a GW2 account. People reuse names across
// GW2 and Discord, so we compare the account's base name (before the .1234
// discriminator) against each Discord display name / username using exact,
// token, substring, and edit-distance signals. Pure + renderer-side.

export interface MatchSuggestion {
  candidate: DiscordCandidate
  /** 0..1 confidence. */
  score: number
  confidence: 'strong' | 'likely' | 'possible'
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The identifying part of a GW2 account name: "Harasho.4281" -> "harasho". */
function gw2Base(account: string): string {
  const beforeDot = account.includes('.') ? account.slice(0, account.lastIndexOf('.')) : account
  return norm(beforeDot)
}

/** Split a display name into normalized word tokens (spaces, separators, camelCase). */
function tokens(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s._\-|#~+*()[\]{}<>!?,]+/)
    .map(norm)
    .filter(Boolean)
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev = cur
  }
  return prev[b.length]
}

function ratio(a: string, b: string): number {
  if (!a || !b) return 0
  const max = Math.max(a.length, b.length)
  return 1 - levenshtein(a, b) / max
}

/** Best match score (0..1) of a GW2 base name against one Discord candidate. */
function scoreCandidate(base: string, c: DiscordCandidate): number {
  if (!base) return 0
  const fields = [c.displayName, c.name].filter(Boolean)
  let best = 0
  for (const field of fields) {
    const f = norm(field)
    if (!f) continue
    if (f === base) {
      best = Math.max(best, 1)
      continue
    }
    const toks = tokens(field)
    // exact token match (e.g. base "harasho" in "Radiant Harasho")
    if (toks.includes(base)) best = Math.max(best, 0.92)
    // a token is a prefix of the base or vice-versa ("emi" ~ "emily"), min 3 chars
    for (const t of toks) {
      if (t.length < 3 || base.length < 3) continue
      if (t.startsWith(base) || base.startsWith(t)) {
        const short = Math.min(t.length, base.length)
        const long = Math.max(t.length, base.length)
        best = Math.max(best, 0.7 + 0.2 * (short / long))
      }
    }
    // one contains the other, scaled by how much of the longer string matches
    if (f.includes(base) || base.includes(f)) {
      const short = Math.min(f.length, base.length)
      const long = Math.max(f.length, base.length)
      best = Math.max(best, 0.6 + 0.3 * (short / long))
    }
    best = Math.max(best, ratio(base, f))
  }
  return best
}

// Only surface matches above 50% — at/below that the name overlap is too weak
// to be a useful suggestion.
const THRESHOLD = 0.5

export function suggestMatches(
  accountName: string,
  candidates: DiscordCandidate[],
  limit = 5
): MatchSuggestion[] {
  const base = gw2Base(accountName)
  return candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(base, candidate) }))
    .filter((m) => m.score > THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((m) => ({
      ...m,
      confidence: m.score >= 0.9 ? 'strong' : m.score >= 0.7 ? 'likely' : 'possible'
    }))
}
