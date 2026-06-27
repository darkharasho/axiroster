// src/renderer/src/components/TagPicker.tsx
//
// Colored, reusable tags. Assignment stays a plain string[] on the member; the
// per-tag color lives in the shared registry (see lib/tagRegistry + the meta:tags
// row). Pills render with inline hex styles, mirroring the role-chip pattern.
import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Plus } from 'lucide-react'
import {
  PALETTE, resolveColorId, tagStyle, dotColor,
  type TagRegistry, type TagColorId
} from '../lib/tagRegistry'

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
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  // Dismiss the popover on outside click while open.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const q = query.trim()
  const lcAssigned = new Set(tags.map((t) => t.toLowerCase()))
  // Known tag names = registry keys plus currently-assigned ones.
  const known = useMemo(() => {
    const names = new Map<string, string>() // lc -> display
    for (const t of tags) names.set(t.toLowerCase(), t)
    for (const k of Object.keys(registry)) if (!names.has(k)) names.set(k, k)
    return [...names.values()]
  }, [tags, registry])
  const suggestions = q
    ? known.filter((n) => n.toLowerCase().includes(q.toLowerCase()) && !lcAssigned.has(n.toLowerCase()))
    : known.filter((n) => !lcAssigned.has(n.toLowerCase()))
  const exact = known.find((n) => n.toLowerCase() === q.toLowerCase())

  const assign = (name: string): void => {
    const t = name.trim()
    if (!t) return
    if (!lcAssigned.has(t.toLowerCase())) onAssign(t)
    setQuery('')
    setOpen(false)
  }

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
        <div className="absolute z-20 mt-2 w-60 rounded-xl border border-panel-line2 bg-panel-raised p-2 shadow-xl">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') assign(q)
              else if (e.key === 'Escape') setOpen(false)
            }}
            placeholder="Search or create…"
            className="field mb-2 h-8 w-full px-2.5 py-0 text-xs"
          />
          <div className="max-h-44 overflow-y-auto">
            {q && !exact && (
              <button
                onClick={() => assign(q)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-ink-dim hover:bg-panel-hover"
              >
                <Plus size={12} /> Create
                <span
                  className="ml-1 inline-flex h-5 items-center gap-1 rounded-md border px-2"
                  style={tagStyle(resolveColorId(q, registry))}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: dotColor(resolveColorId(q, registry)) }} />
                  {q}
                </span>
              </button>
            )}
            {suggestions.map((n) => {
              const id = resolveColorId(n, registry)
              return (
                <button
                  key={n}
                  onClick={() => assign(n)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-panel-hover"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: dotColor(id) }} />
                  <span style={{ color: tagStyle(id).color }}>{n}</span>
                </button>
              )
            })}
          </div>

          {/* recolor the typed/exact tag */}
          {q && (
            <div className="mt-1 flex items-center gap-1.5 border-t border-panel-line px-1 pt-2">
              <span className="mr-1 text-[10px] uppercase tracking-wide text-ink-faint">Color</span>
              {PALETTE.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onRecolor(q, p.id)}
                  className={`h-4 w-4 rounded-full border-2 ${
                    resolveColorId(q, registry) === p.id ? 'border-white' : 'border-transparent'
                  }`}
                  style={{ background: p.dot }}
                  title={p.id}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
