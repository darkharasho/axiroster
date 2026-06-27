// src/renderer/src/components/NotesEditor.tsx
//
// Notion-style block editor for member notes, themed to the app's dark/emerald
// tokens. Stores its value as a serialized BlockNote document JSON string in the
// existing `notes` field (legacy plain text is migrated on load by parseNotes).
// The parent remounts this with key={member.annotationKey}, so we initialize from
// `value` once and never need to push external updates back in.
import { useEffect, useRef } from 'react'
import { useCreateBlockNote } from '@blocknote/react'
import type { PartialBlock } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { parseNotes, isEmptyNotes } from '../lib/notesDoc'

export default function NotesEditor({
  value,
  editable,
  onSave
}: {
  value: string
  editable: boolean
  onSave: (serialized: string) => void
}): JSX.Element {
  const editor = useCreateBlockNote({
    initialContent: parseNotes(value) as PartialBlock[] | undefined
  })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const handleChange = (): void => {
    if (!editable) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const serialized = JSON.stringify(editor.document)
      onSave(isEmptyNotes(serialized) ? '' : serialized)
    }, 700)
  }

  return (
    <div className="notes-editor rounded-xl border border-panel-line2 bg-panel-sunk px-1 py-1">
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme="dark"
        onChange={handleChange}
      />
    </div>
  )
}
