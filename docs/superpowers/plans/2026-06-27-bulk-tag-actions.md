# Bulk Tag Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let leadership multi-select roster members (checkboxes + shift-click + select-all-filtered) and Add/Remove a tag across the whole selection, reusing the colored-tag system from 0.4.0.

**Architecture:** No backend changes. `RosterView` gains selection state; a reusable `SelectionBar` appears when ≥1 member is selected; the `TagPicker` popover is extracted into a shared `TagChooser` used by both single-member tagging and the bulk bar; persistence reuses the existing per-member `upsertAnnotation` IPC in a loop. The add/remove set math is a pure, node-tested helper.

**Tech Stack:** Electron + React 18 + TypeScript, Tailwind (dark/emerald tokens), lucide-react, Vitest (node env, `src/**/*.test.ts`).

## Global Constraints

- Vitest runs in **node** env and includes only `src/**/*.test.ts` (NOT `.tsx`). Pure libs must be `.ts` with no React/DOM imports so their tests run. Run tests with `npm test` (pinned to forks/maxForks=2).
- No Supabase schema/table/migration/RLS changes. Persistence is the existing `window.axiroster.upsertAnnotation(annotationKey, { tags })`. Registry recolor uses existing `window.axiroster.setTagRegistry(map)`.
- Tag matching is **case-insensitive** (consistent with `tagRegistry`/`rosterStore`).
- Tag pills/colors come from `src/renderer/src/lib/tagRegistry.ts` (`PALETTE`, `resolveColorId`, `tagStyle`, `dotColor`, `setTagColor`, `TagRegistry`, `TagColorId`); inline hex `style`, not Tailwind color classes.
- Read-only members (`canEdit === false` in `RosterView`, from `authStatus().role !== 'read'`) must show **no** selection controls and no `SelectionBar`.
- Bulk = **tags only** this wave; `SelectionBar` is generic so future actions are just more buttons. No bulk status/role/nickname (YAGNI).
- The two roster views render via `MemberTable` (table) and `MemberCards` (cards), both receiving `rows` + `onSelect(annotationKey)`. Row keys are `m.annotationKey`.
- `TagChooser` extraction must be **behavior-preserving** for single-member `TagPicker` (verified by typecheck + build + manual; no DOM unit harness in repo).
- `toast` is imported from `../lib/toast` (see `MemberDetail.tsx`).

---

### Task 1: `bulkTags.ts` — pure add/remove/union helpers

Pure, node-testable. Accepts a narrow structural type (not the full `ReconciledMember`) so the test builds plain fixtures and the module needs no preload import.

**Files:**
- Create: `src/renderer/src/lib/bulkTags.ts`
- Test: `src/renderer/src/lib/bulkTags.test.ts`

**Interfaces:**
- Produces:
  - `type Taggable = { annotationKey: string; tags: string[] }`
  - `type TagDiff = { key: string; nextTags: string[] }`
  - `addTagToMembers(members: Taggable[], keys: Iterable<string>, tag: string): TagDiff[]` — for each selected key present in `members`, returns `{ key, nextTags: [...tags, tag.trim()] }` **only if** the member lacks `tag` (case-insensitive); members already having it (or missing/empty tag) are omitted.
  - `removeTagFromMembers(members: Taggable[], keys: Iterable<string>, tag: string): TagDiff[]` — returns `{ key, nextTags: tags without tag }` only for members that actually have it.
  - `tagsInSelection(members: Taggable[], keys: Iterable<string>): string[]` — union of tags across selected members, case-insensitively de-duped (first display-casing wins), sorted case-insensitively.

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/lib/bulkTags.test.ts
import { describe, it, expect } from 'vitest'
import { addTagToMembers, removeTagFromMembers, tagsInSelection, type Taggable } from './bulkTags'

const members: Taggable[] = [
  { annotationKey: 'a', tags: ['core', 'commander'] },
  { annotationKey: 'b', tags: ['trial'] },
  { annotationKey: 'c', tags: ['Core'] },
  { annotationKey: 'd', tags: [] }
]

describe('addTagToMembers', () => {
  it('adds the tag only to members that lack it (case-insensitive)', () => {
    const diffs = addTagToMembers(members, ['a', 'b', 'c', 'd'], 'core')
    // a has 'core', c has 'Core' -> skipped; b and d get it
    expect(diffs).toEqual([
      { key: 'b', nextTags: ['trial', 'core'] },
      { key: 'd', nextTags: ['core'] }
    ])
  })
  it('ignores keys not in the member set and trims the tag', () => {
    expect(addTagToMembers(members, ['zzz'], 'x')).toEqual([])
    expect(addTagToMembers(members, ['d'], '  raid ')).toEqual([{ key: 'd', nextTags: ['raid'] }])
  })
  it('returns [] for an empty tag', () => {
    expect(addTagToMembers(members, ['a', 'b'], '   ')).toEqual([])
  })
})

describe('removeTagFromMembers', () => {
  it('removes the tag (case-insensitive) only where present', () => {
    const diffs = removeTagFromMembers(members, ['a', 'b', 'c', 'd'], 'CORE')
    expect(diffs).toEqual([
      { key: 'a', nextTags: ['commander'] },
      { key: 'c', nextTags: [] }
    ])
  })
})

describe('tagsInSelection', () => {
  it('unions tags across the selection, de-duped case-insensitively and sorted', () => {
    expect(tagsInSelection(members, ['a', 'b', 'c'])).toEqual(['commander', 'core', 'trial'])
  })
  it('is empty for an empty selection', () => {
    expect(tagsInSelection(members, [])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/lib/bulkTags.test.ts`
Expected: FAIL — cannot find module `./bulkTags`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/renderer/src/lib/bulkTags.ts
//
// Pure helpers for bulk tag operations across selected roster members. Works on a
// narrow { annotationKey, tags } shape (ReconciledMember is assignable) so it stays
// node-testable with no React/preload imports. Each function returns only the
// members that actually change, so callers persist the minimum.

export type Taggable = { annotationKey: string; tags: string[] }
export type TagDiff = { key: string; nextTags: string[] }

function byKey(members: Taggable[]): Map<string, Taggable> {
  const m = new Map<string, Taggable>()
  for (const x of members) m.set(x.annotationKey, x)
  return m
}

export function addTagToMembers(members: Taggable[], keys: Iterable<string>, tag: string): TagDiff[] {
  const name = tag.trim()
  if (!name) return []
  const lc = name.toLowerCase()
  const map = byKey(members)
  const out: TagDiff[] = []
  for (const key of keys) {
    const mem = map.get(key)
    if (!mem) continue
    if (mem.tags.some((t) => t.toLowerCase() === lc)) continue
    out.push({ key, nextTags: [...mem.tags, name] })
  }
  return out
}

export function removeTagFromMembers(members: Taggable[], keys: Iterable<string>, tag: string): TagDiff[] {
  const name = tag.trim()
  if (!name) return []
  const lc = name.toLowerCase()
  const map = byKey(members)
  const out: TagDiff[] = []
  for (const key of keys) {
    const mem = map.get(key)
    if (!mem) continue
    if (!mem.tags.some((t) => t.toLowerCase() === lc)) continue
    out.push({ key, nextTags: mem.tags.filter((t) => t.toLowerCase() !== lc) })
  }
  return out
}

export function tagsInSelection(members: Taggable[], keys: Iterable<string>): string[] {
  const map = byKey(members)
  const seen = new Map<string, string>() // lc -> first display casing
  for (const key of keys) {
    const mem = map.get(key)
    if (!mem) continue
    for (const t of mem.tags) {
      const l = t.toLowerCase()
      if (!seen.has(l)) seen.set(l, t)
    }
  }
  return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/lib/bulkTags.test.ts`
Expected: PASS (8 assertions across 3 suites).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/bulkTags.ts src/renderer/src/lib/bulkTags.test.ts
git commit -m "feat(tags): pure bulk add/remove/union helpers"
```

---

### Task 2: Extract `TagChooser` from `TagPicker`

Lift `TagPicker`'s popover (search / create / recolor) into a standalone, parameterized `TagChooser` so the bulk bar can reuse it. Refactor `TagPicker` to render pills + Add button + `TagChooser`. Public `TagPicker` props unchanged; behavior identical.

**Files:**
- Create: `src/renderer/src/components/TagChooser.tsx`
- Modify: `src/renderer/src/components/TagPicker.tsx`

**Interfaces:**
- Consumes: `PALETTE`, `resolveColorId`, `tagStyle`, `dotColor`, `TagRegistry`, `TagColorId` from `../lib/tagRegistry`.
- Produces: `TagChooser` (default export):
  ```ts
  TagChooser({
    registry, knownTags, excludeAssigned, allowCreate, allowRecolor, onChoose, onRecolor
  }: {
    registry: TagRegistry
    knownTags: string[]
    excludeAssigned?: string[]   // names hidden from suggestions (default [])
    allowCreate?: boolean        // show the "Create <q>" row (default true)
    allowRecolor?: boolean       // show the color swatch row (default true)
    onChoose: (name: string) => void
    onRecolor: (name: string, id: TagColorId) => void
  }): JSX.Element
  ```
  Renders ONLY the popover panel (absolute, `w-60`). Owns its own `query` state. Enter chooses the typed value (when `allowCreate` or it exactly matches a known tag); the parent owns open/close + outside-click and unmounts `TagChooser` to dismiss.

- [ ] **Step 1: Create `TagChooser.tsx`**

```tsx
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
```

- [ ] **Step 2: Refactor `TagPicker.tsx` to use `TagChooser`**

Replace the entire file with:

```tsx
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
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean (no errors).

- [ ] **Step 4: Build + manual parity note**

Run: `npm run build`
Expected: succeeds. (Manual re-check in Task 5's run: single-member TagPicker still searches, creates, and recolors identically.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TagChooser.tsx src/renderer/src/components/TagPicker.tsx
git commit -m "refactor(tags): extract shared TagChooser popover from TagPicker"
```

---

### Task 3: `SelectionBar.tsx`

A bottom bar that shows the selection count and hosts Add/Remove tag (each opening a `TagChooser`) + Clear. Owns its own popover open-state + outside-click.

**Files:**
- Create: `src/renderer/src/components/SelectionBar.tsx`

**Interfaces:**
- Consumes: `TagChooser` (Task 2); `TagRegistry`, `TagColorId` from `../lib/tagRegistry`; lucide `Tag`, `X`.
- Produces: `SelectionBar` (default export):
  ```ts
  SelectionBar({
    count, registry, addKnownTags, removeKnownTags, onAdd, onRemove, onRecolor, onClear
  }: {
    count: number
    registry: TagRegistry
    addKnownTags: string[]      // registry ∪ all roster tags (create allowed)
    removeKnownTags: string[]   // tags present in the selection (no create)
    onAdd: (name: string) => void
    onRemove: (name: string) => void
    onRecolor: (name: string, id: TagColorId) => void
    onClear: () => void
  }): JSX.Element
  ```

- [ ] **Step 1: Create the component**

```tsx
// src/renderer/src/components/SelectionBar.tsx
//
// Bulk-action bar shown when ≥1 roster member is selected. Generic by design:
// holds a count + action buttons + Clear, so future bulk actions are just more
// buttons. Add/Remove open the shared TagChooser.
import { useEffect, useRef, useState } from 'react'
import { Tag, X } from 'lucide-react'
import TagChooser from './TagChooser'
import type { TagRegistry, TagColorId } from '../lib/tagRegistry'

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
      className="relative mt-2 flex items-center gap-2 rounded-xl border border-panel-line2 bg-panel-raised px-3 py-2 shadow-xl"
    >
      <span className="text-sm font-medium text-ink">{count} selected</span>
      <div className="ml-2 flex items-center gap-1.5">
        <button
          onClick={() => setMenu((m) => (m === 'add' ? null : 'add'))}
          className="btn px-2 py-1 text-xs"
        >
          <Tag size={13} /> Add tag
        </button>
        <button
          onClick={() => setMenu((m) => (m === 'remove' ? null : 'remove'))}
          className="btn px-2 py-1 text-xs"
        >
          <Tag size={13} /> Remove tag
        </button>
      </div>
      <button
        onClick={onClear}
        className="ml-auto flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
        title="Clear selection"
      >
        <X size={13} /> Clear
      </button>

      {menu === 'add' && (
        <TagChooser
          registry={registry}
          knownTags={addKnownTags}
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
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/SelectionBar.tsx
git commit -m "feat(roster): SelectionBar with add/remove-tag menus"
```

---

### Task 4: Wire selection + bulk apply into `RosterView`

Add selection state, row checkboxes (both views), shift-click range, a select-all-filtered toolbar control, the `SelectionBar`, registry load, and the bulk apply handlers.

**Files:**
- Modify: `src/renderer/src/components/RosterView.tsx`

**Interfaces:**
- Consumes: `addTagToMembers`, `removeTagFromMembers`, `tagsInSelection` (Task 1); `SelectionBar` (Task 3); `parseRegistry`, `setTagColor`, `TagRegistry`, `TagColorId` from `../lib/tagRegistry`; `toast` from `../lib/toast`; `window.axiroster.{getTagRegistry,setTagRegistry,upsertAnnotation}`.

Notes on existing code (verify exact lines before editing — they shift as you edit):
- `members` is the reconciled list already in scope (used at `const selected = members.find(...)`).
- `canEdit` boolean state exists. `view` is `'table' | 'cards'`. `sorted` (table) and `filtered` (cards) are the displayed lists.
- `MemberTable` rows are `<button>` elements with `grid ${cols}` where `cols = 'grid-cols-[16px_1.6fr_1fr_120px_1fr_90px]'`. `MemberCards` rows are `<button>` cards. Both must become `role="button"` `<div>`s so a checkbox can nest without an invalid button-in-button.

- [ ] **Step 1: Add imports**

At the top of `RosterView.tsx`, add to the lucide import list `Tag` is not needed here; add `Check` and `Minus` for the select-all control, and import the new helpers:

```tsx
import { addTagToMembers, removeTagFromMembers, tagsInSelection } from '../lib/bulkTags'
import { parseRegistry, setTagColor, type TagRegistry, type TagColorId } from '../lib/tagRegistry'
import SelectionBar from './SelectionBar'
import { toast } from '../lib/toast'
```

- [ ] **Step 2: Add selection + registry state and handlers (inside the component)**

After the existing `const [canEdit, setCanEdit] = useState(true)` line, add:

```tsx
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [lastIdx, setLastIdx] = useState<number | null>(null)
  const [registry, setRegistry] = useState<TagRegistry>({})

  useEffect(() => {
    let alive = true
    window.axiroster.getTagRegistry().then((m) => alive && setRegistry(parseRegistry(JSON.stringify(m))))
    return () => { alive = false }
  }, [])
```

Then, after the `sorted` memo is defined (so `view`, `sorted`, `filtered`, `members` are all in scope), add the displayed-list + selection logic:

```tsx
  const displayed = view === 'table' ? sorted : filtered

  // Drop selections that are no longer present (e.g. after a roster rebuild).
  useEffect(() => {
    setSelectedKeys((prev) => {
      const valid = new Set(members.map((m) => m.annotationKey))
      let changed = false
      const next = new Set<string>()
      for (const k of prev) (valid.has(k) ? next.add(k) : (changed = true))
      return changed ? next : prev
    })
  }, [members])

  const toggleRow = (key: string, index: number, shift: boolean): void => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (shift && lastIdx !== null) {
        const [lo, hi] = lastIdx < index ? [lastIdx, index] : [index, lastIdx]
        const select = !prev.has(key) // match the clicked row's resulting state
        for (let i = lo; i <= hi; i++) {
          const k = displayed[i]?.annotationKey
          if (!k) continue
          if (select) next.add(k)
          else next.delete(k)
        }
      } else if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setLastIdx(index)
  }

  const allDisplayedSelected =
    displayed.length > 0 && displayed.every((m) => selectedKeys.has(m.annotationKey))
  const someDisplayedSelected = displayed.some((m) => selectedKeys.has(m.annotationKey))

  const toggleSelectAll = (): void => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (allDisplayedSelected) for (const m of displayed) next.delete(m.annotationKey)
      else for (const m of displayed) next.add(m.annotationKey)
      return next
    })
    setLastIdx(null)
  }

  const clearSelection = (): void => {
    setSelectedKeys(new Set())
    setLastIdx(null)
  }

  const applyAdd = async (name: string): Promise<void> => {
    const diffs = addTagToMembers(members, selectedKeys, name)
    await Promise.all(
      diffs.map((d) => window.axiroster.upsertAnnotation(d.key, { tags: d.nextTags }).catch(() => {}))
    )
    toast(`Tagged ${diffs.length} member${diffs.length === 1 ? '' : 's'}`)
    await load()
  }

  const applyRemove = async (name: string): Promise<void> => {
    const diffs = removeTagFromMembers(members, selectedKeys, name)
    await Promise.all(
      diffs.map((d) => window.axiroster.upsertAnnotation(d.key, { tags: d.nextTags }).catch(() => {}))
    )
    toast(`Removed from ${diffs.length} member${diffs.length === 1 ? '' : 's'}`)
    await load()
  }

  const recolorTag = async (name: string, id: TagColorId): Promise<void> => {
    const next = setTagColor(registry, name, id)
    setRegistry(next)
    await window.axiroster.setTagRegistry(next).catch(() => {})
  }

  const addKnownTags = useMemo(() => {
    const names = new Map<string, string>()
    for (const k of Object.keys(registry)) names.set(k, k)
    for (const m of members) for (const t of m.tags) if (!names.has(t.toLowerCase())) names.set(t.toLowerCase(), t)
    return [...names.values()]
  }, [registry, members])
  const removeKnownTags = useMemo(
    () => tagsInSelection(members, selectedKeys),
    [members, selectedKeys]
  )
```

- [ ] **Step 3: Add the select-all toolbar control**

In the controls row (the `<div className="flex items-center gap-2 px-4 py-3">` block), add this as the FIRST child (before the search input), shown only when editing:

```tsx
            {canEdit && (
              <button
                onClick={toggleSelectAll}
                title={allDisplayedSelected ? 'Clear all' : 'Select all'}
                className="flex h-9 items-center gap-1.5 rounded-md border border-panel-line2 px-2.5 text-xs text-ink-dim hover:bg-panel-hover"
              >
                <span
                  className={`grid h-4 w-4 place-items-center rounded border ${
                    someDisplayedSelected ? 'border-accent bg-accent text-white' : 'border-panel-line2'
                  }`}
                >
                  {allDisplayedSelected ? <Check size={11} /> : someDisplayedSelected ? <Minus size={11} /> : null}
                </span>
                Select all
              </button>
            )}
```

(`Check` and `Minus` must be in the lucide-react import added in Step 1.)

- [ ] **Step 4: Thread selection props into `MemberTable` and `MemberCards` and render `SelectionBar`**

Update the table/cards render block. Replace the `view === 'table' ? (...) : (...)` JSX with calls that pass selection props, and add the `SelectionBar` below the list:

```tsx
            ) : view === 'table' ? (
              <MemberTable
                rows={sorted}
                metrics={payload?.metrics ?? {}}
                onSelect={setSelectedKey}
                sort={sort}
                onSort={toggleSort}
                selectable={canEdit}
                selectedKeys={selectedKeys}
                onToggle={toggleRow}
              />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <MemberCards
                  rows={filtered}
                  metrics={payload?.metrics ?? {}}
                  onSelect={setSelectedKey}
                  selectable={canEdit}
                  selectedKeys={selectedKeys}
                  onToggle={toggleRow}
                />
              </div>
            )}
            {canEdit && selectedKeys.size > 0 && (
              <SelectionBar
                count={selectedKeys.size}
                registry={registry}
                addKnownTags={addKnownTags}
                removeKnownTags={removeKnownTags}
                onAdd={applyAdd}
                onRemove={applyRemove}
                onRecolor={recolorTag}
                onClear={clearSelection}
              />
            )}
```

- [ ] **Step 5: Add checkbox support to `MemberTable`**

Update the `MemberTable` signature and body. New props `selectable`, `selectedKeys`, `onToggle`. Add a leading checkbox column to both header and rows (only when `selectable`); convert each row `<button>` to a `role="button"` `<div>`:

```tsx
function MemberTable({
  rows,
  metrics,
  onSelect,
  sort,
  onSort,
  selectable,
  selectedKeys,
  onToggle
}: {
  rows: ReconciledMember[]
  metrics: Record<string, BridgePlayerMetrics>
  onSelect: (k: string) => void
  sort: SortState | null
  onSort: (k: SortKey) => void
  selectable: boolean
  selectedKeys: Set<string>
  onToggle: (key: string, index: number, shift: boolean) => void
}): JSX.Element {
  const cols = selectable
    ? 'grid-cols-[20px_16px_1.6fr_1fr_120px_1fr_90px]'
    : 'grid-cols-[16px_1.6fr_1fr_120px_1fr_90px]'
  return (
    <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className={`relative z-10 grid shrink-0 ${cols} gap-3 border-b border-panel-line px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint shadow-[0_6px_12px_-6px_rgba(0,0,0,.5)]`}
      >
        {selectable && <div></div>}
        <div></div>
        {SORT_COLUMNS.map((c) => {
          const active = sort?.key === c.key
          return (
            <button
              key={c.key}
              onClick={() => onSort(c.key)}
              title={`Sort by ${c.label.toLowerCase()}`}
              className={`flex items-center gap-1 uppercase tracking-wider transition hover:text-ink ${
                c.alignEnd ? 'justify-end' : ''
              } ${active ? 'text-ink' : ''}`}
            >
              {c.label}
              {active && (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
            </button>
          )
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((m, index) => {
          const d = deriveRow(m, metrics)
          const meta = STATUS_META[m.status]
          const checked = selectedKeys.has(m.annotationKey)
          return (
            <div
              key={m.annotationKey}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(m.annotationKey)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(m.annotationKey)
                }
              }}
              className={`grid w-full ${cols} cursor-pointer items-center gap-3 border-b border-panel-line/60 px-4 py-2.5 text-left transition last:border-0 hover:bg-panel-hover ${
                checked ? 'bg-accent/10' : ''
              }`}
            >
              {selectable && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggle(m.annotationKey, index, e.shiftKey)
                  }}
                  title="Select"
                  className={`grid h-4 w-4 place-items-center rounded border ${
                    checked ? 'border-accent bg-accent text-white' : 'border-panel-line2 hover:border-ink-faint'
                  }`}
                >
                  {checked && <Check size={11} />}
                </button>
              )}
              <span className="led" style={{ background: meta.color }} title={meta.label} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">{m.label}</div>
                <div className="truncate text-xs text-ink-faint">{d.account}</div>
              </div>
              <div className="flex min-w-0 items-center gap-2 text-sm text-ink-dim">
                {d.mainClass ? <ClassIcon name={d.mainClass} size={16} /> : null}
                <span className="truncate">{d.mainClass ?? '—'}</span>
              </div>
              <div>
                {m.rank ? <span className="chip">{m.rank}</span> : <span className="text-xs text-ink-faint">—</span>}
              </div>
              <div>
                {d.attendance !== null ? (
                  <>
                    <div className="h-1.5 overflow-hidden rounded-full bg-panel-line2">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${d.attendance}%` }} />
                    </div>
                    <div className="mt-1 font-mono text-xs text-ink-dim">{d.attendance}%</div>
                  </>
                ) : (
                  <span className="text-xs text-ink-faint">—</span>
                )}
              </div>
              <div className="text-right font-mono text-xs text-ink-dim">{d.lastSeen}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Add checkbox support to `MemberCards`**

Update `MemberCards` similarly — new props, convert the card `<button>` to a `role="button"` `<div>`, and add a checkbox in the top-right corner when `selectable`:

```tsx
function MemberCards({
  rows,
  metrics,
  onSelect,
  selectable,
  selectedKeys,
  onToggle
}: {
  rows: ReconciledMember[]
  metrics: Record<string, BridgePlayerMetrics>
  onSelect: (k: string) => void
  selectable: boolean
  selectedKeys: Set<string>
  onToggle: (key: string, index: number, shift: boolean) => void
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
      {rows.map((m, index) => {
        const d = deriveRow(m, metrics)
        const meta = STATUS_META[m.status]
        const checked = selectedKeys.has(m.annotationKey)
        return (
          <div
            key={m.annotationKey}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(m.annotationKey)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(m.annotationKey)
              }
            }}
            className={`relative card cursor-pointer p-4 text-left transition hover:border-panel-line2 hover:bg-panel-hover ${
              checked ? 'border-accent/60 bg-accent/10' : ''
            }`}
          >
            {selectable && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle(m.annotationKey, index, (e as unknown as MouseEvent).shiftKey)
                }}
                title="Select"
                className={`absolute right-2 top-2 grid h-4 w-4 place-items-center rounded border ${
                  checked ? 'border-accent bg-accent text-white' : 'border-panel-line2 hover:border-ink-faint'
                }`}
              >
                {checked && <Check size={11} />}
              </button>
            )}
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-panel-line2 bg-panel-raised">
                {d.mainClass ? <ClassIcon name={d.mainClass} size={20} /> : <span className="led" style={{ background: meta.color }} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{m.label}</div>
                <div className="truncate text-xs text-ink-faint">{d.mainClass ?? d.account}</div>
              </div>
              {m.rank ? <span className="chip shrink-0">{m.rank}</span> : null}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="text-ink-faint">Attendance</span>
              <span className="font-mono text-ink-dim">{d.attendance !== null ? `${d.attendance}%` : '—'}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-line2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${d.attendance ?? 0}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-ink-faint">
                <span className="led" style={{ background: meta.color }} /> {meta.label}
              </span>
              <span className="font-mono text-ink-faint">{d.lastSeen}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

(If `MemberCards`'s original body had trailing markup beyond the `lastSeen` line shown here, preserve it inside the new `<div>` — the structure above mirrors the existing card; keep any extra rows that were present.)

- [ ] **Step 7: Typecheck + build**

Run: `npm run typecheck`
Expected: clean. Fix any unused-import errors (e.g. ensure `Check`/`Minus` are imported and used).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/RosterView.tsx
git commit -m "feat(roster): multi-select + bulk add/remove tags"
```

---

### Task 5: Verification sweep + manual smoke

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all pass (existing + `bulkTags.test.ts`).

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean / succeeds.

- [ ] **Step 3: Manual smoke (record results; needs the running app)**

Run: `npm run dev`. Verify in the roster list:
1. Checkboxes appear per row (table and cards) when you can edit; clicking one selects it and the `SelectionBar` shows the count.
2. Shift-click selects a contiguous range in the current sort/filter order.
3. "Select all" in the toolbar selects the whole filtered set; the control shows indeterminate (minus) when only some are selected and check when all are.
4. Add tag → search/create with color → applies to all selected that lacked it; toast shows the count; pills appear on those members.
5. Remove tag → menu lists only tags present in the selection → removes from those who had it.
6. Selection survives changing the search filter (keyed by member); Clear empties it.
7. Single-member `TagPicker` in the detail panel still adds/creates/recolors exactly as before (TagChooser parity).
8. A read-only workspace member (`canEdit=false`) sees no checkboxes, no select-all, no bar.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit -m "test: bulk tag actions verification sweep" --allow-empty
```

---

## Self-Review Notes

- **Spec coverage:** selection model checkbox+shift+select-all (Tasks 4, table/cards Steps 5-6) ✓; reusable SelectionBar generic for future actions (Task 3) ✓; TagChooser extraction shared by single + bulk, behavior-preserving (Task 2) ✓; `bulkTags` union/difference/no-op-skip case-insensitive, node-tested (Task 1) ✓; persistence via per-member `upsertAnnotation` loop (Task 4 applyAdd/applyRemove) ✓; new-tag-gets-color via registry/recolor (Task 4 recolorTag + default `resolveColorId`) ✓; remove menu seeded from `tagsInSelection` (Task 4) ✓; read-only hides controls (Tasks 3/4 `canEdit` gates) ✓; selection survives re-filter, keyed by annotationKey (Task 4 prune effect + toggle) ✓; best-effort persist with `.catch` like existing save (Task 4) ✓; vitest `--maxWorkers=2` via `npm test` ✓.
- **Deviation:** spec named the table component `RosterTable`; the real component is `MemberTable` — plan uses the real name. Row `<button>`s become `role="button"` `<div>`s so a checkbox can nest legally (invalid button-in-button otherwise) — a necessary, behavior-preserving structural change called out in Task 4.
- **No DOM test harness:** components (`.tsx`) are gated by typecheck + build + the Task 5 manual checklist, consistent with the repo (all tests are node-env `src/**`). Only `bulkTags.ts` is unit-tested.
- **Type consistency:** `Taggable`/`TagDiff`/`addTagToMembers`/`removeTagFromMembers`/`tagsInSelection` (Task 1) used identically in Task 4; `TagChooser` prop shape (Task 2) matches its uses in `TagPicker` (Task 2) and `SelectionBar` (Task 3); `selectable`/`selectedKeys`/`onToggle` prop names consistent across `MemberTable`/`MemberCards` and the `RosterView` call sites (Task 4).
- **Shift-click semantics:** range select uses the clicked row's resulting checked-state as the fill value, against the currently-displayed order at click time — matches the spec's "displayed order at click time."
