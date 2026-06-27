//
// Tag colors are a global, reusable vocabulary: a tag name maps to a palette
// color id, saved once and applied roster-wide. The map is persisted as JSON in
// the reserved `meta:tags` annotation row (see main/index.ts). Pure module — no
// React — so it is node-testable. Pills render via inline style (hex), mirroring
// the role-chip pattern in MemberDetail's DiscordRolesPanel.

export type TagColorId = 'emerald' | 'blue' | 'amber' | 'rose' | 'violet' | 'slate'

export const PALETTE: ReadonlyArray<{ id: TagColorId; dot: string; text: string }> = [
  { id: 'emerald', dot: '#10b981', text: '#5eead4' },
  { id: 'blue', dot: '#3b82f6', text: '#93c5fd' },
  { id: 'amber', dot: '#f59e0b', text: '#fcd34d' },
  { id: 'rose', dot: '#f43f5e', text: '#fda4af' },
  { id: 'violet', dot: '#8b5cf6', text: '#c4b5fd' },
  { id: 'slate', dot: '#94a3b8', text: '#cbd5e1' }
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

export function tagStyle(id: TagColorId): { background: string; borderColor: string; color: string } {
  const p = BY_ID.get(id) ?? BY_ID.get('slate')!
  return { background: `${p.dot}1f`, borderColor: `${p.dot}40`, color: p.text }
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
