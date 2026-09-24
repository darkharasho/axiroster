// src/renderer/src/components/SelectionBar.tsx
//
// Bulk-action bar shown when ≥1 roster member is selected. Generic by design:
// holds a count + action buttons + Clear, so future bulk actions are just more
// buttons. Add/Remove open the shared TagChooser.
import { useEffect, useRef, useState } from 'react'
import { Tag, X } from 'lucide-react'
import TagChooser from './TagChooser'
import type { TagRegistry, TagColorId } from '../lib/tagRegistry'
import Tooltip from './Tooltip'

export default function SelectionBar({
  count,
  registry,
  addKnownTags,
  removeKnownTags,
  onAdd,
  onRemove,
  onRecolor,
  onClear
}: {
  count: number
  registry: TagRegistry
  addKnownTags: string[]
  removeKnownTags: string[]
  onAdd: (name: string) => void
  onRemove: (name: string) => void
  onRecolor: (name: string, id: TagColorId) => void
  onClear: () => void
}): JSX.Element {
  const [menu, setMenu] = useState<'add' | 'remove' | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  return (
    <div
      ref={wrapRef}
      className="ar-selection axi-menu"
    >
      <span>{count} selected</span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setMenu((m) => (m === 'add' ? null : 'add'))}
          aria-expanded={menu === 'add'}
          className="axi-btn ar-sm"
        >
          <Tag size={13} /> Add tag
        </button>
        <button
          onClick={() => setMenu((m) => (m === 'remove' ? null : 'remove'))}
          aria-expanded={menu === 'remove'}
          className="axi-btn ar-sm"
        >
          <Tag size={13} /> Remove tag
        </button>
      </div>
      <Tooltip text="Clear selection" className="ml-auto inline-flex">
        <button onClick={onClear} className="axi-btn ar-sm">
          <X size={13} /> Clear
        </button>
      </Tooltip>

      {menu === 'add' && (
        <TagChooser
          registry={registry}
          knownTags={addKnownTags}
          placement="up"
          onChoose={(name) => {
            onAdd(name)
            setMenu(null)
          }}
          onRecolor={onRecolor}
        />
      )}
      {menu === 'remove' && (
        <TagChooser
          registry={registry}
          knownTags={removeKnownTags}
          placement="up"
          allowCreate={false}
          allowRecolor={false}
          onChoose={(name) => {
            onRemove(name)
            setMenu(null)
          }}
          onRecolor={onRecolor}
        />
      )}
    </div>
  )
}
