# Tags & Notes Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain-textarea notes with a Notion-style block (WYSIWYG) editor and turn tags into a color-coded, reusable vocabulary, with zero Supabase schema changes.

**Architecture:** Notes are stored as a serialized BlockNote block-document JSON string in the existing `notes` text column; legacy plain-text notes are wrapped into a paragraph block on load, and an empty editor saves `''` (so the existing main-process empty-pruning is untouched). Tag *assignment* stays `string[]` per member; tag *colors* live in a global registry persisted as a reserved `meta:tags` annotation row, reusing all existing sync/RLS plumbing. Pure logic (doc text extraction, palette/color resolution) lives in node-testable `.ts` libs; the two React components are verified by typecheck + manual run (the repo has no DOM test harness).

**Tech Stack:** Electron + React + TypeScript, Tailwind (dark charcoal / emerald tokens), lucide-react icons, BlockNote (`@blocknote/core`, `@blocknote/react`, `@blocknote/mantine`), Vitest (node env, `src/**/*.test.ts`).

## Global Constraints

- Vitest runs in **node** environment and only includes `src/**/*.test.ts` (NOT `.tsx`). Pure libs must be `.ts` with no React/DOM/BlockNote imports so their tests run. Run tests with `npm test` (already pinned to `--pool=forks --maxForks=2`).
- No Supabase migration, no new table, no RLS/edge changes. The `notes` column stays **text**; `tags` stays **jsonb string[]**.
- Tag registry is stored under the reserved annotation key `meta:tags` (color map JSON in its `notes` field). This key MUST be excluded from the reconciled member list.
- Tag rendering uses **inline `style` with hex** (mirroring the existing `DiscordRolesPanel` role-chip pattern at `MemberDetail.tsx:586-591`), NOT Tailwind color classes — avoids JIT purge issues.
- Tag name matching is **case-insensitive** (consistent with `cleanList` dedupe in `rosterStore.ts`).
- No image/file/external embeds, no tables in notes (v1 scope).
- Match existing tokens: surfaces `#141416`/`#1a1a1c`/`#252528`, accent `#047857`/`#10b981`, Inter font.

---

### Task 1: `notesDoc.ts` — block-doc serialization, legacy migration, plain-text extraction

Pure, node-testable. No BlockNote import — operates on the loosely-typed serialized JSON shape (`Block[]` where each block has optional `content` inline runs with `.text` and optional `children`).

**Files:**
- Create: `src/renderer/src/lib/notesDoc.ts`
- Test: `src/renderer/src/lib/notesDoc.test.ts`

**Interfaces:**
- Produces:
  - `type NotesBlock = { type?: string; content?: Array<{ text?: string } | unknown>; children?: NotesBlock[] }`
  - `parseNotes(value: string): NotesBlock[] | undefined` — `''`/whitespace → `undefined`; valid JSON array → the array; anything else (legacy plain text) → `[{ type: 'paragraph', content: [{ type: 'text', text: <value>, styles: {} }] }]`.
  - `docToPlainText(value: string): string` — `''` → `''`; JSON array → concatenated text of all inline `.text` (incl. nested `children`), blocks joined by `\n`; non-JSON (legacy) → the raw string.
  - `isEmptyNotes(value: string): boolean` — `docToPlainText(value).trim() === ''`.

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/lib/notesDoc.test.ts
import { describe, it, expect } from 'vitest'
import { parseNotes, docToPlainText, isEmptyNotes } from './notesDoc'

describe('parseNotes', () => {
  it('returns undefined for empty / whitespace', () => {
    expect(parseNotes('')).toBeUndefined()
    expect(parseNotes('   ')).toBeUndefined()
  })
  it('wraps legacy plain text into a single paragraph block', () => {
    expect(parseNotes('hello world')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'hello world', styles: {} }] }
    ])
  })
  it('returns a stored block array verbatim', () => {
    const doc = [{ type: 'heading', content: [{ type: 'text', text: 'Hi', styles: {} }] }]
    expect(parseNotes(JSON.stringify(doc))).toEqual(doc)
  })
  it('treats a non-array JSON value as legacy text', () => {
    expect(parseNotes('42')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: '42', styles: {} }] }
    ])
  })
})

describe('docToPlainText', () => {
  it('extracts text across blocks and nested children', () => {
    const doc = JSON.stringify([
      { type: 'heading', content: [{ type: 'text', text: 'Title' }] },
      { type: 'bulletListItem', content: [{ type: 'text', text: 'one' }],
        children: [{ type: 'bulletListItem', content: [{ type: 'text', text: 'nested' }] }] }
    ])
    expect(docToPlainText(doc)).toBe('Title\none\nnested')
  })
  it('returns legacy text unchanged', () => {
    expect(docToPlainText('just notes')).toBe('just notes')
  })
  it('returns empty for empty input', () => {
    expect(docToPlainText('')).toBe('')
  })
})

describe('isEmptyNotes', () => {
  it('is true for empty string and an empty paragraph doc', () => {
    expect(isEmptyNotes('')).toBe(true)
    expect(isEmptyNotes(JSON.stringify([{ type: 'paragraph', content: [] }]))).toBe(true)
  })
  it('is false when there is text', () => {
    expect(isEmptyNotes(JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }]))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/lib/notesDoc.test.ts`
Expected: FAIL — cannot find module `./notesDoc`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/renderer/src/lib/notesDoc.ts
//
// Pure helpers for the notes field. Notes are stored as a serialized BlockNote
// block-document JSON string in the existing `notes` text column. Legacy plain
// text (everything written before this redesign) is wrapped into one paragraph
// block on load. No BlockNote import here so the file stays node-test friendly.

export type NotesInline = { text?: string }
export type NotesBlock = {
  type?: string
  content?: Array<NotesInline | unknown>
  children?: NotesBlock[]
}

function legacyParagraph(text: string): NotesBlock[] {
  return [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} } as unknown] }]
}

/** Decode the stored notes string into BlockNote initial content (or undefined
 *  for an empty doc, which BlockNote renders as one empty paragraph). */
export function parseNotes(value: string): NotesBlock[] | undefined {
  if (!value || !value.trim()) return undefined
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed as NotesBlock[]
    return legacyParagraph(value)
  } catch {
    return legacyParagraph(value)
  }
}

function blocksText(blocks: NotesBlock[]): string[] {
  const out: string[] = []
  for (const b of blocks) {
    const inline = Array.isArray(b.content)
      ? b.content.map((c) => (c && typeof c === 'object' ? (c as NotesInline).text ?? '' : '')).join('')
      : ''
    out.push(inline)
    if (Array.isArray(b.children) && b.children.length) out.push(...blocksText(b.children))
  }
  return out
}

/** Flatten a stored notes doc to plain text (legacy strings pass through). */
export function docToPlainText(value: string): string {
  if (!value || !value.trim()) return ''
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return blocksText(parsed as NotesBlock[]).join('\n').replace(/\n+$/g, '').replace(/^\n+/g, '')
    return value
  } catch {
    return value
  }
}

export function isEmptyNotes(value: string): boolean {
  return docToPlainText(value).trim() === ''
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/lib/notesDoc.test.ts`
Expected: PASS (all cases). If the `docToPlainText` multi-block test fails on stray newlines, the trim-of-edges regex above handles leading/trailing only; inner `\n` joins are intended.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/notesDoc.ts src/renderer/src/lib/notesDoc.test.ts
git commit -m "feat(notes): block-doc parse/serialize + legacy-text migration helpers"
```

---

### Task 2: `tagRegistry.ts` — palette, color resolution, registry (de)serialization

Pure, node-testable. No React import.

**Files:**
- Create: `src/renderer/src/lib/tagRegistry.ts`
- Test: `src/renderer/src/lib/tagRegistry.test.ts`

**Interfaces:**
- Produces:
  - `type TagColorId = 'emerald' | 'blue' | 'amber' | 'rose' | 'violet' | 'slate'`
  - `type TagRegistry = Record<string, TagColorId>` — keys are **lowercased** tag names.
  - `PALETTE: ReadonlyArray<{ id: TagColorId; dot: string; text: string }>`
  - `defaultColorFor(name: string): TagColorId` — deterministic hash of the lowercased name into `PALETTE`.
  - `resolveColorId(name: string, reg: TagRegistry): TagColorId` — `reg[name.toLowerCase()]` else `defaultColorFor(name)`.
  - `tagStyle(id: TagColorId): { background: string; borderColor: string; color: string }` and `dotColor(id: TagColorId): string` — for inline `style=`.
  - `parseRegistry(notes: string): TagRegistry` — corrupt/non-object → `{}`; keeps only known color ids; lowercases keys.
  - `serializeRegistry(reg: TagRegistry): string` — `JSON.stringify`.
  - `setTagColor(reg: TagRegistry, name: string, id: TagColorId): TagRegistry` — returns a new registry with `name.toLowerCase()` set.

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/lib/tagRegistry.test.ts
import { describe, it, expect } from 'vitest'
import {
  PALETTE, defaultColorFor, resolveColorId, tagStyle, dotColor,
  parseRegistry, serializeRegistry, setTagColor
} from './tagRegistry'

describe('defaultColorFor', () => {
  it('is deterministic and case-insensitive', () => {
    expect(defaultColorFor('Commander')).toBe(defaultColorFor('commander'))
  })
  it('returns a palette id', () => {
    const ids = PALETTE.map((p) => p.id)
    expect(ids).toContain(defaultColorFor('healer'))
  })
})

describe('resolveColorId', () => {
  it('prefers the registry (case-insensitive) over the default', () => {
    expect(resolveColorId('Commander', { commander: 'rose' })).toBe('rose')
  })
  it('falls back to the name-derived default', () => {
    expect(resolveColorId('zzz', {})).toBe(defaultColorFor('zzz'))
  })
})

describe('parseRegistry', () => {
  it('returns {} for corrupt or non-object input', () => {
    expect(parseRegistry('not json')).toEqual({})
    expect(parseRegistry('42')).toEqual({})
    expect(parseRegistry('')).toEqual({})
  })
  it('keeps known color ids and lowercases keys, drops unknown', () => {
    expect(parseRegistry(JSON.stringify({ Core: 'blue', x: 'neon' }))).toEqual({ core: 'blue' })
  })
})

describe('setTagColor / serialize', () => {
  it('sets a lowercased key immutably and round-trips', () => {
    const reg = setTagColor({}, 'Trial', 'amber')
    expect(reg).toEqual({ trial: 'amber' })
    expect(parseRegistry(serializeRegistry(reg))).toEqual({ trial: 'amber' })
  })
})

describe('style helpers', () => {
  it('produce strings for a known id', () => {
    const s = tagStyle('emerald')
    expect(typeof s.background).toBe('string')
    expect(typeof dotColor('emerald')).toBe('string')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/lib/tagRegistry.test.ts`
Expected: FAIL — cannot find module `./tagRegistry`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/renderer/src/lib/tagRegistry.ts
//
// Tag colors are a global, reusable vocabulary: a tag name maps to a palette
// color id, saved once and applied roster-wide. The map is persisted as JSON in
// the reserved `meta:tags` annotation row (see main/index.ts). Pure module — no
// React — so it is node-testable. Pills render via inline style (hex), mirroring
// the role-chip pattern in MemberDetail's DiscordRolesPanel.

export type TagColorId = 'emerald' | 'blue' | 'amber' | 'rose' | 'violet' | 'slate'

export const PALETTE: ReadonlyArray<{ id: TagColorId; dot: string; text: string }> = [
  { id: 'emerald', dot: '#10b981', text: '#5eead4' },
  { id: 'blue', dot: '#3b82f6', text: '#93c5fd' },
  { id: 'amber', dot: '#f59e0b', text: '#fcd34d' },
  { id: 'rose', dot: '#f43f5e', text: '#fda4af' },
  { id: 'violet', dot: '#8b5cf6', text: '#c4b5fd' },
  { id: 'slate', dot: '#94a3b8', text: '#cbd5e1' }
]

const BY_ID = new Map(PALETTE.map((p) => [p.id, p]))
const KNOWN = new Set(PALETTE.map((p) => p.id))

export function defaultColorFor(name: string): TagColorId {
  const s = name.toLowerCase()
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length].id
}

export type TagRegistry = Record<string, TagColorId>

export function resolveColorId(name: string, reg: TagRegistry): TagColorId {
  return reg[name.toLowerCase()] ?? defaultColorFor(name)
}

export function dotColor(id: TagColorId): string {
  return (BY_ID.get(id) ?? BY_ID.get('slate')!).dot
}

export function tagStyle(id: TagColorId): { background: string; borderColor: string; color: string } {
  const p = BY_ID.get(id) ?? BY_ID.get('slate')!
  return { background: `${p.dot}1f`, borderColor: `${p.dot}40`, color: p.text }
}

export function parseRegistry(notes: string): TagRegistry {
  if (!notes || !notes.trim()) return {}
  try {
    const raw = JSON.parse(notes)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: TagRegistry = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string' && KNOWN.has(v as TagColorId)) out[k.toLowerCase()] = v as TagColorId
    }
    return out
  } catch {
    return {}
  }
}

export function serializeRegistry(reg: TagRegistry): string {
  return JSON.stringify(reg)
}

export function setTagColor(reg: TagRegistry, name: string, id: TagColorId): TagRegistry {
  return { ...reg, [name.toLowerCase()]: id }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/lib/tagRegistry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/tagRegistry.ts src/renderer/src/lib/tagRegistry.test.ts
git commit -m "feat(tags): color palette + registry resolve/parse helpers"
```

---

### Task 3: Tag-registry persistence (main IPC + preload) and reserved-key guard

The registry rides on the existing annotation store/sync as a reserved `meta:tags` row. Add a tiny reserved-key helper, two IPC handlers that mirror the annotation upsert's sync push, expose them in preload, and exclude reserved keys from the reconciled member list.

**Files:**
- Modify: `src/main/rosterReconcile.ts` (add + apply `isReservedAnnotationKey`)
- Create: `src/main/rosterReservedKeys.test.ts`
- Modify: `src/main/index.ts` (two handlers near line 909; filter `roster.list()` at line 467)
- Modify: `src/preload/index.ts` (add `getTagRegistry` / `setTagRegistry`)
- Modify: `src/preload/index.d.ts` (add the two methods to `AxiRosterApi`)

**Interfaces:**
- Produces (main): `isReservedAnnotationKey(key: string): boolean` exported from `rosterReconcile.ts` (true for keys starting with `meta:`).
- Produces (preload `window.axiroster`): `getTagRegistry(): Promise<Record<string,string>>`, `setTagRegistry(map: Record<string,string>): Promise<void>`.
- Consumes: `RosterStore.get` / `RosterStore.upsert` (`rosterStore.ts`), `sync.pushAnnotation` (`index.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// src/main/rosterReservedKeys.test.ts
import { describe, it, expect } from 'vitest'
import { isReservedAnnotationKey } from './rosterReconcile'

describe('isReservedAnnotationKey', () => {
  it('flags meta: keys as reserved', () => {
    expect(isReservedAnnotationKey('meta:tags')).toBe(true)
  })
  it('does not flag member ids or acct keys', () => {
    expect(isReservedAnnotationKey('201537071804973056')).toBe(false)
    expect(isReservedAnnotationKey('acct:Eternal.1234')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/rosterReservedKeys.test.ts`
Expected: FAIL — `isReservedAnnotationKey` is not exported.

- [ ] **Step 3a: Add the helper and apply it in reconcile**

In `src/main/rosterReconcile.ts`, add near the top (after the `accountAnchor` export around line 70):

```ts
/** Reserved annotation keys hold app metadata (e.g. the tag color registry under
 *  `meta:tags`), never a real person — they must never surface as members. */
export const isReservedAnnotationKey = (key: string): boolean => key.startsWith('meta:')
```

Then make the reconcile defensive: where `annotations` is destructured (around line 119) and `annByKey` is built (around line 123), filter reserved keys first:

```ts
const annByKey = new Map(
  annotations.filter((a) => !isReservedAnnotationKey(a.memberId)).map((a) => [a.memberId, a])
)
```

- [ ] **Step 3b: Filter reserved keys at the reconcile call site**

In `src/main/index.ts` at line ~467, change:

```ts
    annotations: roster.list(),
```
to:
```ts
    annotations: roster.list().filter((a) => !isReservedAnnotationKey(a.memberId)),
```
Add `isReservedAnnotationKey` to the existing import from `./rosterReconcile` (find the line importing from `'./rosterReconcile'`; if reconcile is imported under a namespace or default, import the named helper explicitly).

- [ ] **Step 3c: Add the two IPC handlers**

In `src/main/index.ts`, immediately after the `roster:annotation:remove` handler (line 913), add:

```ts
  ipcMain.handle('roster:tags:get', () => {
    const rec = roster.get('meta:tags')
    if (!rec || !rec.notes) return {}
    try {
      const m = JSON.parse(rec.notes)
      return m && typeof m === 'object' && !Array.isArray(m) ? m : {}
    } catch {
      return {}
    }
  })
  ipcMain.handle('roster:tags:set', async (_e, map: Record<string, string>) => {
    const rec = roster.upsert('meta:tags', { notes: JSON.stringify(map ?? {}) })
    if (rec) await sync.pushAnnotation(rec).catch(() => {})
  })
```

- [ ] **Step 3d: Expose in preload**

In `src/preload/index.ts`, in the `// Roster` group (after `removeAnnotation`, line 35), add:

```ts
  getTagRegistry: () => ipcRenderer.invoke('roster:tags:get'),
  setTagRegistry: (map: Record<string, string>) => ipcRenderer.invoke('roster:tags:set', map),
```

In `src/preload/index.d.ts`, in the `AxiRosterApi` interface (after line 319), add:

```ts
  getTagRegistry(): Promise<Record<string, string>>
  setTagRegistry(map: Record<string, string>): Promise<void>
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run src/main/rosterReservedKeys.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/rosterReconcile.ts src/main/rosterReservedKeys.test.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(tags): persist tag color registry via reserved meta:tags row + IPC"
```

---

### Task 4: `NotesEditor.tsx` — BlockNote block editor (add deps, theme)

No unit test (no DOM/component test harness in repo). Verified by typecheck + build; behavior confirmed in Task 6's manual run.

**Files:**
- Modify: `package.json` (add BlockNote deps)
- Create: `src/renderer/src/components/NotesEditor.tsx`

**Interfaces:**
- Consumes: `parseNotes`, `isEmptyNotes` from `../lib/notesDoc` (Task 1).
- Produces: default export
  `NotesEditor({ value, editable, onSave }: { value: string; editable: boolean; onSave: (serialized: string) => void }): JSX.Element`
  — initializes from `value` once (parent remounts via `key` when the member changes); on change, debounces ~700ms then calls `onSave` with `JSON.stringify(editor.document)`, or `onSave('')` when the doc is empty.

- [ ] **Step 1: Install BlockNote**

```bash
npm install @blocknote/core @blocknote/react @blocknote/mantine
```
Expected: installs without peer-dep errors (BlockNote ships its own React 18 peer; the repo is React 18).

- [ ] **Step 2: Write the component**

```tsx
// src/renderer/src/components/NotesEditor.tsx
//
// Notion-style block editor for member notes, themed to the app's dark/emerald
// tokens. Stores its value as a serialized BlockNote document JSON string in the
// existing `notes` field (legacy plain text is migrated on load by parseNotes).
// The parent remounts this with key={member.annotationKey}, so we initialize from
// `value` once and never need to push external updates back in.
import { useEffect, useRef } from 'react'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { parseNotes, isEmptyNotes } from '../lib/notesDoc'

export default function NotesEditor({
  value,
  editable,
  onSave
}: {
  value: string
  editable: boolean
  onSave: (serialized: string) => void
}): JSX.Element {
  const editor = useCreateBlockNote({ initialContent: parseNotes(value) })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const handleChange = (): void => {
    if (!editable) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const serialized = JSON.stringify(editor.document)
      onSave(isEmptyNotes(serialized) ? '' : serialized)
    }, 700)
  }

  return (
    <div className="notes-editor rounded-xl border border-panel-line2 bg-panel-sunk px-1 py-1">
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme="dark"
        onChange={handleChange}
      />
    </div>
  )
}
```

- [ ] **Step 3: Theme BlockNote to the app tokens**

Append to `src/renderer/src/index.css` (CSS-variable overrides scoped to the editor; BlockNote/Mantine read `--bn-*` and `--mantine-*` vars):

```css
/* BlockNote notes editor — match app dark/emerald tokens */
.notes-editor .bn-container,
.notes-editor .bn-editor {
  background: transparent;
  --bn-colors-editor-background: transparent;
  --bn-colors-editor-text: #e9eaec;
  --bn-colors-menu-background: #252528;
  --bn-colors-menu-text: #e9eaec;
  --bn-colors-tooltip-background: #1e1e21;
  --bn-colors-hovered-background: #1e1e21;
  --bn-colors-selected-background: #047857;
  --bn-colors-highlights-blue-background: rgba(16, 185, 129, 0.18);
  font-family: Inter, system-ui, sans-serif;
}
.notes-editor .bn-editor { padding-inline: 10px; }
```

- [ ] **Step 4: Verify build + typecheck**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds (BlockNote CSS + ESM resolve under electron-vite). If electron-vite reports an ESM/CJS interop error on a BlockNote subpackage, add the three `@blocknote/*` packages to `build.rollupOptions`/`optimizeDeps` is not normally needed — first just retry; only if it fails, add them to `optimizeDeps.include` in `electron.vite.config.*` for the renderer.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/renderer/src/components/NotesEditor.tsx src/renderer/src/index.css
git commit -m "feat(notes): BlockNote WYSIWYG editor component, themed to app tokens"
```

---

### Task 5: `TagPicker.tsx` — colored pills + search/create/recolor popover

No unit test (DOM component). Verified by typecheck/build + Task 6 manual run.

**Files:**
- Create: `src/renderer/src/components/TagPicker.tsx`

**Interfaces:**
- Consumes: `PALETTE`, `TagRegistry`, `TagColorId`, `resolveColorId`, `tagStyle`, `dotColor`, `setTagColor` from `../lib/tagRegistry` (Task 2); `lucide-react` icons.
- Produces: default export
  ```ts
  TagPicker({
    tags, registry, editable, onAssign, onRemove, onRecolor
  }: {
    tags: string[]
    registry: TagRegistry
    editable: boolean
    onAssign: (name: string) => void
    onRemove: (name: string) => void
    onRecolor: (name: string, id: TagColorId) => void
  }): JSX.Element
  ```
  Renders the colored pill row (X-on-hover when editable) + an "＋ Add tag" button that opens a popover: text input filters known registry tags; Enter / "Create" assigns a new tag; a swatch row recolors the typed/selected tag.

- [ ] **Step 1: Write the component**

```tsx
// src/renderer/src/components/TagPicker.tsx
//
// Colored, reusable tags. Assignment stays a plain string[] on the member; the
// per-tag color lives in the shared registry (see lib/tagRegistry + the meta:tags
// row). Pills render with inline hex styles, mirroring the role-chip pattern.
import { useMemo, useRef, useState } from 'react'
import { X, Plus } from 'lucide-react'
import {
  PALETTE, resolveColorId, tagStyle, dotColor, setTagColor,
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
            onKeyDown={(e) => e.key === 'Enter' && assign(q)}
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
```

Note: `setTagColor` is imported for the type/consistency check but the actual registry mutation happens in the parent's `onRecolor` (Task 6). If the unused import trips the linter, drop `setTagColor` from the import list.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors. (Remove the `setTagColor` import if flagged unused.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/TagPicker.tsx
git commit -m "feat(tags): TagPicker pill row + search/create/recolor popover"
```

---

### Task 6: Wire `NotesEditor` + `TagPicker` into `MemberDetail.tsx`

Replace the textarea and the chip/add-input with the new components; load the tag registry; persist registry edits.

**Files:**
- Modify: `src/renderer/src/components/MemberDetail.tsx`

**Interfaces:**
- Consumes: `NotesEditor` (Task 4), `TagPicker` (Task 2/5), `parseRegistry`, `serializeRegistry`, `setTagColor`, `TagRegistry`, `TagColorId` from `../lib/tagRegistry`; `window.axiroster.getTagRegistry` / `setTagRegistry` (Task 3).

- [ ] **Step 1: Add imports and registry state**

At the top of `MemberDetail.tsx`, add imports:

```tsx
import NotesEditor from './NotesEditor'
import TagPicker from './TagPicker'
import { parseRegistry, serializeRegistry, setTagColor, type TagRegistry, type TagColorId } from '../lib/tagRegistry'
```

Remove now-unused imports `X`, `Plus` from lucide-react **only if** they are no longer used elsewhere in the file — they ARE still used by `DiscordRolesPanel`/`LinkToMemberPicker`, so KEEP them.

Inside the component, after the existing `useState` lines (around line 44), add:

```tsx
  const [registry, setRegistry] = useState<TagRegistry>({})

  useEffect(() => {
    let alive = true
    window.axiroster.getTagRegistry().then((m) => alive && setRegistry(parseRegistry(JSON.stringify(m))))
    return () => { alive = false }
  }, [])
```

(`getTagRegistry` returns a parsed object; re-`parseRegistry` normalizes/validates it.)

- [ ] **Step 2: Replace the Tags field body**

Replace the entire `<Field label="Tags"> … </Field>` block (lines 133-160) with:

```tsx
          <Field label="Tags">
            <TagPicker
              tags={tags}
              registry={registry}
              editable={canEdit}
              onAssign={(name) => {
                if (tags.some((t) => t.toLowerCase() === name.toLowerCase())) return
                const next = [...tags, name]
                setTags(next)
                save({ tags: next })
              }}
              onRemove={(name) => {
                const next = tags.filter((t) => t !== name)
                setTags(next)
                save({ tags: next })
              }}
              onRecolor={async (name, id: TagColorId) => {
                const next = setTagColor(registry, name, id)
                setRegistry(next)
                await window.axiroster.setTagRegistry(next)
              }}
            />
          </Field>
```

You may now delete the local `addTag` / `removeTag` functions and the `tagInput` state (lines 44, 63-75) since `TagPicker` owns that flow. Verify nothing else references them.

- [ ] **Step 3: Replace the Notes field body**

Replace the `<Field label="Notes"> … </Field>` block (lines 162-172) with:

```tsx
          <Field label="Notes">
            <NotesEditor
              key={member.annotationKey}
              value={notes}
              editable={canEdit}
              onSave={(serialized) => {
                setNotes(serialized)
                if (serialized !== member.notes) save({ notes: serialized })
              }}
            />
          </Field>
```

The `notes` state + its reset in the `useEffect` (lines 42, 49) stay as-is; the `key` remount keeps the editor in sync when switching members. The local `notes` textarea handlers are gone.

- [ ] **Step 4: Verify typecheck + build**

Run: `npm run typecheck`
Expected: no errors. Fix any "unused variable" errors by removing the now-dead `tagInput`/`addTag`/`removeTag`.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Manual smoke test in the app**

Run: `npm run dev`
Verify, on a member detail panel:
1. Tags render as colored pills; "＋ Add tag" opens the popover; typing + Enter (or "Create") adds a colored tag; X on hover removes it; the color swatch row recolors a tag and it stays after reselecting the member.
2. Notes show the block editor; `/` opens the slash menu; headings/bullets/to-dos/callout/code/divider work; drag handle reorders; edits persist after switching members and back.
3. A member with **legacy** plain-text notes opens with that text intact (as a paragraph).
4. Emptying all notes and switching away prunes the annotation (member with only notes), matching old behavior.
5. With a read-only workspace member (`canEdit=false`), the editor is non-editable and tags show no X / no "Add tag".

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/MemberDetail.tsx
git commit -m "feat(roster): use BlockNote notes editor + colored TagPicker in MemberDetail"
```

---

### Task 7: Full test + verification sweep

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all pass (existing suite + the two new lib test files). No regressions.

- [ ] **Step 2: Typecheck both projects**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit -m "test: verification sweep for tags & notes redesign" --allow-empty
```

---

## Self-Review Notes

- **Spec coverage:** BlockNote choice (Task 4) ✓; block set incl. callout/code/divider/checkbox via BlockNote defaults + slash menu (Task 4, manual-verified Task 6) ✓; notes-as-JSON in `notes` text column with legacy migration (Task 1, wired Task 6) ✓; empty-doc pruning preserved via save-`''` (Task 1 `isEmptyNotes` + Task 6) — chosen over mutating main `isEmpty`, achieving the same outcome without cross-process imports ✓; tags stay `string[]` (Task 6) ✓; color registry name→id, picked once, roster-wide (Task 2) ✓; reserved `meta:tags` storage + sync reuse + member-list exclusion (Task 3) ✓; TagPicker search/create/recolor + hover-X pills (Task 5) ✓; read-only mode (Task 6 step 5) ✓; corrupt-input safety (Tasks 1–2 tests) ✓; tests at `--maxWorkers=2` (`npm test`) ✓.
- **Deviation from spec:** spec §Data Model suggested updating `rosterStore.isEmpty()`; this plan instead has the renderer save `''` for an empty doc so the existing main-process check is untouched (simpler, no renderer→main import). Documented here intentionally; net behavior is identical.
- **Known edge case (accepted, v1):** a notes doc containing only non-text blocks (e.g. a lone divider) flattens to empty text and saves as `''`, so a notes-only divider would prune. Harmless and consistent with "empty notes."
- **No DOM test harness:** components (`.tsx`) have no unit tests, matching the existing repo (all tests are node-env `src/main/*`). Their correctness is gated by typecheck + build + the Task 6 manual checklist.
- **Type consistency:** `TagColorId`, `TagRegistry`, `resolveColorId`, `tagStyle`, `dotColor`, `setTagColor`, `parseRegistry`, `serializeRegistry` used identically across Tasks 2/5/6; `parseNotes`/`isEmptyNotes`/`docToPlainText` across Tasks 1/4. `isReservedAnnotationKey` defined Task 3 and applied in the same task.
