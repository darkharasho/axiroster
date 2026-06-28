# Web Version — Phase 2b-1: Extract AxiTools Roster Adapters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move four pure AxiTools-response parsers (+ two private helpers + the local `DiscordRole` type) out of `src/main/index.ts` into a tested, platform-agnostic `src/main/roster/adapters.ts`, with zero desktop behavior change.

**Architecture:** A new pure module exports `asLinkedMembers`, `asDiscordRoles`, `asDiscordMembers`, `parseBoundGw2Guilds`, and `DiscordRole`; keeps `isBot`/`parseRoleIds` private. `index.ts` imports them and deletes the local definitions. The three call sites are unchanged. A new characterization test gives these parsers their first coverage.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

## Global Constraints

- **Behavior must be byte-identical.** The functions are moved VERBATIM; only their location changes. No logic edits.
- **Only `src/main/index.ts` and the two new files under `src/main/roster/` change.** Do NOT touch `src/preload` (it keeps its own hand-synced `DiscordRole` at `index.d.ts:176`), the renderer, or any other file.
- `src/main/roster/adapters.ts` must be **pure** — no Electron/Node-only imports; only a type-only import of `LinkedMemberRaw`/`DiscordMemberRaw` from `../rosterReconcile`.
- Exports: `asLinkedMembers`, `asDiscordRoles`, `asDiscordMembers`, `parseBoundGw2Guilds`, `DiscordRole`. `isBot` and `parseRoleIds` stay module-private (NOT exported).
- **Tests:** Vitest, always `--pool=forks --poolOptions.forks.maxForks=2`. `npm run typecheck` must pass.

---

### Task 1: Extract the adapters into a tested shared module

**Files:**
- Create: `src/main/roster/adapters.ts`
- Create: `src/main/roster/adapters.test.ts`
- Modify: `src/main/index.ts` (add import; delete the moved definitions at ~lines 229–345)

**Interfaces:**
- Produces: `asLinkedMembers(raw: unknown): LinkedMemberRaw[]`, `asDiscordRoles(overview: unknown): DiscordRole[]`, `asDiscordMembers(overview: unknown): DiscordMemberRaw[]`, `parseBoundGw2Guilds(raw: unknown): string[]`, `interface DiscordRole`.
- Consumes: `LinkedMemberRaw`, `DiscordMemberRaw` (type-only) from `../rosterReconcile`.

- [ ] **Step 1: Write the failing characterization test**

Create `src/main/roster/adapters.test.ts`:

```ts
// src/main/roster/adapters.test.ts
import { test, expect } from 'vitest'
import {
  asLinkedMembers,
  asDiscordRoles,
  asDiscordMembers,
  parseBoundGw2Guilds
} from './adapters'

test('asLinkedMembers maps members-linked rows and drops rows without member_id', () => {
  const raw = [
    {
      member_id: '111',
      member_name: 'Alice',
      accounts: [{ account_name: 'Alice.1234', characters: ['Char A'], guild_labels: { g1: 'L' } }]
    },
    { member_name: 'NoId' }, // dropped — no member_id
    null
  ]
  expect(asLinkedMembers(raw)).toEqual([
    {
      member_id: '111',
      member_name: 'Alice',
      accounts: [{ account_name: 'Alice.1234', characters: ['Char A'], guild_labels: { g1: 'L' } }]
    }
  ])
  expect(asLinkedMembers('nope')).toEqual([])
})

test('asDiscordRoles parses color/colour, icon, emoji and falls back name->id', () => {
  const out = asDiscordRoles({
    roles: [
      { id: '1', name: 'Officer', color: 16711680, icon: 'abc', unicode_emoji: '⭐' },
      { id: '2', colour: '#00ff00' }, // no name -> id; colour string
      { bad: true } // no id -> dropped
    ]
  })
  expect(out).toEqual([
    { id: '1', name: 'Officer', colorRaw: 16711680, iconHash: 'abc', emoji: '⭐' },
    { id: '2', name: '2', colorRaw: '#00ff00', iconHash: null, emoji: null }
  ])
  expect(asDiscordRoles(null)).toEqual([])
})

test('asDiscordMembers parses role-id shapes, bot flags, and drops rows without id', () => {
  const out = asDiscordMembers({
    members: [
      { id: '1', name: 'a', display_name: 'A', roles: ['10', { id: 20 }] },
      { id: '2', is_bot: true },
      { id: '3', user: { bot: true } },
      { name: 'noId' } // dropped
    ]
  })
  expect(out).toEqual([
    { id: '1', name: 'a', display_name: 'A', roles: ['10', '20'], bot: false },
    { id: '2', name: undefined, display_name: undefined, roles: [], bot: true },
    { id: '3', name: undefined, display_name: undefined, roles: [], bot: true }
  ])
  expect(asDiscordMembers(undefined)).toEqual([])
})

test('parseBoundGw2Guilds reads array-of-objects, array-of-strings, and map shapes', () => {
  const GUID = 'ABCDEF01-2345-6789-ABCD-EF0123456789'
  const GUID2 = '11111111-2222-3333-4444-555555555555'
  expect(parseBoundGw2Guilds([{ gw2_guild_id: GUID }, { guild_id: GUID2 }])).toEqual([GUID, GUID2])
  expect(parseBoundGw2Guilds([GUID, 'not-a-guid'])).toEqual([GUID])
  expect(parseBoundGw2Guilds({ roles: { [GUID]: 'role1', notguid: 'x' } })).toEqual([GUID])
  expect(parseBoundGw2Guilds({ [GUID]: 'r' })).toEqual([GUID])
  expect(parseBoundGw2Guilds(42)).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/main/roster/adapters.test.ts`
Expected: FAIL — cannot find module `./adapters`.

- [ ] **Step 3: Create the adapters module (functions moved VERBATIM from index.ts)**

Create `src/main/roster/adapters.ts`:

```ts
// src/main/roster/adapters.ts
// Pure parsers from raw AxiTools bot responses into the shapes reconcileRoster
// consumes. Platform-agnostic (no Electron/Node imports) so the web client can
// reuse them on the same raw JSON the Phase-1 axitools Edge Function returns.
// Moved verbatim from src/main/index.ts.
import type { LinkedMemberRaw, DiscordMemberRaw } from '../rosterReconcile'

export function asLinkedMembers(raw: unknown): LinkedMemberRaw[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
    .map((m) => ({
      member_id: String(m.member_id ?? ''),
      member_name: typeof m.member_name === 'string' ? m.member_name : undefined,
      accounts: Array.isArray(m.accounts)
        ? (m.accounts as Record<string, unknown>[]).map((a) => ({
            account_name: typeof a.account_name === 'string' ? a.account_name : undefined,
            characters: Array.isArray(a.characters) ? (a.characters as string[]) : undefined,
            guild_labels:
              a.guild_labels && typeof a.guild_labels === 'object'
                ? (a.guild_labels as Record<string, string>)
                : undefined
          }))
        : []
    }))
    .filter((m) => m.member_id)
}

// Raw role fields straight from the overview. Color/icon *presentation* (hex,
// black-as-default, CDN url) is done in the renderer (src/lib/roleStyle) so it
// hot-reloads — keep this a pass-through.
export interface DiscordRole {
  id: string
  name: string
  /** Raw Discord color: an int, a hex string, or null. */
  colorRaw: number | string | null
  /** Custom role icon hash (turned into a CDN url renderer-side), or null. */
  iconHash: string | null
  /** Role's unicode emoji, or null. */
  emoji: string | null
}

export function asDiscordRoles(overview: unknown): DiscordRole[] {
  const root = overview as Record<string, unknown> | null
  const roles = root && Array.isArray(root.roles) ? root.roles : []
  return (roles as Record<string, unknown>[])
    .filter((r) => r && typeof r === 'object' && r.id !== undefined)
    .map((r) => {
      const raw = r.color ?? r.colour
      return {
        id: String(r.id),
        name: typeof r.name === 'string' ? r.name : String(r.id),
        colorRaw: typeof raw === 'number' || typeof raw === 'string' ? raw : null,
        iconHash: typeof r.icon === 'string' && r.icon ? r.icon : null,
        emoji: typeof r.unicode_emoji === 'string' && r.unicode_emoji ? r.unicode_emoji : null
      }
    })
}

// AxiTools maps each Discord server to its GW2 guild(s) via the guild-roles
// config (gw2 guild id -> member role id). Pull the bound GW2 guild ids so the
// app can keep the GW2 guild and Discord server as one 1:1 connection.
export function parseBoundGw2Guilds(raw: unknown): string[] {
  const ids = new Set<string>()
  const looksGw2 = (s: string): boolean => /^[0-9A-F]{8}-/i.test(s)
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (r && typeof r === 'object') {
        const v = (r as Record<string, unknown>).gw2_guild_id ?? (r as Record<string, unknown>).guild_id
        if (typeof v === 'string') ids.add(v)
      } else if (typeof r === 'string' && looksGw2(r)) ids.add(r)
    }
  } else if (raw && typeof raw === 'object') {
    // map shape: { "<gw2GuildId>": "<roleId>", ... } or { roles: {...} }
    const obj = (raw as Record<string, unknown>).roles ?? (raw as Record<string, unknown>).guild_roles ?? raw
    if (obj && typeof obj === 'object') {
      for (const k of Object.keys(obj as Record<string, unknown>)) if (looksGw2(k)) ids.add(k)
    }
  }
  return [...ids]
}

export function asDiscordMembers(overview: unknown): DiscordMemberRaw[] {
  const root = overview as Record<string, unknown> | null
  const members = root && Array.isArray(root.members) ? root.members : []
  return (members as Record<string, unknown>[])
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      id: String(m.id ?? ''),
      name: typeof m.name === 'string' ? m.name : undefined,
      display_name: typeof m.display_name === 'string' ? m.display_name : undefined,
      roles: parseRoleIds(m.roles ?? m.role_ids ?? m.roleIds),
      bot: isBot(m)
    }))
    .filter((m) => m.id)
}

/** Bots come back differently across bot builds — flag any of the known shapes. */
function isBot(m: Record<string, unknown>): boolean {
  const user = m.user as Record<string, unknown> | undefined
  return (
    m.bot === true ||
    m.is_bot === true ||
    m.isBot === true ||
    (user ? user.bot === true : false)
  )
}

/** Member roles come back as ['id', …] or [{id}, …] depending on the bot build. */
function parseRoleIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((r) =>
      typeof r === 'string' || typeof r === 'number'
        ? String(r)
        : r && typeof r === 'object' && (r as Record<string, unknown>).id !== undefined
          ? String((r as Record<string, unknown>).id)
          : ''
    )
    .filter(Boolean)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/main/roster/adapters.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Rewire `src/main/index.ts`**

1. Add an import alongside the existing `./rosterReconcile` import:
   ```ts
   import {
     asLinkedMembers,
     asDiscordRoles,
     asDiscordMembers,
     parseBoundGw2Guilds,
     type DiscordRole
   } from './roster/adapters'
   ```
2. Delete the now-duplicated definitions from `index.ts`: the functions `asLinkedMembers`, `asDiscordRoles`, `parseBoundGw2Guilds`, `asDiscordMembers`, `isBot`, `parseRoleIds`, and the local `interface DiscordRole` (with their doc comments) — currently the contiguous block at lines ~229–345, ending just before the `// ---- roster reconciliation ----` divider. Do NOT remove `interface SourceStatus`, `interface DiscordCandidate`, or anything after that divider.
3. Leave the three call sites unchanged: `buildRoster` (uses `asLinkedMembers`/`asDiscordMembers`/`asDiscordRoles`), the `discord:members` handler (uses `asDiscordMembers`), and the `connection:boundGw2Guilds` handler (uses `parseBoundGw2Guilds`) — they now resolve to the imported functions.

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npm test`
Expected: all suites pass (the new `adapters.test.ts` plus everything pre-existing — nothing regressed).

Run: `npm run typecheck`
Expected: no errors. (The `DiscordRole` type used inside `buildRoster` now comes from the import; `isBot`/`parseRoleIds` are no longer referenced in `index.ts`.)

- [ ] **Step 7: Commit**

```bash
git add src/main/roster/adapters.ts src/main/roster/adapters.test.ts src/main/index.ts
git commit -m "refactor(roster): extract AxiTools adapters to tested src/main/roster/adapters.ts"
```

---

## Self-Review Notes

- **Spec coverage:** new pure `adapters.ts` exporting the four parsers + `DiscordRole`, helpers private (Step 3); `index.ts` rewired to import them and the local defs deleted (Step 5); characterization tests covering all four parsers' documented branches (Step 1); full suite + typecheck as the no-regression gate (Step 6). `src/preload`, renderer, and roster behavior untouched.
- **Verbatim move:** the function bodies in Step 3 are copied character-for-character from `index.ts` (only `export` added to the four public ones + `DiscordRole`); no logic change, so desktop output is byte-identical.
- **Type consistency:** `DiscordRole` is defined once in `adapters.ts` and imported into `index.ts` (the preload copy is a separate hand-synced renderer type, intentionally left alone). `LinkedMemberRaw`/`DiscordMemberRaw` are imported type-only from `../rosterReconcile`, matching `index.ts`'s existing usage.
- **Helper privacy:** `isBot`/`parseRoleIds` are referenced only by `asDiscordMembers`, so they move with it and stay unexported; after the move `index.ts` no longer references them.
