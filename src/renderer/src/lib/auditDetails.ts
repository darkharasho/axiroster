// src/renderer/src/lib/auditDetails.ts
//
// Parses the AxiTools bot's audit `details` blob into a structured model the
// Guild Log can render fully (the blob is "Key: value" lines where message
// bodies are triple-backtick fenced — see the producer contract in
// docs/superpowers/specs/2026-07-28-guild-log-detail-rendering-design.md).
// Pure and defensive: malformed input degrades to plain fields, never throws.

/** A run of action/preview text; `b` marks an emphasized span. */
export interface Seg {
  t: string
  b?: boolean
}

export interface DetailField {
  key: string
  /** Fence markers stripped; may be multi-line. */
  value: string
  /** Value was ``` wrapped (message body / list). */
  fenced: boolean
  /** Value matched the bot's "Unavailable (…)" sentinel. */
  unavailable: boolean
}

export interface DetailModel {
  /** Ordered as emitted; empty => the row has nothing to expand. */
  fields: DetailField[]
}

/** Fixed bot sentences that restate what the rendered verb already says. */
const BOILERPLATE = new Set([
  'Member joined the server.',
  'Member left the server.',
  'Member was kicked.',
  'Member was banned.',
  'Member was unbanned.',
  'Voice state updated.'
])

const KEY_LINE = /^([A-Z][A-Za-z0-9 ]{0,30}):\s?(.*)$/

export function parseDetails(details: string | undefined): DetailModel {
  if (!details) return { fields: [] }
  const fields: DetailField[] = []
  let open: DetailField | null = null // fenced field still collecting lines
  for (const line of details.split('\n')) {
    if (open) {
      if (line.trim() === '```') open = null
      else open.value = open.value ? `${open.value}\n${line}` : line
      continue
    }
    const m = KEY_LINE.exec(line)
    if (m) {
      const [, key, rest] = m
      if (key === 'Channel') continue // rendered as the channel chip already
      const field: DetailField = { key, value: rest, fenced: false, unavailable: false }
      if (rest.startsWith('```')) {
        field.fenced = true
        field.value = rest.slice(3)
        open = field
      }
      fields.push(field)
      continue
    }
    // Keyless line: continuation of the previous field, else a bare Details field.
    const prev = fields[fields.length - 1]
    if (prev) prev.value = prev.value ? `${prev.value}\n${line}` : line
    else fields.push({ key: 'Details', value: line, fenced: false, unavailable: false })
  }
  const kept: DetailField[] = []
  for (const f of fields) {
    f.value = f.value.replace(/^\n+|\n+$/g, '')
    if (f.key === 'Details' && BOILERPLATE.has(f.value)) continue
    if (f.value.length === 0) continue
    f.unavailable = /^Unavailable \(/.test(f.value)
    kept.push(f)
  }
  return { fields: kept }
}

/** One renderable unit of a detail card. Category precedence per field:
 *  diff pair > ± tags (Added/Removed) > unavailable > fenced/multi-line block
 *  > "a -> b" arrow > plain key-value. Key semantics beat value shape so a
 *  fenced Added list still renders as tags, not a content block. */
export type DetailBlock =
  | { kind: 'diff'; before: DetailField; after: DetailField }
  | { kind: 'tags'; op: 'add' | 'remove'; items: { label: string; unresolved: boolean }[] }
  | { kind: 'unavailable'; field: DetailField }
  | { kind: 'block'; field: DetailField }
  | { kind: 'arrow'; key: string; from: string; to: string }
  | { kind: 'kv'; key: string; value: string }

const ROLE_MENTION = /^<@&(\d+)>$/
const ARROW = /^(.+?) -> (.+)$/

function tagItems(value: string): { label: string; unresolved: boolean }[] {
  return value
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = ROLE_MENTION.exec(s)
      return m ? { label: `@${m[1]}`, unresolved: true } : { label: s, unresolved: false }
    })
}

export function detailBlocks(model: DetailModel): DetailBlock[] {
  const blocks: DetailBlock[] = []
  const used = new Set<DetailField>()
  const before = model.fields.find((f) => f.key === 'Before')
  const after = model.fields.find((f) => f.key === 'After')
  if (before && after) {
    blocks.push({ kind: 'diff', before, after })
    used.add(before)
    used.add(after)
  }
  for (const f of model.fields) {
    if (used.has(f)) continue
    if (f.key === 'Added' || f.key === 'Removed') {
      blocks.push({ kind: 'tags', op: f.key === 'Added' ? 'add' : 'remove', items: tagItems(f.value) })
    } else if (f.unavailable) {
      blocks.push({ kind: 'unavailable', field: f })
    } else if (f.fenced || f.value.includes('\n')) {
      blocks.push({ kind: 'block', field: f })
    } else {
      const m = ARROW.exec(f.value)
      if (m) blocks.push({ kind: 'arrow', key: f.key, from: m[1], to: m[2] })
      else blocks.push({ kind: 'kv', key: f.key, value: f.value })
    }
  }
  return blocks
}

function firstLine(v: string): string {
  return v.split('\n', 1)[0] ?? ''
}

/** One-line collapsed preview derived from the first block (all ± tag blocks
 *  merge into one preview so "+ A · − B" shows both signs). Clamping to a
 *  single visual line is the caller's CSS concern. */
export function detailPreview(model: DetailModel): Seg[] {
  const blocks = detailBlocks(model)
  const b = blocks[0]
  if (!b) return []
  switch (b.kind) {
    case 'diff':
      return [{ t: `"${firstLine(b.before.value)}" → "${firstLine(b.after.value)}"` }]
    case 'tags': {
      const parts: string[] = []
      for (const x of blocks) {
        if (x.kind !== 'tags' || x.items.length === 0) continue
        parts.push(`${x.op === 'add' ? '+' : '−'} ${x.items[0].label}`)
      }
      return [{ t: parts.join(' · ') }]
    }
    case 'unavailable':
      return [{ t: 'content unavailable' }]
    case 'block':
      return [{ t: `"${firstLine(b.field.value)}"` }]
    case 'arrow':
      return [{ t: `${b.key}: ${b.from} → ${b.to}` }]
    case 'kv':
      return [{ t: `${b.key}: ${b.value}` }]
  }
}
