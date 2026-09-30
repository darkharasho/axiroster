// src/renderer/src/components/TagPicker.tsx
//
// Colored, reusable tags for a single member. Renders the assigned pills + an
// "Add tag" trigger; delegates the search/create/recolor popover to the shared
// TagChooser. Assignment stays a string[]; per-tag color lives in the registry.
//
// The chooser portals itself out and measures the trigger, so it takes the
// button's ref and owns its own outside-click/Escape dismissal.
import { useMemo, useRef, useState } from 'react'
import { X, Plus } from 'lucide-react'
import { resolveColorId, tagStyle, type TagRegistry, type TagColorId } from '../lib/tagRegistry'
import TagChooser from './TagChooser'
import Tooltip from './Tooltip'

export default function TagPicker({
  tags,
  registry,
  editable,
  onAssign,
  onRemove,
  onRecolor
}: {
  tags: string[]
  registry: TagRegistry
  editable: boolean
  onAssign: (name: string) => void
  onRemove: (name: string) => void
  onRecolor: (name: string, id: TagColorId) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const addRef = useRef<HTMLButtonElement>(null)

  // Known tag names = registry colors plus currently-assigned ones.
  const known = useMemo(() => {
    const names = new Map<string, string>() // lc -> display
    for (const t of tags) names.set(t.toLowerCase(), t)
    for (const k of Object.keys(registry)) if (!names.has(k)) names.set(k, k)
    return [...names.values()]
  }, [tags, registry])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((t) => {
          const id = resolveColorId(t, registry)
          return (
            <span key={t} className="ar-tag" style={tagStyle(id)}>
              {t}
              {editable && (
                <Tooltip text="Remove tag">
                  <button onClick={() => onRemove(t)} className="ar-tag__x">
                    <X size={12} />
                  </button>
                </Tooltip>
              )}
            </span>
          )
        })}
        {editable && (
          <button
            ref={addRef}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="axi-btn axi-btn--dashed ar-sm"
          >
            <Plus size={13} /> Add tag
          </button>
        )}
      </div>

      {editable && open && (
        <TagChooser
          registry={registry}
          knownTags={known}
          anchorRef={addRef}
          excludeAssigned={tags}
          onDismiss={() => setOpen(false)}
          onChoose={(name) => {
            if (!tags.some((t) => t.toLowerCase() === name.toLowerCase())) onAssign(name)
            setOpen(false)
          }}
          onRecolor={onRecolor}
        />
      )}
    </div>
  )
}
