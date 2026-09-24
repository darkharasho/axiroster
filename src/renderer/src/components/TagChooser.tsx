// src/renderer/src/components/TagChooser.tsx
//
// The shared tag search/create/recolor popover panel. Extracted from TagPicker so
// both single-member tagging and the bulk SelectionBar reuse one implementation.
// Renders only the panel; the parent owns open state + outside-click and unmounts
// this to close.
//
// The panel is the package's .axi-menu__pop, so it is drawn with the same
// outline and offset block as every other popover in the family; the parent
// carries .axi-menu.
import { useState } from 'react'
import { Plus } from 'lucide-react'
import {
  PALETTE,
  resolveColorId,
  tagStyle,
  type TagRegistry,
  type TagColorId
} from '../lib/tagRegistry'

export default function TagChooser({
  registry,
  knownTags,
  excludeAssigned = [],
  allowCreate = true,
  allowRecolor = true,
  placement = 'down',
  onChoose,
  onRecolor
}: {
  registry: TagRegistry
  knownTags: string[]
  excludeAssigned?: string[]
  allowCreate?: boolean
  allowRecolor?: boolean
  /** 'up' for a trigger pinned to the bottom of a pane, where down is offscreen. */
  placement?: 'down' | 'up'
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
    <div
      className={`axi-menu__pop${placement === 'up' ? ' ar-pop--up' : ''}`}
      style={{ '--axi-menu-width': '260px' } as React.CSSProperties}
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (allowCreate || exact)) choose(q)
        }}
        placeholder={allowCreate ? 'Search or create…' : 'Search…'}
        className="axi-input mb-2"
      />
      <div className="max-h-44 overflow-y-auto">
        {allowCreate && q && !exact && (
          <button onClick={() => choose(q)} className="ar-pop__item">
            <Plus size={12} /> Create
            <span className="ar-tag ml-1" style={tagStyle(resolveColorId(q, registry))}>
              {q}
            </span>
          </button>
        )}
        {suggestions.length === 0 && !(allowCreate && q) && (
          <div className="ar-note--faint px-2 py-1.5">No tags.</div>
        )}
        {suggestions.map((n) => (
          <button key={n} onClick={() => choose(n)} className="ar-pop__item">
            <span className="ar-tag" style={tagStyle(resolveColorId(n, registry))}>
              {n}
            </span>
          </button>
        ))}
      </div>

      {allowRecolor && q && (
        <div className="ar-pop__foot">
          <span className="ar-label">Color</span>
          {PALETTE.map((p) => (
            <button
              key={p.id}
              onClick={() => onRecolor(q, p.id)}
              className={`ar-swatch ar-swatch--sm${
                resolveColorId(q, registry) === p.id ? ' ar-swatch--on' : ''
              }`}
              style={{ '--axi-series': p.dot } as React.CSSProperties}
              title={p.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
