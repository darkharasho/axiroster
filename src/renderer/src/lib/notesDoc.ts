//
// Pure helpers for the notes field. Notes are stored as a serialized BlockNote
// block-document JSON string in the existing `notes` text column. Legacy plain
// text (everything written before this redesign) is wrapped into one paragraph
// block on load. No BlockNote import here so the file stays node-test friendly.

export type NotesInline = { text?: string }
export type NotesBlock = {
  type?: string
  content?: Array<NotesInline | unknown>
  children?: NotesBlock[]
}

function legacyParagraph(text: string): NotesBlock[] {
  return [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} } as unknown] }]
}

/** Decode the stored notes string into BlockNote initial content (or undefined
 *  for an empty doc, which BlockNote renders as one empty paragraph). */
export function parseNotes(value: string): NotesBlock[] | undefined {
  if (!value || !value.trim()) return undefined
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed as NotesBlock[]
    return legacyParagraph(value)
  } catch {
    return legacyParagraph(value)
  }
}

function blocksText(blocks: NotesBlock[]): string[] {
  const out: string[] = []
  for (const b of blocks) {
    const inline = Array.isArray(b.content)
      ? b.content.map((c) => (c && typeof c === 'object' ? (c as NotesInline).text ?? '' : '')).join('')
      : ''
    out.push(inline)
    if (Array.isArray(b.children) && b.children.length) out.push(...blocksText(b.children))
  }
  return out
}

/** Flatten a stored notes doc to plain text (legacy strings pass through). */
export function docToPlainText(value: string): string {
  if (!value || !value.trim()) return ''
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return blocksText(parsed as NotesBlock[]).join('\n').replace(/\n+$/g, '').replace(/^\n+/g, '')
    return value
  } catch {
    return value
  }
}

export function isEmptyNotes(value: string): boolean {
  return docToPlainText(value).trim() === ''
}
