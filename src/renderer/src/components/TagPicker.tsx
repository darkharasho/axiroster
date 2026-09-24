// src/renderer/src/components/TagPicker.tsx
//
// Colored, reusable tags for a single member. Renders the assigned pills + an
// "Add tag" trigger; delegates the search/create/recolor popover to the shared
// TagChooser. Assignment stays a string[]; per-tag color lives in the registry.
import { useEffect, useMemo, useRef, useState } from 'react'
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
  const wrapRef = useRef<HTMLDivElement>(null)

  // Dismiss the popover on outside click / Escape while open.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Known tag names = registry colors plus currently-assigned ones.
  const known = useMemo(() => {
    const names = new Map<string, string>() // lc -> display
    for (const t of tags) names.set(t.toLowerCase(), t)
    for (const k of Object.keys(registry)) if (!names.has(k)) names.set(k, k)
    return [...names.values()]
  }, [tags, registry])

  return (
    <div ref={wrapRef} className="axi-menu">
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
          excludeAssigned={tags}
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
