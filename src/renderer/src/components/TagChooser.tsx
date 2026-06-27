// src/renderer/src/components/TagChooser.tsx
//
// The shared tag search/create/recolor popover panel. Extracted from TagPicker so
// both single-member tagging and the bulk SelectionBar reuse one implementation.
// Renders only the panel; the parent owns open state + outside-click and unmounts
// this to close.
import { useState } from 'react'
import { Plus } from 'lucide-react'
import {
  PALETTE, resolveColorId, tagStyle, dotColor,
  type TagRegistry, type TagColorId
} from '../lib/tagRegistry'

export default function TagChooser({
  registry,
  knownTags,
  excludeAssigned = [],
  allowCreate = true,
  allowRecolor = true,
  onChoose,
  onRecolor
}: {
  registry: TagRegistry
  knownTags: string[]
  excludeAssigned?: string[]
  allowCreate?: boolean
  allowRecolor?: boolean
  onChoose: (name: string) => void
  onRecolor: (name: string, id: TagColorId) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const q = query.trim()
  const lcExclude = new Set(excludeAssigned.map((t) => t.toLowerCase()))
  const visible = knownTags.filter((n) => !lcExclude.has(n.toLowerCase()))
  const suggestions = q
    ? visible.filter((n) => n.toLowerCase().includes(q.toLowerCase()))
    : visible
  const exact = knownTags.find((n) => n.toLowerCase() === q.toLowerCase())

  const choose = (name: string): void => {
    const t = name.trim()
    if (!t) return
    onChoose(t)
  }

  return (
    <div className="absolute z-20 mt-2 w-60 rounded-xl border border-panel-line2 bg-panel-raised p-2 shadow-xl">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (allowCreate || exact)) choose(q)
        }}
        placeholder={allowCreate ? 'Search or create…' : 'Search…'}
        className="field mb-2 h-8 w-full px-2.5 py-0 text-xs"
      />
      <div className="max-h-44 overflow-y-auto">
        {allowCreate && q && !exact && (
          <button
            onClick={() => choose(q)}
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
        {suggestions.length === 0 && !(allowCreate && q) && (
          <div className="px-2 py-1.5 text-xs text-ink-faint">No tags.</div>
        )}
        {suggestions.map((n) => {
          const id = resolveColorId(n, registry)
          return (
            <button
              key={n}
              onClick={() => choose(n)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-panel-hover"
            >
              <span className="h-2 w-2 rounded-full" style={{ background: dotColor(id) }} />
              <span style={{ color: tagStyle(id).color }}>{n}</span>
            </button>
          )
        })}
      </div>

      {allowRecolor && q && (
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
  )
}
