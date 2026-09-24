import type { RosterStatus } from '../../../preload/index.d'

/**
 * The design language's five inks, named by what they assert rather than by
 * colour, so a component picks an ink by name instead of carrying a hex.
 * `meta` is the reserved cool ink — annotation, never a verdict on how bad
 * something is (RULES.md rule 6); `idle` is the neutral ramp, for a state that
 * is the absence of information rather than a status.
 */
export type Tone = 'ok' | 'warn' | 'danger' | 'meta' | 'idle'

/**
 * The classes that draw a tone as the family's diamond (rule 7). The package
 * ships an ink for every state the language names and the bare `.axi-diamond`
 * is already the meta ink, so the app layer only supplies `idle` — which is
 * not a verdict but the absence of one, and so belongs on the neutral ramp.
 */
export function toneDiamond(tone: Tone): string {
  if (tone === 'meta') return 'axi-diamond'
  if (tone === 'idle') return 'axi-diamond ar-diamond--idle'
  return `axi-diamond axi-diamond--${tone}`
}

/** The same tone as a bare ink utility, for a figure or a line of text. */
export function toneInk(tone: Tone): string {
  return tone === 'idle' ? 'ar-ink-faint' : `ar-ink-${tone}`
}

/**
 * The tone as a raw `var()` string, for the per-instance knobs that take a
 * colour rather than a class — --axi-pill-fill and --axi-card-strip. This is
 * the one place a token belongs in a style attribute: the knob is read through
 * a fallback and set on one element, which is exactly what the language
 * documents it for.
 */
export function toneVar(tone: Tone): string {
  return tone === 'idle' ? 'var(--axi-text-faint)' : `var(--axi-${tone})`
}

/** Status ink + human label for each reconciliation status. */
export const STATUS_META: Record<RosterStatus, { tone: Tone; label: string }> = {
  // In the guild and keyed: the roster agrees with the game.
  verified: { tone: 'ok', label: 'In guild' },
  // Known to us but unverified against the API — a fact about our records, not
  // a verdict on the member, so it takes the meta ink.
  linked: { tone: 'meta', label: 'Linked' },
  'no-key': { tone: 'warn', label: 'No GW2 key' },
  'left-guild': { tone: 'danger', label: 'Left guild' },
  unlinked: { tone: 'idle', label: 'Unlinked' }
}

export function fmtDuration(ms: number): string {
  if (!ms || ms < 0) return '—'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function fmtRelative(iso: string | null): string {
  if (!iso) return '—'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return '—'
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}
