// src/renderer/src/components/TagPicker.tsx
//
// Colored, reusable tags for a single member. Renders the assigned pills + an
// "Add tag" trigger; delegates the search/create/recolor popover to the shared
// TagChooser. Assignment stays a string[]; per-tag color lives in the registry.
import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Plus } from 'lucide-react'
import { resolveColorId, tagStyle, dotColor, type TagRegistry, type TagColorId } from '../lib/tagRegistry'
import TagChooser from './TagChooser'

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
    <div ref={wrapRef} className="relative">
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((t) => {
          const id = resolveColorId(t, registry)
          return (
            <span
              key={t}
              className="group inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium"
              style={tagStyle(id)}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: dotColor(id) }} />
              {t}
              {editable && (
                <button
                  onClick={() => onRemove(t)}
                  className="opacity-0 transition group-hover:opacity-60 hover:!opacity-100"
                  title="Remove tag"
                >
                  <X size={12} />
                </button>
              )}
            </span>
          )
        })}
        {editable && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-dashed border-panel-line2 px-2.5 text-xs text-ink-faint hover:border-ink-faint hover:text-ink-dim hover:bg-panel-hover"
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
