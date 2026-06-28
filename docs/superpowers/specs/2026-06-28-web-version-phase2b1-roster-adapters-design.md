# Web Version — Phase 2b-1: Extract AxiTools Roster Adapters into Shared Core

**Date:** 2026-06-28
**Status:** Approved (design)

## Background & Goal

Phase 2 (web companion) was decomposed into 2a/2b/2c. 2a shipped the renderer
data-layer seam. **2b** is the web client implementation; it is large and
runtime-dependent, so it is being sliced into small, individually
**test-verifiable** increments rather than one unverifiable pass:

- **2b-1 (this spec)** — extract the pure AxiTools-response **adapters** out of
  `src/main/index.ts` into a tested, platform-agnostic module. Invisible
  refactor (desktop behavior identical); adds the first tests for these parsers;
  prerequisite for both the web client and the later `assembleRoster` extraction.
- **2b-2** — extract the platform-agnostic roster **assembly** (`buildRoster`'s
  shaping around `reconcileRoster`) behind injected fetchers.
- **2b-3+** — the web `AxiClient` implementation (Supabase-direct + Edge
  Functions + browser GW2), device-local settings, etc.

**2b-1's job:** move four pure functions (and their private helpers + one local
type) that parse raw AxiTools bot responses into the shapes `reconcileRoster`
consumes, into `src/main/roster/adapters.ts`, with characterization tests — zero
behavior change.

## Why these functions

The web client (2b-3) will call the Phase-1 `axitools` Edge Function and receive
the **same raw AxiTools JSON** the desktop receives today. Parsing that JSON into
`LinkedMemberRaw[]` / `DiscordMemberRaw[]` / `DiscordRole[]` / bound-guild-ids is
identical work on both platforms, so it belongs in shared, tested code rather
than buried as private functions in the Electron main entry. They currently have
**no tests**.

## Scope

**In scope:** move these from `src/main/index.ts` into a new
`src/main/roster/adapters.ts`, exporting the public ones and keeping the helpers
module-private; rewire the three call sites in `index.ts` to import them; add a
characterization test file.

The functions (verbatim, behavior preserved):
- `asLinkedMembers(raw: unknown): LinkedMemberRaw[]` — **export**
- `asDiscordRoles(overview: unknown): DiscordRole[]` — **export**
- `asDiscordMembers(overview: unknown): DiscordMemberRaw[]` — **export**
- `parseBoundGw2Guilds(raw: unknown): string[]` — **export**
- `isBot(m): boolean` — private helper (used by `asDiscordMembers`)
- `parseRoleIds(raw): string[]` — private helper (used by `asDiscordMembers`)
- `interface DiscordRole { id; name; colorRaw; iconHash; emoji }` — **export**
  (move the local copy from `index.ts`; this is the main-process definition the
  adapters return)

**Out of scope / deferred:**
- The `buildRoster`/`assembleRoster` extraction (2b-2).
- Any web client, Supabase, or Edge Function code (2b-3+).
- Touching `src/preload` (it has its own hand-synced `DiscordRole` copy at
  `index.d.ts:176` — leave it).
- Any behavior change. Desktop roster output must be byte-identical.

## Current State

In `src/main/index.ts`:
- `asLinkedMembers` (~line 229), `DiscordRole` interface (~250) + `asDiscordRoles`
  (~264), `parseBoundGw2Guilds` (~283), `asDiscordMembers` (~304) + `isBot`/
  `parseRoleIds` helpers (~320-345). All private, untested.
- Call sites: `buildRoster` uses `asLinkedMembers`, `asDiscordMembers`,
  `asDiscordRoles`; the `discord:members` handler (~line 1373) uses
  `asDiscordMembers`; the `connection:boundGw2Guilds` handler (~line 933) uses
  `parseBoundGw2Guilds`.
- Types `LinkedMemberRaw` / `DiscordMemberRaw` come from `./rosterReconcile`
  (already imported in `index.ts`).

## Architecture

New module `src/main/roster/adapters.ts`:

- Imports `LinkedMemberRaw`, `DiscordMemberRaw` (type-only) from
  `../rosterReconcile`.
- Defines and **exports** `interface DiscordRole` (moved verbatim from
  `index.ts`).
- **Exports** `asLinkedMembers`, `asDiscordRoles`, `asDiscordMembers`,
  `parseBoundGw2Guilds` (bodies moved verbatim).
- Keeps `isBot`, `parseRoleIds` as module-private (not exported).
- No Electron / Node-only imports — pure functions over `unknown`, so a future
  web build can import the module unchanged.

`src/main/index.ts`:
- Adds `import { asLinkedMembers, asDiscordRoles, asDiscordMembers, parseBoundGw2Guilds, type DiscordRole } from './roster/adapters'`.
- Removes the six moved function definitions and the local `DiscordRole`
  interface.
- The three call sites are unchanged in behavior (same function names, now
  imported).

## Data Flow

Unchanged. `buildRoster` / `discord:members` / `connection:boundGw2Guilds` call
the same functions; they now live in an imported module instead of the same file.

## Error Handling

No new error semantics. The adapters are defensive parsers over `unknown`
(returning `[]` / default-filled records on malformed input); that behavior moves
verbatim.

## Testing

Vitest, `--pool=forks --poolOptions.forks.maxForks=2`. New
`src/main/roster/adapters.test.ts` characterization tests (the first coverage
these parsers get):

- **`asLinkedMembers`**: a representative `members-linked` array → mapped
  `member_id`/`member_name`/`accounts[]` (account_name/characters/guild_labels);
  non-array → `[]`; rows missing `member_id` filtered out.
- **`asDiscordRoles`**: an overview with `roles[]` → id/name/colorRaw (accepts
  `color` int, `colour` string, else null)/iconHash/emoji; non-object → `[]`;
  name falls back to id.
- **`asDiscordMembers`**: an overview with `members[]` → id/name/display_name/
  roles (parsed from `['id']` AND `[{id}]` shapes via `parseRoleIds`)/bot
  (detects `bot`/`is_bot`/`isBot`/`user.bot` via `isBot`); rows missing `id`
  filtered out.
- **`parseBoundGw2Guilds`**: array-of-objects (`gw2_guild_id`/`guild_id`),
  array-of-strings (GUID-shaped only), and map shapes (`{roles}`/`{guild_roles}`/
  bare) → unique GW2-guild-id list.

Existing suite + `npm run typecheck` must stay green (the rewired `index.ts` and
all call sites compile and behave identically).

## Out of Scope (2b-1)

- `buildRoster`/`assembleRoster` extraction; any web/Supabase/Edge code.
- Changing `src/preload` or the renderer.
- Any behavior change to roster output.
