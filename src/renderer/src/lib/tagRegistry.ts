//
// Tag colors are a global, reusable vocabulary: a tag name maps to a palette
// color id, saved once and applied roster-wide. The map is persisted as JSON in
// the reserved `meta:tags` annotation row (see main/index.ts). Pure module — no
// React — so it is node-testable.
//
// This is a palette the *data* owns, not the design language's: a guild picks
// what "commander" looks like. RULES.md rule 10 is the route for exactly that —
// a domain colour arrives per-instance through --axi-series, and the chip is
// filled with it at full strength (rule 2: never a tint of it over the ground).

import type { CSSProperties } from 'react'

export type TagColorId = 'emerald' | 'blue' | 'amber' | 'rose' | 'violet' | 'slate'

export const PALETTE: ReadonlyArray<{ id: TagColorId; dot: string }> = [
  { id: 'emerald', dot: '#34d399' },
  { id: 'blue', dot: '#3b82f6' },
  { id: 'amber', dot: '#f59e0b' },
  { id: 'rose', dot: '#f43f5e' },
  { id: 'violet', dot: '#8b5cf6' },
  { id: 'slate', dot: '#94a3b8' }
]

const BY_ID = new Map(PALETTE.map((p) => [p.id, p]))
const KNOWN = new Set(PALETTE.map((p) => p.id))

export function defaultColorFor(name: string): TagColorId {
  const s = name.toLowerCase()
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length].id
}

export type TagRegistry = Record<string, TagColorId>

export function resolveColorId(name: string, reg: TagRegistry): TagColorId {
  return reg[name.toLowerCase()] ?? defaultColorFor(name)
}

export function dotColor(id: TagColorId): string {
  return (BY_ID.get(id) ?? BY_ID.get('slate')!).dot
}

/**
 * The per-instance knob a tag chip is drawn from. `.ar-tag` reads --axi-series
 * for its fill, so the tag's own colour arrives as data and the component keeps
 * no colour of its own.
 */
export function tagStyle(id: TagColorId): CSSProperties {
  return { '--axi-series': dotColor(id) } as CSSProperties
}

export function parseRegistry(notes: string): TagRegistry {
  if (!notes || !notes.trim()) return {}
  try {
    const raw = JSON.parse(notes)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: TagRegistry = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string' && KNOWN.has(v as TagColorId)) out[k.toLowerCase()] = v as TagColorId
    }
    return out
  } catch {
    return {}
  }
}

export function serializeRegistry(reg: TagRegistry): string {
  return JSON.stringify(reg)
}

export function setTagColor(reg: TagRegistry, name: string, id: TagColorId): TagRegistry {
  return { ...reg, [name.toLowerCase()]: id }
}
