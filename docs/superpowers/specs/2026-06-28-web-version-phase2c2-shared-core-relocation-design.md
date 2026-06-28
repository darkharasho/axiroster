# Web Version — Phase 2c-2: Relocate the Pure Core to `src/shared/`

**Date:** 2026-06-28
**Status:** Approved (sensible-defaults run)

## Background & Goal

The web data methods (2c-3+) must reuse the pure core that today lives in
`src/main` — `gw2Client` (for `gw2AccountInfo`), `rosterReconcile` / `adapters` /
`assembleRoster` (for roster, `discordMembers`, `boundGw2Guilds`) — but the
renderer/web build **cannot import `src/main`** (separate tsconfig + the
main/renderer boundary). **2c-2** relocates the closed set of platform-agnostic
modules into a new `src/shared/` that BOTH `src/main` and the renderer import.
Invisible refactor: byte-identical behavior, desktop tests as the gate.

## The closed set (verified pure / browser-safe)

Six modules, whose entire transitive import graph stays within the set and uses
no Electron/Node-only API (`Buffer`/`fs`/`process`/`node:`/`electron` — all
verified absent):

| Module | imports | why shared |
|---|---|---|
| `rosterReconcile.ts` | (leaf) | roster reconciliation |
| `roster/adapters.ts` | `../rosterReconcile` | AxiTools response parsers |
| `roster/assembleRoster.ts` | `./adapters`, `../rosterReconcile`, `../axibridgeClient` (types) | roster assembly core |
| `axibridgeClient.ts` | `./net/resilientFetch` | bridge metrics/attendance + its types |
| `net/resilientFetch.ts` | (leaf) | fetch wrapper (fetch/AbortController — browser-safe) |
| `gw2Client.ts` | `./net/resilientFetch` | GW2 API client (for `gw2AccountInfo`) |

## Architecture

**Preserve the relative layout under `src/shared/`** so the moved modules' own
imports do not change:

```
src/shared/
  rosterReconcile.ts
  axibridgeClient.ts
  gw2Client.ts
  net/resilientFetch.ts
  roster/adapters.ts
  roster/assembleRoster.ts
```

Because `adapters.ts` keeps `from '../rosterReconcile'`, `gw2Client.ts` keeps
`from './net/resilientFetch'`, etc., and those targets move to the same relative
positions, **the moved files' internal imports are unchanged**. Move each
module's co-located test file with it (`roster/adapters.test.ts`,
`roster/assembleRoster.test.ts`, `axibridgeClient.attendance.test.ts`, and any
`gw2Client`/`resilientFetch`/`rosterReconcile` tests) — they import the module by
the same relative path, so they keep working.

**External consumers** (files staying in `src/main` that import a moved module)
update their paths to `../shared/…`:
- `src/main/index.ts` — `./rosterReconcile`→`../shared/rosterReconcile`,
  `./roster/adapters`→`../shared/roster/adapters`,
  `./roster/assembleRoster`→`../shared/roster/assembleRoster`,
  `./gw2Client`→`../shared/gw2Client`,
  `./axibridgeClient`→`../shared/axibridgeClient`.
- `src/main/auditNormalize.ts` — `./gw2Client`→`../shared/gw2Client`.
- `src/main/auditSync.ts`, `src/main/axitoolsClient.ts`, and the
  `src/main/*.test.ts` consumers — same `./X`→`../shared/X` rewrite for whichever
  moved module they import.

The implementer finds the exact consumer set with grep + the typecheck, not a
hand-list.

**tsconfig:** add `src/shared/**/*` to the `include` of BOTH
`tsconfig.node.json` (so `src/main` + the moved modules still typecheck) and
`tsconfig.web.json` (so the renderer can import them, AND so `tsc` verifies the
shared modules compile under the web/DOM lib — a free browser-safety check).
Vitest's `src/**/*.test.ts` glob already covers `src/shared`.

## Data Flow / Behavior

Unchanged. Every module is moved verbatim; only file locations and the import
paths of external consumers change. `assembleRoster` still takes injected
fetchers (2b-2); the desktop `buildRoster` wrapper is unchanged except its import
path to `assembleRoster`.

## Scope

**In scope:** `git mv` the six modules (+ their co-located tests) to `src/shared/`
preserving layout; rewire `src/main` consumers' import paths; add `src/shared` to
both tsconfigs.

**Out of scope:** any renderer/web-client change (the renderer does not yet import
`src/shared` — that's 2c-3); any logic change; `src/preload`; the web build.

## Testing

The relocation is behavior-preserving; the gate is the existing suite + both
typechecks:
- `npm test` — all suites green (the moved tests run from their new location).
- `npm run typecheck` — both `tsconfig.node.json` AND `tsconfig.web.json` clean
  (the latter now also typechecks `src/shared` under the web/DOM config; fix any
  surfaced node-only type, e.g. a `NodeJS.Timeout` annotation → `ReturnType<typeof setTimeout>`).
- `git` shows the six modules as **renames** (R), not delete+add, confirming a
  clean `git mv` with history preserved.

## Out of Scope (2c-2)

- Web data-method implementations; the renderer importing `src/shared`.
- Any behavior change; `src/preload`; the Vite web build/deploy.
