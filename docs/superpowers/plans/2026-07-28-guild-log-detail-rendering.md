# Guild Log Detail Rendering (Expandable Rows) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Guild Log's truncated raw-details fragment with expandable rows: a one-line category-aware preview when collapsed, and a full parsed detail card (diff blocks, content blocks, ± tags, change arrows, key-value rows) when expanded.

**Architecture:** A new pure module `auditDetails.ts` owns the bot's `details` grammar: `parseDetails` (string → ordered `DetailField[]`), `detailBlocks` (fields → typed render blocks by fixed category precedence), and `detailPreview` (blocks → one-line `Seg[]`). `auditIdentities.ts` attaches the parsed model to its `RowModel` (and synthesizes one for GW2 `motd`); `GuildLog.tsx` renders the preview + chevron and a `DetailCard` under expanded rows. No main-process, storage, or bot changes.

**Tech Stack:** TypeScript (strict), React 18, Tailwind (project palette tokens), vitest, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-07-28-guild-log-detail-rendering-design.md`

## Global Constraints

- Run tests with `npm test` (already capped at `--pool=forks --poolOptions.forks.maxForks=2`) — never raise parallelism.
- Run `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 <file>` for single-file cycles.
- No new dependencies.
- Tailwind classes must use the project palette tokens (`ink`, `ink-dim`, `ink-faint`, `panel-sunk`, `panel-raised`, `panel-line`, `panel-line2`) — no hex literals in TSX.
- Commit messages: conventional style with scope, e.g. `feat(audit): …`, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Typecheck gate: `npm run typecheck` must pass before each commit that touches TS/TSX.

---

### Task 1: `parseDetails` — the details grammar parser

**Files:**
- Create: `src/renderer/src/lib/auditDetails.ts`
- Test: `src/renderer/src/lib/auditDetails.test.ts` (new)

**Interfaces:**
- Consumes: nothing (pure, self-contained).
- Produces (later tasks rely on these exact names):
  - `interface Seg { t: string; b?: boolean }`
  - `interface DetailField { key: string; value: string; fenced: boolean; unavailable: boolean }`
  - `interface DetailModel { fields: DetailField[] }`
  - `function parseDetails(details: string | undefined): DetailModel`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/lib/auditDetails.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseDetails } from './auditDetails'

describe('parseDetails', () => {
  it('returns an empty model for undefined or empty input', () => {
    expect(parseDetails(undefined)).toEqual({ fields: [] })
    expect(parseDetails('')).toEqual({ fields: [] })
  })

  it('parses plain key-value lines in order', () => {
    const m = parseDetails('Attachments: 1\nEmbeds: 0 -> 1')
    expect(m.fields).toEqual([
      { key: 'Attachments', value: '1', fenced: false, unavailable: false },
      { key: 'Embeds', value: '0 -> 1', fenced: false, unavailable: false }
    ])
  })

  it('parses a fenced multi-line value into one field', () => {
    const m = parseDetails('Content: ```\nline one\nline two\n```\nAttachments: 2')
    expect(m.fields).toEqual([
      { key: 'Content', value: 'line one\nline two', fenced: true, unavailable: false },
      { key: 'Attachments', value: '2', fenced: false, unavailable: false }
    ])
  })

  it('parses a Before/After fenced pair (message edit)', () => {
    const m = parseDetails('Channel: <#123>\nBefore: ```\ntest\n```\nAfter: ```\ntest 2\n```')
    expect(m.fields.map((f) => f.key)).toEqual(['Before', 'After'])
    expect(m.fields[0].value).toBe('test')
    expect(m.fields[1].value).toBe('test 2')
  })

  it('drops Channel lines (already rendered as the channel chip)', () => {
    const m = parseDetails('Channel: <#123>\nDetails: something happened')
    expect(m.fields).toEqual([
      { key: 'Details', value: 'something happened', fenced: false, unavailable: false }
    ])
  })

  it('suppresses each boilerplate Details sentence', () => {
    for (const s of [
      'Member joined the server.',
      'Member left the server.',
      'Member was kicked.',
      'Member was banned.',
      'Member was unbanned.',
      'Voice state updated.'
    ]) {
      expect(parseDetails(`Details: ${s}`).fields).toEqual([])
    }
  })

  it('keeps a non-boilerplate Details value', () => {
    expect(parseDetails('Details: Nickname changed').fields).toEqual([
      { key: 'Details', value: 'Nickname changed', fenced: false, unavailable: false }
    ])
  })

  it('flags Unavailable sentinels', () => {
    const m = parseDetails('Content: Unavailable (message content intent missing or not cached).')
    expect(m.fields[0].unavailable).toBe(true)
    expect(m.fields[0].value).toMatch(/^Unavailable/)
  })

  it('consumes an unclosed fence to end of input', () => {
    const m = parseDetails('Before: ```\ntruncated body with no clos')
    expect(m.fields).toEqual([
      { key: 'Before', value: 'truncated body with no clos', fenced: true, unavailable: false }
    ])
  })

  it('starts a Details field for a keyless first line', () => {
    expect(parseDetails('just some text').fields).toEqual([
      { key: 'Details', value: 'just some text', fenced: false, unavailable: false }
    ])
  })

  it('appends keyless continuation lines to the previous field', () => {
    const m = parseDetails('Reason: first\nsecond')
    expect(m.fields).toEqual([
      { key: 'Reason', value: 'first\nsecond', fenced: false, unavailable: false }
    ])
  })

  it('drops fields whose value ends up empty', () => {
    expect(parseDetails('Content: ```\n```').fields).toEqual([])
    expect(parseDetails('Details:').fields).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/auditDetails.test.ts`
Expected: FAIL — `Cannot find module './auditDetails'` (or equivalent resolve error) for every test.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/lib/auditDetails.ts`:

```ts
// src/renderer/src/lib/auditDetails.ts
//
// Parses the AxiTools bot's audit `details` blob into a structured model the
// Guild Log can render fully (the blob is "Key: value" lines where message
// bodies are triple-backtick fenced — see the producer contract in
// docs/superpowers/specs/2026-07-28-guild-log-detail-rendering-design.md).
// Pure and defensive: malformed input degrades to plain fields, never throws.

/** A run of action/preview text; `b` marks an emphasized span. */
export interface Seg {
  t: string
  b?: boolean
}

export interface DetailField {
  key: string
  /** Fence markers stripped; may be multi-line. */
  value: string
  /** Value was ``` wrapped (message body / list). */
  fenced: boolean
  /** Value matched the bot's "Unavailable (…)" sentinel. */
  unavailable: boolean
}

export interface DetailModel {
  /** Ordered as emitted; empty => the row has nothing to expand. */
  fields: DetailField[]
}

/** Fixed bot sentences that restate what the rendered verb already says. */
const BOILERPLATE = new Set([
  'Member joined the server.',
  'Member left the server.',
  'Member was kicked.',
  'Member was banned.',
  'Member was unbanned.',
  'Voice state updated.'
])

const KEY_LINE = /^([A-Z][A-Za-z0-9 ]{0,30}):\s?(.*)$/

export function parseDetails(details: string | undefined): DetailModel {
  if (!details) return { fields: [] }
  const fields: DetailField[] = []
  let open: DetailField | null = null // fenced field still collecting lines
  for (const line of details.split('\n')) {
    if (open) {
      if (line.trim() === '```') open = null
      else open.value = open.value ? `${open.value}\n${line}` : line
      continue
    }
    const m = KEY_LINE.exec(line)
    if (m) {
      const [, key, rest] = m
      if (key === 'Channel') continue // rendered as the channel chip already
      const field: DetailField = { key, value: rest, fenced: false, unavailable: false }
      if (rest.startsWith('```')) {
        field.fenced = true
        field.value = rest.slice(3)
        open = field
      }
      fields.push(field)
      continue
    }
    // Keyless line: continuation of the previous field, else a bare Details field.
    const prev = fields[fields.length - 1]
    if (prev) prev.value = prev.value ? `${prev.value}\n${line}` : line
    else fields.push({ key: 'Details', value: line, fenced: false, unavailable: false })
  }
  const kept: DetailField[] = []
  for (const f of fields) {
    f.value = f.value.replace(/^\n+|\n+$/g, '')
    if (f.key === 'Details' && BOILERPLATE.has(f.value)) continue
    if (f.value.length === 0) continue
    f.unavailable = /^Unavailable \(/.test(f.value)
    kept.push(f)
  }
  return { fields: kept }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/auditDetails.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/renderer/src/lib/auditDetails.ts src/renderer/src/lib/auditDetails.test.ts
git commit -m "feat(audit): parse bot detail blobs into structured fields

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `detailBlocks` + `detailPreview` — categories and the one-line preview

**Files:**
- Modify: `src/renderer/src/lib/auditDetails.ts` (append)
- Test: `src/renderer/src/lib/auditDetails.test.ts` (append)

**Interfaces:**
- Consumes: `DetailField`, `DetailModel`, `Seg` from Task 1.
- Produces (Task 4 renders these exact shapes):

```ts
export type DetailBlock =
  | { kind: 'diff'; before: DetailField; after: DetailField }
  | { kind: 'tags'; op: 'add' | 'remove'; items: { label: string; unresolved: boolean }[] }
  | { kind: 'unavailable'; field: DetailField }
  | { kind: 'block'; field: DetailField }
  | { kind: 'arrow'; key: string; from: string; to: string }
  | { kind: 'kv'; key: string; value: string }

export function detailBlocks(model: DetailModel): DetailBlock[]
export function detailPreview(model: DetailModel): Seg[]
```

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/src/lib/auditDetails.test.ts` (add `detailBlocks, detailPreview` to the import from `./auditDetails`):

```ts
describe('detailBlocks', () => {
  it('pairs Before + After into a diff block ahead of everything else', () => {
    const m = parseDetails('Before: ```\na\n```\nAfter: ```\nb\n```\nEmbeds: 0 -> 1')
    const blocks = detailBlocks(m)
    expect(blocks[0]).toMatchObject({ kind: 'diff' })
    expect(blocks[1]).toEqual({ kind: 'arrow', key: 'Embeds', from: '0', to: '1' })
  })

  it('renders Added/Removed as ± tags even when fenced (emoji lists)', () => {
    const m = parseDetails('Added: ```\naxi_hype, axi_gg\n```\nRemoved: ```\nold_logo\n```')
    expect(detailBlocks(m)).toEqual([
      {
        kind: 'tags',
        op: 'add',
        items: [
          { label: 'axi_hype', unresolved: false },
          { label: 'axi_gg', unresolved: false }
        ]
      },
      { kind: 'tags', op: 'remove', items: [{ label: 'old_logo', unresolved: false }] }
    ])
  })

  it('marks role mentions as unresolved dimmed items', () => {
    const m = parseDetails('Added: <@&1067285089387>, <@&99>')
    expect(detailBlocks(m)[0]).toEqual({
      kind: 'tags',
      op: 'add',
      items: [
        { label: '@1067285089387', unresolved: true },
        { label: '@99', unresolved: true }
      ]
    })
  })

  it('maps unavailable sentinels before the generic content block', () => {
    const m = parseDetails('Content: Unavailable (message content intent missing).')
    expect(detailBlocks(m)[0].kind).toBe('unavailable')
  })

  it('maps fenced or multi-line values to content blocks', () => {
    const m = parseDetails('Reason: ```\nspamming invite links\n```')
    expect(detailBlocks(m)).toEqual([
      {
        kind: 'block',
        field: { key: 'Reason', value: 'spamming invite links', fenced: true, unavailable: false }
      }
    ])
  })

  it('maps "a -> b" values to arrows and the rest to kv rows', () => {
    const m = parseDetails('Name: EWW -> Engaging Without Warning\nRole: Raider')
    expect(detailBlocks(m)).toEqual([
      { kind: 'arrow', key: 'Name', from: 'EWW', to: 'Engaging Without Warning' },
      { kind: 'kv', key: 'Role', value: 'Raider' }
    ])
  })
})

describe('detailPreview', () => {
  it('is empty for an empty model', () => {
    expect(detailPreview(parseDetails(undefined))).toEqual([])
  })

  it('previews a diff as quoted first lines', () => {
    const m = parseDetails('Before: ```\ntest\nmore\n```\nAfter: ```\ntest 2\n```')
    expect(detailPreview(m)).toEqual([{ t: '“test” → “test 2”' }])
  })

  it('previews ± tags with first entries of each sign', () => {
    const m = parseDetails('Added: Raider, Officer\nRemoved: Trial')
    expect(detailPreview(m)).toEqual([{ t: '+ Raider · − Trial' }])
  })

  it('previews unavailable content as a note', () => {
    const m = parseDetails('Content: Unavailable (not cached).')
    expect(detailPreview(m)).toEqual([{ t: 'content unavailable' }])
  })

  it('previews a content block as its quoted first line', () => {
    const m = parseDetails('Reason: ```\nspamming invite links\nsecond line\n```')
    expect(detailPreview(m)).toEqual([{ t: '“spamming invite links”' }])
  })

  it('previews arrows and kv rows as key: value text', () => {
    expect(detailPreview(parseDetails('AFK Timeout: 300s -> 900s'))).toEqual([
      { t: 'AFK Timeout: 300s → 900s' }
    ])
    expect(detailPreview(parseDetails('Attachments: 1'))).toEqual([{ t: 'Attachments: 1' }])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/auditDetails.test.ts`
Expected: FAIL — `detailBlocks is not a function` / import error; Task 1 tests still PASS.

- [ ] **Step 3: Write the implementation**

Append to `src/renderer/src/lib/auditDetails.ts`:

```ts
/** One renderable unit of a detail card. Category precedence per field:
 *  diff pair > ± tags (Added/Removed) > unavailable > fenced/multi-line block
 *  > "a -> b" arrow > plain key-value. Key semantics beat value shape so a
 *  fenced Added list still renders as tags, not a content block. */
export type DetailBlock =
  | { kind: 'diff'; before: DetailField; after: DetailField }
  | { kind: 'tags'; op: 'add' | 'remove'; items: { label: string; unresolved: boolean }[] }
  | { kind: 'unavailable'; field: DetailField }
  | { kind: 'block'; field: DetailField }
  | { kind: 'arrow'; key: string; from: string; to: string }
  | { kind: 'kv'; key: string; value: string }

const ROLE_MENTION = /^<@&(\d+)>$/
const ARROW = /^(.+?) -> (.+)$/

function tagItems(value: string): { label: string; unresolved: boolean }[] {
  return value
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = ROLE_MENTION.exec(s)
      return m ? { label: `@${m[1]}`, unresolved: true } : { label: s, unresolved: false }
    })
}

export function detailBlocks(model: DetailModel): DetailBlock[] {
  const blocks: DetailBlock[] = []
  const used = new Set<DetailField>()
  const before = model.fields.find((f) => f.key === 'Before')
  const after = model.fields.find((f) => f.key === 'After')
  if (before && after) {
    blocks.push({ kind: 'diff', before, after })
    used.add(before)
    used.add(after)
  }
  for (const f of model.fields) {
    if (used.has(f)) continue
    if (f.key === 'Added' || f.key === 'Removed') {
      blocks.push({ kind: 'tags', op: f.key === 'Added' ? 'add' : 'remove', items: tagItems(f.value) })
    } else if (f.unavailable) {
      blocks.push({ kind: 'unavailable', field: f })
    } else if (f.fenced || f.value.includes('\n')) {
      blocks.push({ kind: 'block', field: f })
    } else {
      const m = ARROW.exec(f.value)
      if (m) blocks.push({ kind: 'arrow', key: f.key, from: m[1], to: m[2] })
      else blocks.push({ kind: 'kv', key: f.key, value: f.value })
    }
  }
  return blocks
}

function firstLine(v: string): string {
  return v.split('\n', 1)[0] ?? ''
}

/** One-line collapsed preview derived from the first block (all ± tag blocks
 *  merge into one preview so "+ A · − B" shows both signs). Clamping to a
 *  single visual line is the caller's CSS concern. */
export function detailPreview(model: DetailModel): Seg[] {
  const blocks = detailBlocks(model)
  const b = blocks[0]
  if (!b) return []
  switch (b.kind) {
    case 'diff':
      return [{ t: `“${firstLine(b.before.value)}” → “${firstLine(b.after.value)}”` }]
    case 'tags': {
      const parts: string[] = []
      for (const x of blocks) {
        if (x.kind !== 'tags' || x.items.length === 0) continue
        parts.push(`${x.op === 'add' ? '+' : '−'} ${x.items[0].label}`)
      }
      return [{ t: parts.join(' · ') }]
    }
    case 'unavailable':
      return [{ t: 'content unavailable' }]
    case 'block':
      return [{ t: `“${firstLine(b.field.value)}”` }]
    case 'arrow':
      return [{ t: `${b.key}: ${b.from} → ${b.to}` }]
    case 'kv':
      return [{ t: `${b.key}: ${b.value}` }]
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/auditDetails.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/renderer/src/lib/auditDetails.ts src/renderer/src/lib/auditDetails.test.ts
git commit -m "feat(audit): category blocks + one-line preview for detail models

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire `DetailModel` into `auditIdentities`

**Files:**
- Modify: `src/renderer/src/lib/auditIdentities.ts`
- Test: `src/renderer/src/lib/auditIdentities.test.ts` (append + no existing assertions change)

**Interfaces:**
- Consumes: `parseDetails`, `DetailModel`, `Seg` from `./auditDetails`.
- Produces: `RowModel` gains `details?: DetailModel` (Task 4 reads `m.details`). `Seg` is now re-exported from `auditIdentities` (its local definition is deleted). `detailContext` is removed — action segs no longer carry the ` · fragment` tail.

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/src/lib/auditIdentities.test.ts`:

```ts
describe('detail models on rows', () => {
  it('attaches a parsed detail model for a message edit', () => {
    const m = describeEvent(
      discordEvent({
        id: 10,
        event_type: 'message_edit',
        actor_id: '42',
        actor_name: 'rooster',
        target_type: 'message',
        channel_id: '55',
        channel_name: 'leadership',
        details: 'Channel: <#55>\nBefore: ```\ntest\n```\nAfter: ```\ntest 2\n```'
      }),
      idx
    )
    expect(m.details?.fields.map((f) => f.key)).toEqual(['Before', 'After'])
    // The old first-raw-line fragment must be gone from the action segs.
    expect(m.action.map((s) => s.t).join('')).not.toContain('```')
  })

  it('omits the model when details are boilerplate-only (no chevron)', () => {
    const m = describeEvent(
      discordEvent({
        id: 11,
        event_type: 'member_join',
        target_id: '7',
        target_name: 'khava',
        target_type: 'user',
        details: 'Details: Member joined the server.'
      }),
      idx
    )
    expect(m.details).toBeUndefined()
  })

  it('synthesizes a detail model for a GW2 motd from raw.motd', () => {
    const m = describeEvent(
      {
        uid: 'gw2:77',
        source: 'gw2',
        id: '77',
        time: '2026-07-28T00:00:00Z',
        type: 'motd',
        summary: '',
        raw: { user: 'harasho.4281', motd: 'Reset bags Friday.\nSign up in #war-room.' }
      },
      idx
    )
    expect(m.details?.fields).toEqual([
      {
        key: 'Message of the day',
        value: 'Reset bags Friday.\nSign up in #war-room.',
        fenced: true,
        unavailable: false
      }
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/auditIdentities.test.ts`
Expected: the message-edit and motd tests FAIL (`m.details` is `undefined`; the edit test's action segs currently contain the raw ` · Before: ``` ` fragment). Note the boilerplate-omission test passes vacuously today (the `details` field doesn't exist yet) — it becomes a meaningful guard once Task 3 lands, protecting the no-chevron rule. The five pre-existing tests still PASS.

- [ ] **Step 3: Modify `auditIdentities.ts`**

Apply these exact edits:

1. Replace the local `Seg` definition and add imports. Delete:

```ts
/** A run of action text; `b` marks an emphasized span (rank/role/item names). */
export interface Seg {
  t: string
  b?: boolean
}
```

and put at the top (after the existing import):

```ts
import { parseDetails, type DetailModel } from './auditDetails'

export type { Seg } from './auditDetails'
import type { Seg } from './auditDetails'
```

2. Add the field to `RowModel` (after `channel?: ChannelChip`):

```ts
  /** Parsed detail blob; present only when there is something to expand. */
  details?: DetailModel
```

3. Delete the `detailContext` function entirely:

```ts
function detailContext(r: Record<string, unknown>): Seg[] {
  // Drop a leading "Channel: ..." line (now a chip) and keep the first remaining line.
  const lines = (str(r.details) ?? '').split('\n').filter((l) => l && !/^Channel:\s/i.test(l))
  const first = lines[0]
  return first ? [{ t: ` · ${first}` }] : []
}
```

4. Rewrite `describeDiscord` to attach the parsed model and drop `context`:

```ts
function describeDiscord(e: AuditEvent, index: IdentityIndex): RowModel {
  const r = e.raw as Record<string, unknown>
  const targetId = str(r.target_id)
  const actorId = str(r.actor_id)
  const targetType = str(r.target_type)
  const verb = discordVerb(e.type)
  const channel = channelChip(r, index)
  const parsed = parseDetails(str(r.details))
  const details = parsed.fields.length > 0 ? parsed : undefined

  const hasUserTarget = targetId !== undefined || str(r.target_name) !== undefined
  const userSubject = (targetType === 'user' || !targetType) && hasUserTarget

  if (userSubject) {
    const lead = resolveDiscord(index, targetId, str(r.target_name))
    if ((actorId || str(r.actor_name)) && actorId !== targetId) {
      return {
        lead,
        action: [{ t: verb }, { t: ' by' }],
        trail: resolveDiscord(index, actorId, str(r.actor_name)),
        channel,
        details
      }
    }
    return { lead, action: [{ t: verb }], channel, details }
  }

  // Actor-subject events: channels, roles, messages, emoji, guild.
  const lead =
    actorId || str(r.actor_name) ? resolveDiscord(index, actorId, str(r.actor_name)) : undefined
  return { lead, action: [{ t: verb }], channel, details }
}
```

5. In `describeGw2`, replace the `motd` case:

```ts
    case 'motd': {
      const motd = str(r.motd)
      return {
        lead,
        action: [{ t: 'set the message of the day' }],
        ...(motd
          ? {
              details: {
                fields: [
                  { key: 'Message of the day', value: motd, fenced: true, unavailable: false }
                ]
              }
            }
          : {})
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/auditIdentities.test.ts src/renderer/src/lib/auditDetails.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/renderer/src/lib/auditIdentities.ts src/renderer/src/lib/auditIdentities.test.ts
git commit -m "feat(audit): rows carry parsed detail models; drop raw-line fragment

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `GuildLog` — preview, chevron, toggle, `DetailCard`

**Files:**
- Modify: `src/renderer/src/components/GuildLog.tsx`

**Interfaces:**
- Consumes: `RowModel.details` (Task 3), `detailBlocks`, `detailPreview`, `DetailBlock`, `DetailModel` from `../lib/auditDetails` (Task 2), `ChevronRight` from `lucide-react`.
- Produces: user-facing behavior only (no exports consumed elsewhere).

No unit-test harness exists for components (per spec, behavior is verified in the running app); the gates for this task are typecheck + full suite + visual verification.

- [ ] **Step 1: Add imports and expansion state**

In `GuildLog.tsx`, extend the lucide import:

```ts
import { RefreshCw, ScrollText, Search, Loader2, ChevronRight } from 'lucide-react'
```

Add below the existing lib imports:

```ts
import { detailBlocks, detailPreview, type DetailBlock, type DetailModel } from '../lib/auditDetails'
```

Inside `GuildLog()`, next to the other `useState` hooks:

```ts
  // Expanded row uids. Survives list refreshes; stale uids (filtered/switched
  // away) are harmless — absent rows render nothing.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggleRow = useCallback((uid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }, [])
```

Pass them to the row (in the `g.rows.map`):

```tsx
                {g.rows.map((e) => (
                  <EventRow
                    key={e.uid}
                    event={e}
                    index={index}
                    open={expanded.has(e.uid)}
                    onToggle={toggleRow}
                  />
                ))}
```

- [ ] **Step 2: Rewrite `EventRow` with preview + chevron + toggle**

Replace the whole `EventRow` function:

```tsx
function EventRow({
  event,
  index,
  open,
  onToggle
}: {
  event: AuditEvent
  index: IdentityIndex
  open: boolean
  onToggle: (uid: string) => void
}): JSX.Element {
  const m = describeEvent(event, index)
  const preview = m.details ? detailPreview(m.details) : []
  const expandable = m.details !== undefined
  return (
    <>
      <div
        className={`flex items-center gap-2.5 border-b border-panel-line/55 px-1.5 py-1.5 text-sm hover:bg-panel-hover ${
          expandable ? 'cursor-pointer' : ''
        }`}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        onClick={expandable ? () => onToggle(event.uid) : undefined}
        onKeyDown={
          expandable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onToggle(event.uid)
                }
              }
            : undefined
        }
      >
        <span className="w-16 flex-none whitespace-nowrap text-xs tabular-nums text-ink-faint">
          {timeOf(event.time)}
        </span>
        <span
          className={`flex-none rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
            event.source === 'gw2'
              ? 'bg-emerald-500/13 text-emerald-400'
              : 'bg-indigo-500/16 text-indigo-300'
          }`}
        >
          {event.source}
        </span>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
          {m.fallback ? (
            <span className="text-ink">{m.fallback}</span>
          ) : (
            <>
              {m.lead && <IdentityChip chip={m.lead} />}
              {m.action.length > 0 && (
                <span className="text-ink-dim">
                  {m.action.map((s, i) => (
                    <span key={i} className={s.b ? 'font-medium text-ink' : undefined}>
                      {s.t}
                    </span>
                  ))}
                </span>
              )}
              {m.channel && <ChannelTag channel={m.channel} />}
              {m.trail && <IdentityChip chip={m.trail} />}
              {preview.length > 0 && (
                <span className="min-w-0 max-w-full flex-shrink truncate text-xs text-ink-faint">
                  {preview.map((s) => s.t).join('')}
                </span>
              )}
            </>
          )}
        </span>
        {expandable && (
          <ChevronRight
            size={13}
            className={`flex-none text-ink-faint transition-transform ${open ? 'rotate-90' : ''}`}
          />
        )}
      </div>
      {open && m.details && <DetailCard model={m.details} />}
    </>
  )
}
```

- [ ] **Step 3: Add `DetailCard` + block views**

Add below `ChannelTag` in `GuildLog.tsx`:

```tsx
const DETAIL_BODY =
  'max-h-64 overflow-y-auto whitespace-pre-wrap rounded border px-2 py-1.5 font-mono text-xs'

function DetailLabel({ text, tone }: { text: string; tone?: 'red' | 'green' }): JSX.Element {
  const color =
    tone === 'red' ? 'text-red-300/80' : tone === 'green' ? 'text-emerald-300/80' : 'text-ink-faint'
  return (
    <div className={`mb-1 text-[9px] font-bold uppercase tracking-wider ${color}`}>{text}</div>
  )
}

function DetailBlockView({ b }: { b: DetailBlock }): JSX.Element {
  switch (b.kind) {
    case 'diff':
      return (
        <>
          <div>
            <DetailLabel text="Before" tone="red" />
            <div
              className={`${DETAIL_BODY} border-red-400/20 bg-red-400/5 text-red-200/70 line-through decoration-red-400/50`}
            >
              {b.before.value}
            </div>
          </div>
          <div>
            <DetailLabel text="After" tone="green" />
            <div className={`${DETAIL_BODY} border-emerald-400/20 bg-emerald-400/5 text-emerald-100/80`}>
              {b.after.value}
            </div>
          </div>
        </>
      )
    case 'tags':
      return (
        <div>
          <DetailLabel text={b.op === 'add' ? 'Added' : 'Removed'} />
          <div className="flex flex-wrap gap-1.5">
            {b.items.map((it, i) => (
              <span
                key={i}
                className={`rounded border px-1.5 py-0.5 text-[11px] ${
                  it.unresolved
                    ? 'border-dashed border-panel-line2 font-mono text-ink-faint'
                    : b.op === 'add'
                      ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200/90'
                      : 'border-red-400/20 bg-red-400/5 text-red-200/70 line-through'
                }`}
              >
                {b.op === 'add' ? '+' : '−'} {it.label}
              </span>
            ))}
          </div>
        </div>
      )
    case 'unavailable':
      return <div className="text-xs italic text-ink-faint">{b.field.key} unavailable</div>
    case 'block':
      return (
        <div>
          <DetailLabel text={b.field.key} />
          <div className={`${DETAIL_BODY} border-panel-line2 bg-panel-raised text-ink-dim`}>
            {b.field.value}
          </div>
        </div>
      )
    case 'arrow':
      return (
        <div className="flex items-baseline gap-2 text-xs">
          <span className="w-24 flex-none text-ink-faint">{b.key}</span>
          <span>
            <span className="text-ink-faint">{b.from}</span>
            <span className="text-ink-faint"> → </span>
            <span className="text-ink">{b.to}</span>
          </span>
        </div>
      )
    case 'kv':
      return (
        <div className="flex items-baseline gap-2 text-xs">
          <span className="w-24 flex-none text-ink-faint">{b.key}</span>
          <span className="text-ink-dim">{b.value}</span>
        </div>
      )
  }
}

function DetailCard({ model }: { model: DetailModel }): JSX.Element {
  return (
    <div className="mb-2 ml-[76px] mr-2 mt-0.5 flex flex-col gap-2 rounded-md border border-panel-line bg-panel-sunk px-3 py-2.5">
      {detailBlocks(model).map((b, i) => (
        <DetailBlockView key={i} b={b} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all test files pass (no component tests exist — this catches type breaks and lib regressions).

- [ ] **Step 5: Visual verification**

Launch the app (`npm run dev`) or use the installed build, open the Guild Log:
- The `message_edit` test event from today shows `“test” → “test 2”` as its preview, a chevron, and expands to red/green Before/After blocks.
- `member_join` rows show no chevron and do not react to clicks.
- GW2 `motd` rows (if any) expand to a content block.
- Keyboard: Tab to a row, Enter toggles.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/GuildLog.tsx
git commit -m "feat(audit): expandable log rows with detail cards + previews

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
