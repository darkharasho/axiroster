// src/renderer/src/components/TagChooser.tsx
//
// The shared tag search/create/recolor popover panel. Extracted from TagPicker so
// both single-member tagging and the bulk SelectionBar reuse one implementation.
// The parent owns open state and unmounts this to close; this owns where the
// panel lands and when it dismisses.
//
// The panel is the package's .axi-menu__pop, so it is drawn with the same
// outline and offset block as every other popover in the family — but it is
// portaled to <body> and placed by useAnchoredPop, which Picker shares. See
// that file for why these panels cannot be left absolute beside their trigger.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'
import {
  PALETTE,
  resolveColorId,
  tagStyle,
  type TagRegistry,
  type TagColorId
} from '../lib/tagRegistry'
import { useAnchoredPop } from '../lib/useAnchoredPop'

export default function TagChooser({
  registry,
  knownTags,
  anchorRef,
  excludeAssigned = [],
  allowCreate = true,
  allowRecolor = true,
  placement = 'down',
  onChoose,
  onDismiss,
  onRecolor
}: {
  registry: TagRegistry
  knownTags: string[]
  /** The trigger the panel is measured from. */
  anchorRef: React.RefObject<HTMLElement>
  excludeAssigned?: string[]
  allowCreate?: boolean
  allowRecolor?: boolean
  /** The side to prefer. Either way the panel flips when that side won't fit. */
  placement?: 'down' | 'up'
  onChoose: (name: string) => void
  /** Outside click or Escape. The parent unmounts us. */
  onDismiss: () => void
  onRecolor: (name: string, id: TagColorId) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const popRef = useRef<HTMLDivElement>(null)

  const q = query.trim()
  const lcExclude = new Set(excludeAssigned.map((t) => t.toLowerCase()))
  const visible = knownTags.filter((n) => !lcExclude.has(n.toLowerCase()))
  const suggestions = q ? visible.filter((n) => n.toLowerCase().includes(q.toLowerCase())) : visible
  const exact = knownTags.find((n) => n.toLowerCase() === q.toLowerCase())

  const choose = (name: string): void => {
    const t = name.trim()
    if (!t) return
    onChoose(t)
  }

  // The panel's height changes as the query filters the list, so what's in it
  // is a placement dependency.
  const box = useAnchoredPop(anchorRef, popRef, {
    placement,
    deps: [query, suggestions.length, allowRecolor]
  })

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || anchorRef.current?.contains(t)) return
      onDismiss()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorRef, onDismiss])

  return createPortal(
    <div
      ref={popRef}
      className="axi-menu__pop ar-pop--fixed"
      style={
        {
          '--axi-menu-width': '260px',
          left: box?.left ?? 0,
          top: box?.top ?? 0,
          maxHeight: box?.maxHeight,
          visibility: box?.visible ? undefined : 'hidden'
        } as React.CSSProperties
      }
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
    </div>,
    document.body
  )
}
