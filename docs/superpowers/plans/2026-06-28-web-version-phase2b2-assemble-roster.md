# Web Version — Phase 2b-2: Extract `assembleRoster` Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `buildRoster`'s ~200-line platform-agnostic assembly out of `src/main/index.ts` into a shared `src/main/roster/assembleRoster.ts` that takes injected fetchers, leaving `buildRoster` a thin desktop wrapper — with byte-identical `RosterPayload` output.

**Architecture:** A new pure module exports `RosterAssemblyDeps`, `GuildMeta`, `assembleRoster(deps)`, and the moved types `RosterPayload`/`SourceStatus`/`DiscordCandidate`. The assembler body is `buildRoster`'s current body moved verbatim with each direct dependency (`axitools()`/`gw2()`/`guilds.active()`/`links`/`roster`/`syncedMembers`/`AxibridgeClient`) swapped for a `deps.*` call. `index.ts`'s `buildRoster` becomes a wrapper that supplies those deps from its existing closures.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

## Global Constraints

- **Byte-identical `RosterPayload`.** The assembly logic moves VERBATIM; only direct dependency calls become `deps.*` calls. No reordering of branches, no changed conditions, no altered warning strings, no changed field values.
- **No circular import.** The shared types (`RosterPayload`, `SourceStatus`, `DiscordCandidate`) move OUT of `index.ts` INTO `assembleRoster.ts` (exported); `index.ts` imports them back. `assembleRoster.ts` must NOT import from `index.ts`.
- **`assembleRoster.ts` is pure** — no Electron/Node-only imports. It imports `reconcileRoster`/`rosterSourceFor`/`isReservedAnnotationKey` and the raw types from `../rosterReconcile`, the adapters from `./adapters`, and `RepoRef`/`BridgePlayerMetrics`/`AttendanceRaidDTO` from `../axibridgeClient`. All I/O comes through `deps`.
- **Only `src/main/index.ts` + the two new `src/main/roster/assembleRoster.{ts,test.ts}` change.** Do NOT touch `src/preload` (its hand-synced copies of these types stay), the renderer, `reconcileRoster`, or the adapters.
- `buildRosterDeduped`, the `roster:build` IPC handler, and all `RosterPayload` consumers stay unchanged.
- **Tests:** Vitest, `--pool=forks --poolOptions.forks.maxForks=2`. Full `npm test` + `npm run typecheck` green at the end.

---

### Task 1: Extract `assembleRoster` behind injected fetchers

**Files:**
- Create: `src/main/roster/assembleRoster.ts`
- Create: `src/main/roster/assembleRoster.test.ts`
- Modify: `src/main/index.ts` (move types + buildRoster body out; add wrapper + imports)

**Interfaces:**
- Consumes: `reconcileRoster`, `rosterSourceFor`, `isReservedAnnotationKey`, `ReconciledMember`, `InGameMemberRaw`, `ManualLinkRaw`, `AnnotationRaw`, `DiscordMemberRaw`, `LinkedMemberRaw` from `../rosterReconcile`; `asLinkedMembers`/`asDiscordMembers`/`asDiscordRoles`/`DiscordRole` from `./adapters`; `RepoRef`/`BridgePlayerMetrics`/`AttendanceRaidDTO` from `../axibridgeClient`.
- Produces: `interface GuildMeta`, `interface RosterAssemblyDeps`, `interface SourceStatus`, `interface DiscordCandidate`, `interface RosterPayload`, `async function assembleRoster(deps: RosterAssemblyDeps): Promise<RosterPayload>`.

- [ ] **Step 1: Read the current `buildRoster` and the types to move**

In `src/main/index.ts`, read and understand:
- `interface SourceStatus` (~line 237), `interface DiscordCandidate` (~line 250), `interface RosterPayload` (~line 256).
- `async function buildRoster(): Promise<RosterPayload>` (~lines 287–489) — the full body, including the Discord fetch + one-banner error fold, the live-vs-synced GW2 branch (incl. the leader-only 403 headline and best-effort ranks), the `reconcileRoster` call, the AxiBridge metrics + attendance best-effort blocks, the candidate-pool union, and the final `return { … }` payload.

This is the code you will MOVE. Preserve it exactly.

- [ ] **Step 2: Write the failing characterization test**

Create `src/main/roster/assembleRoster.test.ts`. Use a fake `RosterAssemblyDeps` (no real I/O). The fake's `activeGuild` returns a `GuildMeta`; the fetchers are `vi.fn()`s returning canned raw responses.

```ts
// src/main/roster/assembleRoster.test.ts
import { test, expect, vi } from 'vitest'
import { assembleRoster, type RosterAssemblyDeps, type GuildMeta } from './assembleRoster'

const GUILD: GuildMeta = {
  discordGuildId: 'd1',
  discordGuildName: 'Disc',
  gw2GuildId: 'g1',
  gw2GuildName: 'GW2',
  hasAxitoolsKey: true,
  hasGw2Key: true,
  memberRoleId: 'role1',
  bridgeRepos: [],
  retentionEnabled: false
}

function deps(over: Partial<RosterAssemblyDeps> = {}, guild: GuildMeta | null = GUILD): RosterAssemblyDeps {
  return {
    activeGuild: () => guild,
    membersLinked: vi.fn(async () => []),
    discordOverview: vi.fn(async () => ({ members: [{ id: 'm1', name: 'Alice' }], roles: [] })),
    inGameMembers: vi.fn(async () => [{ name: 'Alice.1', rank: 'Member', joined: null }]),
    guildRanks: vi.fn(async () => [{ id: 'Member', order: 1 }]),
    syncedMembers: () => [],
    manualLinks: () => [],
    annotations: () => [],
    bridgeMetrics: vi.fn(async () => new Map()),
    attendance: vi.fn(async () => []),
    ...over
  }
}

test('live path: configured Discord + GW2 leader key produces loaded sources, no warnings', async () => {
  const p = await assembleRoster(deps())
  expect(p.sources.gw2.loaded).toBe(true)
  expect(p.sources.gw2.count).toBe(1)
  expect(p.sources.discord.loaded).toBe(true)
  expect(p.warnings).toEqual([])
  expect(p.rankOrder).toEqual({ Member: 1 })
  expect(Array.isArray(p.members)).toBe(true)
})

test('synced path: no leader key builds in-game roster from synced members', async () => {
  const d = deps(
    {
      syncedMembers: () => [{ name: 'Bob.2', rank: 'Member', joined: null }],
      inGameMembers: vi.fn(async () => {
        throw new Error('should not be called')
      })
    },
    { ...GUILD, hasGw2Key: false, gw2GuildId: 'g1' }
  )
  const p = await assembleRoster(d)
  expect(p.sources.gw2.count).toBe(1)
  expect(d.inGameMembers).not.toHaveBeenCalled()
})

test('Discord failure folds into a single warning and sets discord error', async () => {
  const d = deps({
    membersLinked: vi.fn(async () => {
      throw new Error('bot down')
    }),
    discordOverview: vi.fn(async () => {
      throw new Error('bot down')
    })
  })
  const p = await assembleRoster(d)
  expect(p.warnings.filter((w) => w.startsWith('Discord unavailable')).length).toBe(1)
  expect(p.sources.discord.error).toBeTruthy()
})

test('GW2 leader-only 403 appends the leader headline; rank failure is swallowed', async () => {
  const d = deps({
    inGameMembers: vi.fn(async () => {
      throw new Error('403 restricted')
    }),
    guildRanks: vi.fn(async () => {
      throw new Error('ranks fail')
    })
  })
  const p = await assembleRoster(d)
  expect(p.sources.gw2.error).toMatch(/leader/i)
  expect(p.warnings.some((w) => w.startsWith('GW2 in-game roster unavailable'))).toBe(true)
})

test('AxiBridge is best-effort and attendance is gated on retentionEnabled', async () => {
  const d = deps(
    {
      bridgeMetrics: vi.fn(async () => {
        throw new Error('bridge down')
      }),
      attendance: vi.fn(async () => [])
    },
    { ...GUILD, bridgeRepos: [{ owner: 'o', repo: 'r' }], retentionEnabled: false }
  )
  const p = await assembleRoster(d)
  expect(p.warnings.some((w) => w.startsWith('AxiBridge metrics unavailable'))).toBe(true)
  expect(d.attendance).not.toHaveBeenCalled() // retentionEnabled false
})

test('no active guild yields the "No guild added" source errors and empty members', async () => {
  const p = await assembleRoster(deps({}, null))
  expect(p.members).toEqual([])
  expect(p.sources.gw2.error).toMatch(/No guild added/)
  expect(p.sources.discord.error).toMatch(/No guild added/)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/main/roster/assembleRoster.test.ts`
Expected: FAIL — cannot find module `./assembleRoster`.

- [ ] **Step 4: Create `assembleRoster.ts`**

Create `src/main/roster/assembleRoster.ts`:

1. **Imports** (pure only):
   ```ts
   import {
     reconcileRoster,
     rosterSourceFor,
     isReservedAnnotationKey,
     type ReconciledMember,
     type InGameMemberRaw,
     type ManualLinkRaw,
     type AnnotationRaw,
     type DiscordMemberRaw,
     type LinkedMemberRaw
   } from '../rosterReconcile'
   import { asLinkedMembers, asDiscordMembers, asDiscordRoles, type DiscordRole } from './adapters'
   import type { RepoRef, BridgePlayerMetrics, AttendanceRaidDTO } from '../axibridgeClient'
   ```
   (If `rosterSourceFor`/`isReservedAnnotationKey` live in a different module than `rosterReconcile`, import them from their real location — confirm with Grep; `rosterSourceFor` is currently exported from `index.ts`, so MOVE it into `assembleRoster.ts` and export it, then import it back into `index.ts`. `isReservedAnnotationKey` is exported from `rosterReconcile`.)
2. **Move the three type definitions** `SourceStatus`, `DiscordCandidate`, `RosterPayload` here VERBATIM and `export` them.
3. **Add** `export interface GuildMeta { … }` and `export interface RosterAssemblyDeps { … }` exactly as in the design spec (`docs/.../2026-06-28-web-version-phase2b2-assemble-roster-design.md`).
4. **Add** `export async function assembleRoster(deps: RosterAssemblyDeps): Promise<RosterPayload>` — paste `buildRoster`'s current body, then mechanically swap each dependency:
   - `guilds.active()` → `deps.activeGuild()` (it returns the `GuildMeta` already; adapt the field reads — the wrapper supplies `hasAxitoolsKey`/`hasGw2Key` so replace `Boolean(guild?.axitoolsKey)` → `guild.hasAxitoolsKey`, `Boolean(guild?.gw2ApiKey)` → `guild.hasGw2Key`; `guild?.discordGuildId` → `guild?.discordGuildId`, etc., using `GuildMeta`'s fields).
   - `axitools().membersLinked(gid)` → `deps.membersLinked(gid)`; `axitools().discordOverview(gid, true)` → `deps.discordOverview(gid)`.
   - `gw2().guildMembers(gid)` → `deps.inGameMembers(gid)`; `gw2().guildRanks(gid)` → `deps.guildRanks(gid)`.
   - the synced `for (const payload of syncedMembers.values()) { … }` block → `const synced = deps.syncedMembers(); for (const m of synced) inGameRoster.push(m)` (the wrapper does the `name`/`rank`/`joined` extraction; `deps.syncedMembers()` returns `InGameMemberRaw[]`).
   - `links.list().map(...)` → `deps.manualLinks()`; `roster.list().filter(...)` → `deps.annotations()`.
   - `new AxibridgeClient(repos).playerMetrics()` → `deps.bridgeMetrics(repos)`; `new AxibridgeClient(repos).attendanceRaids()` → `deps.attendance(repos)`.
   - keep ALL `try/catch`, warning strings, `SourceStatus` construction, `reconcileRoster` call, candidate-pool union, and the final `return { … }` IDENTICAL.

- [ ] **Step 5: Run the characterization test**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/main/roster/assembleRoster.test.ts`
Expected: PASS (6 tests). Fix the assembler until green, without changing assembly semantics.

- [ ] **Step 6: Rewire `src/main/index.ts`**

1. Remove the local `SourceStatus`, `DiscordCandidate`, `RosterPayload` interface definitions (now imported).
2. If `rosterSourceFor` was moved into `assembleRoster.ts`, remove its definition from `index.ts` (and its `export`); import it back.
3. Add:
   ```ts
   import {
     assembleRoster,
     rosterSourceFor,
     type RosterAssemblyDeps,
     type GuildMeta,
     type RosterPayload,
     type SourceStatus,
     type DiscordCandidate
   } from './roster/assembleRoster'
   ```
   (Drop `rosterSourceFor`/`SourceStatus`/`DiscordCandidate` from the import if a given symbol turns out to be unused in `index.ts` after the move — keep only what `index.ts` still references; `RosterPayload` is referenced by `buildRosterDeduped`.)
4. Replace `buildRoster`'s body with the thin wrapper that builds `RosterAssemblyDeps` from the existing closures (mapping per the design spec's "`src/main/index.ts`" section) and `return assembleRoster(deps)`. `guilds`/`axitools`/`gw2`/`links`/`roster`/`syncedMembers`/`AxibridgeClient`/`isReservedAnnotationKey` remain available in `index.ts` for the wrapper.

- [ ] **Step 7: Full suite + typecheck**

Run: `npm test`
Expected: all suites pass (the new `assembleRoster.test.ts` + everything pre-existing).

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/main/roster/assembleRoster.ts src/main/roster/assembleRoster.test.ts src/main/index.ts
git commit -m "refactor(roster): extract assembleRoster core behind injected fetchers"
```

---

## Self-Review Notes

- **Spec coverage:** shared `assembleRoster.ts` with `RosterAssemblyDeps`/`GuildMeta`/`assembleRoster` + moved `RosterPayload`/`SourceStatus`/`DiscordCandidate` (Steps 4); `buildRoster` becomes the desktop wrapper supplying closures as deps (Step 6); 6 characterization tests covering live/synced/Discord-fail/GW2-403/AxiBridge-best-effort/no-guild (Step 2); full suite + typecheck no-regression gate (Step 7). Web/Supabase, preload, renderer, reconcile, adapters untouched.
- **Byte-identical invariant:** the assembly body is a verbatim move with only dependency-call substitution; the design spec's error-handling section enumerates the branches preserved.
- **No circular import:** types move INTO `assembleRoster.ts`; `index.ts` imports them; the module never imports `index.ts`. `rosterSourceFor` relocates with the assembler (it is the assembler's concern) and is re-imported by `index.ts`.
- **Type consistency:** `RosterAssemblyDeps`/`GuildMeta` names match between the module, its test, and the `index.ts` wrapper. `deps.syncedMembers()`/`deps.manualLinks()`/`deps.annotations()` return the reconcile raw types (`InGameMemberRaw[]`/`ManualLinkRaw[]`/`AnnotationRaw[]`) the wrapper maps to.
- **Open implementer judgment (flagged):** exact placement of `rosterSourceFor` (confirm current export location with Grep before moving) and whether `SourceStatus`/`DiscordCandidate` remain referenced in `index.ts` after the move (import only what's still used). These are resolved during implementation, not guessed here.
