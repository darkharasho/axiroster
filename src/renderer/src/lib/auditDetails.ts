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
