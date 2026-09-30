// src/renderer/src/components/SelectionBar.tsx
//
// Bulk-action bar shown when ≥1 roster member is selected. Generic by design:
// holds a count + action buttons + Clear, so future bulk actions are just more
// buttons. Add/Remove open the shared TagChooser, which portals itself out,
// measures the button it was given and owns its own dismissal.
import { useRef, useState } from 'react'
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
  const addRef = useRef<HTMLButtonElement>(null)
  const removeRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="ar-selection">
      <span>{count} selected</span>
      <div className="flex items-center gap-2">
        <button
          ref={addRef}
          onClick={() => setMenu((m) => (m === 'add' ? null : 'add'))}
          aria-expanded={menu === 'add'}
          className="axi-btn ar-sm"
        >
          <Tag size={13} /> Add tag
        </button>
        <button
          ref={removeRef}
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
          anchorRef={addRef}
          placement="up"
          onDismiss={() => setMenu(null)}
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
          anchorRef={removeRef}
          placement="up"
          onDismiss={() => setMenu(null)}
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
