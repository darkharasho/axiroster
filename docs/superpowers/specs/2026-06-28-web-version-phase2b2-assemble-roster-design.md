# Web Version — Phase 2b-2: Extract `assembleRoster` Core (Injected Fetchers)

**Date:** 2026-06-28
**Status:** Approved (design)

## Background & Goal

Phase 2b (web client) is sliced into test-verifiable increments. 2b-1 extracted
the pure AxiTools adapters into `src/main/roster/adapters.ts`. **2b-2** extracts
the platform-agnostic roster **assembly** — the ~200-line `buildRoster` body in
`src/main/index.ts` — into a shared `assembleRoster(deps)` that takes **injected
fetchers**, so the same shaping (SourceStatus banners, live-vs-synced decision,
`reconcileRoster` call, warnings, candidate pool, `RosterPayload` construction)
serves both desktop and the future web client. Desktop behavior stays
byte-identical.

**2b-2's job:** move the assembly logic behind a fetcher interface; the desktop
`buildRoster` becomes a thin wrapper that supplies its current
`axitools()`/`gw2()`/store/`AxibridgeClient` closures as the fetchers. The web
client (2b-3+) will supply Supabase/Edge-Function/browser-GW2 fetchers to the
same `assembleRoster`.

## Current State

`src/main/index.ts`:
- `buildRoster(): Promise<RosterPayload>` (lines ~287–489) directly calls
  `guilds.active()`, `axitools()` (`membersLinked`, `discordOverview`), `gw2()`
  (`guildMembers`, `guildRanks`), `links.list()`, `roster.list()`,
  `syncedMembers` (a module-level `Map`), and `new AxibridgeClient(repos)`
  (`playerMetrics`, `attendanceRaids`). It uses the pure `rosterSourceFor` and the
  now-shared adapters `asLinkedMembers`/`asDiscordMembers`/`asDiscordRoles`.
- `buildRosterDeduped()` (line ~276) wraps `buildRoster` with in-flight dedupe;
  the `roster:build` IPC handler calls `buildRosterDeduped`.
- `RosterPayload` is defined at line ~256.
- `buildRoster` has **no direct unit test** today (integration only).

## Architecture

New module `src/main/roster/assembleRoster.ts`:

- Exports `interface RosterAssemblyDeps` and
  `async function assembleRoster(deps: RosterAssemblyDeps): Promise<RosterPayload>`.
- Also exports/moves `RosterPayload` (and its component types `SourceStatus`,
  `DiscordCandidate`, etc. as needed) so both the module and `index.ts` share one
  definition. (These types currently live in `index.ts`; move the ones
  `assembleRoster` needs into the module and import them back into `index.ts`, or
  re-export — the plan pins which.)
- Imports the pure pieces directly: `reconcileRoster`, `rosterSourceFor`, the
  adapters (`asLinkedMembers`/`asDiscordMembers`/`asDiscordRoles`), and the
  reconcile raw types. **No Electron/Node-only imports** — all I/O comes through
  `deps`.
- The `assembleRoster` body is the **current `buildRoster` body moved verbatim**,
  with each direct dependency call swapped for the corresponding `deps.*` call.
  No logic change.

`RosterAssemblyDeps` (the injected seam — provider data fetched, raw, with the
assembler applying the adapters and all shaping):

```ts
interface GuildMeta {
  discordGuildId: string | null
  discordGuildName: string | null
  gw2GuildId: string | null
  gw2GuildName: string | null
  hasAxitoolsKey: boolean
  hasGw2Key: boolean
  memberRoleId: string | null
  bridgeRepos: { owner: string; repo: string }[]
  retentionEnabled: boolean
}

interface RosterAssemblyDeps {
  activeGuild(): GuildMeta | null
  // AxiTools (raw responses; assembler applies the adapters)
  membersLinked(discordGuildId: string): Promise<unknown>
  discordOverview(discordGuildId: string): Promise<unknown> // includeMembers=true
  // GW2 live source
  inGameMembers(gw2GuildId: string): Promise<InGameMemberRaw[]>
  guildRanks(gw2GuildId: string): Promise<{ id: string; order: number }[]>
  // Synced fallback (no leader key)
  syncedMembers(): InGameMemberRaw[]
  // Local stores
  manualLinks(): ManualLinkRaw[]
  annotations(): AnnotationRaw[]
  // AxiBridge (best-effort)
  bridgeMetrics(repos: { owner: string; repo: string }[]): Promise<Map<string, BridgePlayerMetrics>>
  attendance(repos: { owner: string; repo: string }[]): Promise<AttendanceRaidDTO[]>
}
```

`src/main/index.ts`:
- `buildRoster` becomes a thin wrapper that builds a `RosterAssemblyDeps` from its
  existing closures and returns `assembleRoster(deps)`:
  - `activeGuild`: map `guilds.active()` to `GuildMeta` (the same fields
    `buildRoster` reads today: ids/names, `Boolean(guild?.axitoolsKey)`,
    `Boolean(guild?.gw2ApiKey)`, `memberRoleId`, `bridgeRepos`,
    `retentionEnabled`).
  - `membersLinked`/`discordOverview`: `axitools().membersLinked(gid)` /
    `axitools().discordOverview(gid, true)`.
  - `inGameMembers`/`guildRanks`: `gw2().guildMembers(gid)` /
    `gw2().guildRanks(gid)`.
  - `syncedMembers`: map `[...syncedMembers.values()]` to `InGameMemberRaw[]`
    (the same `name`/`rank`/`joined` extraction the current synced branch does).
  - `manualLinks`: `links.list().map((l) => ({ accountName, memberId }))`.
  - `annotations`: `roster.list().filter((a) => !isReservedAnnotationKey(a.memberId))`.
  - `bridgeMetrics`/`attendance`: `new AxibridgeClient(repos).playerMetrics()` /
    `.attendanceRaids()`.
- `buildRosterDeduped`, the `roster:build` handler, and `RosterPayload`'s
  consumers are otherwise unchanged.

**Note on the synced-member mapping:** today the synced→`InGameMemberRaw` mapping
lives *inside* `buildRoster`'s `else if` branch. Moving it: the assembler calls
`deps.syncedMembers()` which returns already-mapped `InGameMemberRaw[]`, so the
desktop wrapper owns that small extraction. The assembler keeps the
`haveInGame`/`count`/`loaded` bookkeeping around it.

## Data Flow

Unchanged. `roster:build → buildRosterDeduped → buildRoster (wrapper) →
assembleRoster(deps) → reconcileRoster + sources → RosterPayload`. The only change
is that the source calls now route through `deps.*` instead of direct closures.

## Error Handling

Identical. The per-source `try/catch` blocks (Discord errors folded into one
banner, GW2 leader-only 403 headline, GW2 ranks best-effort, AxiBridge
metrics/attendance best-effort) move verbatim into `assembleRoster`; a `deps.*`
fetcher that rejects is caught exactly where the corresponding direct call's
rejection is caught today.

## Testing

Vitest, `--pool=forks --poolOptions.forks.maxForks=2`. New
`src/main/roster/assembleRoster.test.ts` characterization tests with a fake
`RosterAssemblyDeps` (no real I/O) — the first direct coverage of this logic:

- **Live path:** configured Discord + GW2 (leader key) → fetchers return Discord
  overview/linked + in-game members + ranks → payload has reconciled members,
  `gw2Source.loaded`/`count`, `discordSource.loaded`/`count`, no warnings.
- **Synced path:** `rosterSource()` → `'synced'`, `syncedMembers()` returns rows
  → in-game roster built from synced, `haveInGame` true.
- **Discord failure:** `membersLinked`/`discordOverview` reject → a single
  `"Discord unavailable: …"` warning, `discordSource.error` set, assembly still
  returns.
- **GW2 leader-only 403:** `inGameMembers` rejects with a `/leader|403/` message →
  the leader-only headline appended; ranks failure is swallowed.
- **AxiBridge best-effort:** `bridgeMetrics`/`attendance` reject → warnings added,
  payload still returns; with `retentionEnabled` false, `attendance` is not
  called.
- **No active guild:** `activeGuild()` → null → both sources show the
  "No guild added" errors, empty members.

Existing suite + `npm run typecheck` stay green (the `buildRoster` wrapper
produces the same `RosterPayload`).

## Out of Scope (2b-2)

- Any web client / Supabase / Edge Function code (2b-3+).
- `buildRosterDeduped`'s dedupe logic, the IPC handler, or the renderer.
- Changing `reconcileRoster`, the adapters, or `RosterPayload`'s shape.
- Any behavior change to roster output — byte-identical `RosterPayload`.
