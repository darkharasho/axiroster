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

/** The identifying part of a GW2 account name: "EmiDarkshadow.8701" -> "EmiDarkshadow". */
function accountNamePart(account: string): string {
  return account.includes('.') ? account.slice(0, account.lastIndexOf('.')) : account
}

/** Normalized whole base: "EmiDarkshadow.8701" -> "emidarkshadow". */
function gw2Base(account: string): string {
  return norm(accountNamePart(account))
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

/**
 * Best match score (0..1) of a GW2 account against one Discord candidate.
 * Both sides are tokenized so a compound account ("EmiDarkshadow" -> [emi,
 * darkshadow]) matches a Discord name on any of its parts — that's how
 * "EmiDarkshadow" links to "Emili Tomoyo" via the shared "emi"/"emili" stem,
 * instead of the "darks" substring winning.
 */
function scoreCandidate(account: string, c: DiscordCandidate): number {
  const full = gw2Base(account)
  if (!full) return 0
  const aToks = tokens(accountNamePart(account))
  const fields = [c.displayName, c.name].filter(Boolean)
  let best = 0
  for (const field of fields) {
    const f = norm(field)
    if (!f) continue
    if (f === full) {
      best = Math.max(best, 1)
      continue
    }
    const cToks = tokens(field)
    // token-to-token across the account's parts and the candidate's parts
    for (const at of aToks) {
      if (at.length < 3) continue
      for (const ct of cToks) {
        if (ct.length < 3) continue
        if (at === ct) {
          best = Math.max(best, 0.92)
        } else if (at.startsWith(ct) || ct.startsWith(at)) {
          const short = Math.min(at.length, ct.length)
          const long = Math.max(at.length, ct.length)
          best = Math.max(best, 0.7 + 0.2 * (short / long))
        }
      }
    }
    // whole-string containment / edit distance as a floor
    if (full.includes(f) || f.includes(full)) {
      const short = Math.min(f.length, full.length)
      const long = Math.max(f.length, full.length)
      best = Math.max(best, 0.6 + 0.3 * (short / long))
    }
    best = Math.max(best, ratio(full, f))
  }
  return best
}

// Only surface matches above 50% — at/below that the name overlap is too weak
// to be a useful suggestion.
const THRESHOLD = 0.5

/** The single highest-scoring candidate, ignoring the threshold (for diagnostics
 *  — tells us if the right person is even in the pool). Null if no candidates. */
export function bestMatch(
  accountName: string,
  candidates: DiscordCandidate[]
): { candidate: DiscordCandidate; score: number } | null {
  let best: { candidate: DiscordCandidate; score: number } | null = null
  for (const candidate of candidates) {
    const score = scoreCandidate(accountName, candidate)
    if (!best || score > best.score) best = { candidate, score }
  }
  return best
}

export function suggestMatches(
  accountName: string,
  candidates: DiscordCandidate[],
  limit = 5
): MatchSuggestion[] {
  return candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(accountName, candidate) }))
    .filter((m) => m.score > THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((m) => ({
      ...m,
      confidence: m.score >= 0.9 ? 'strong' : m.score >= 0.7 ? 'likely' : 'possible'
    }))
}
