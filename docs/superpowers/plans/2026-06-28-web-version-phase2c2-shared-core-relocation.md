# Web Version — Phase 2c-2: Relocate Pure Core to `src/shared/` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move six platform-agnostic modules (+ their co-located tests) from `src/main` into a new `src/shared/` so the renderer can import them too — preserving layout (internal imports unchanged), rewiring only external `src/main` consumers, and adding `src/shared` to both tsconfigs. Byte-identical behavior.

**Architecture:** `git mv` preserving the `roster/` and `net/` subdir layout under `src/shared/`, so each moved module's own imports (`../rosterReconcile`, `./net/resilientFetch`, `../axibridgeClient`, `./adapters`) still resolve. Only files staying in `src/main` that import a moved module change their path (`./X` → `../shared/X`). Both tsconfigs gain `src/shared/**/*`.

**Tech Stack:** TypeScript, Vitest. No dependency or behavior change.

## Global Constraints

- **Behavior byte-identical.** Modules move verbatim; no logic edits. The gate is the existing suite + both typechecks.
- **Use `git mv`** (renames, history preserved) — not delete+recreate.
- **Preserve relative layout** under `src/shared/` exactly: `src/shared/rosterReconcile.ts`, `src/shared/axibridgeClient.ts`, `src/shared/gw2Client.ts`, `src/shared/net/resilientFetch.ts`, `src/shared/roster/adapters.ts`, `src/shared/roster/assembleRoster.ts` (+ co-located test files). This keeps the moved files' internal imports unchanged.
- **Only** the six modules + their tests move; **only** `src/main` consumer import paths + the two tsconfigs change. Do NOT touch the renderer, `src/preload`, or any module body.
- Tests: Vitest `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` (BOTH tsconfigs) green.

---

### Task 1: Relocate the shared core

**Files:**
- Move (git mv) from `src/main/` → `src/shared/` (preserve subpaths): `rosterReconcile.ts`, `axibridgeClient.ts`, `gw2Client.ts`, `net/resilientFetch.ts`, `roster/adapters.ts`, `roster/assembleRoster.ts`, **plus every co-located `*.test.ts`** for those modules (e.g. `roster/adapters.test.ts`, `roster/assembleRoster.test.ts`, `axibridgeClient.attendance.test.ts`, and any `rosterReconcile`/`gw2Client`/`resilientFetch` tests — find them with `git ls-files`).
- Modify: import paths in the `src/main` consumers of the moved modules.
- Modify: `tsconfig.node.json`, `tsconfig.web.json` (`include`).

- [ ] **Step 1: Inventory the moves and consumers**

Run, and note the output:
```bash
# the modules + any co-located tests to move
git ls-files 'src/main/rosterReconcile*.ts' 'src/main/axibridgeClient*.ts' 'src/main/gw2Client*.ts' 'src/main/net/resilientFetch*.ts' 'src/main/roster/adapters*.ts' 'src/main/roster/assembleRoster*.ts'
# external consumers whose import paths must change (excludes the moved files themselves)
grep -rlnE "from '(\.{1,2}/)*(rosterReconcile|roster/adapters|roster/assembleRoster|axibridgeClient|net/resilientFetch|gw2Client)'" src/main --include=*.ts
```

- [ ] **Step 2: Create `src/shared/` subdirs and `git mv` the modules + tests**

```bash
mkdir -p src/shared/net src/shared/roster
git mv src/main/rosterReconcile.ts        src/shared/rosterReconcile.ts
git mv src/main/axibridgeClient.ts        src/shared/axibridgeClient.ts
git mv src/main/gw2Client.ts              src/shared/gw2Client.ts
git mv src/main/net/resilientFetch.ts     src/shared/net/resilientFetch.ts
git mv src/main/roster/adapters.ts        src/shared/roster/adapters.ts
git mv src/main/roster/assembleRoster.ts  src/shared/roster/assembleRoster.ts
# co-located tests (only those that exist — check Step 1 output):
git mv src/main/roster/adapters.test.ts          src/shared/roster/adapters.test.ts
git mv src/main/roster/assembleRoster.test.ts    src/shared/roster/assembleRoster.test.ts
git mv src/main/axibridgeClient.attendance.test.ts src/shared/axibridgeClient.attendance.test.ts
```
(Do NOT move `src/main/net/` or `src/main/roster/` away if other non-moved files live there — only move the named files. `git mv` each existing file from Step 1's list; skip any that don't exist.)

Do not edit the moved files' contents — their internal imports (`../rosterReconcile`, `./net/resilientFetch`, `./adapters`, `../axibridgeClient`) resolve unchanged under `src/shared/`.

- [ ] **Step 3: Rewire the external `src/main` consumers**

For each file from Step 1's consumer list (e.g. `src/main/index.ts`, `src/main/auditNormalize.ts`, `src/main/auditSync.ts`, `src/main/axitoolsClient.ts`, and the `src/main/*.test.ts` consumers), change the import specifier of each moved module from its current `./…`/`../…` form to the `../shared/…` form. Examples (all from `src/main/`, which is one level under `src/`):
- `from './rosterReconcile'` → `from '../shared/rosterReconcile'`
- `from './roster/adapters'` → `from '../shared/roster/adapters'`
- `from './roster/assembleRoster'` → `from '../shared/roster/assembleRoster'`
- `from './gw2Client'` → `from '../shared/gw2Client'`
- `from './axibridgeClient'` → `from '../shared/axibridgeClient'`
- `from './net/resilientFetch'` → `from '../shared/net/resilientFetch'`

A `src/main/*.test.ts` is also at `src/main/`, so it uses the same `../shared/…` form. Change ONLY the import path; touch nothing else.

- [ ] **Step 4: Add `src/shared` to both tsconfigs**

In `tsconfig.node.json`, change the `include` line to:
```json
  "include": ["electron.vite.config.ts", "src/main/**/*", "src/preload/**/*", "src/shared/**/*"]
```
In `tsconfig.web.json`, change the `include` line to:
```json
  "include": ["src/renderer/src/**/*", "src/preload/index.d.ts", "src/shared/**/*"]
```

- [ ] **Step 5: Run the full suite + both typechecks**

Run: `npm test`
Expected: all suites pass (the moved tests run from `src/shared/`; no regressions).

Run: `npm run typecheck`
Expected: BOTH `tsconfig.node.json` and `tsconfig.web.json` clean. If `tsconfig.web.json` surfaces a Node-only type in a shared module (most likely `NodeJS.Timeout` from a `setTimeout` return annotation in `resilientFetch`), fix it to a platform-neutral form (`ReturnType<typeof setTimeout>`) — that is a type annotation only, no behavior change. Do not add `@types/node` to the web config.

- [ ] **Step 6: Confirm clean renames**

Run: `git diff --stat --find-renames HEAD`
Expected: the six modules (+ moved tests) shown as renames `R` (similarity ~100%), the consumer files + two tsconfigs as small edits.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: relocate pure core (gw2/roster/bridge/fetch) to src/shared for web reuse"
```

---

## Self-Review Notes

- **Spec coverage:** six modules + co-located tests moved to `src/shared/` preserving layout (Steps 2); external consumers rewired (Step 3); both tsconfigs include `src/shared` (Step 4); suite + both typechecks as the gate (Step 5); rename verification (Step 6). Renderer/preload/web-build untouched; no behavior change.
- **Internal imports unchanged:** by preserving `roster/` and `net/` subpaths, `adapters`→`../rosterReconcile`, `assembleRoster`→`./adapters`/`../rosterReconcile`/`../axibridgeClient`, `gw2Client`/`axibridgeClient`→`./net/resilientFetch` all resolve to the moved targets — so only external consumers change.
- **Web typecheck as browser-safety check:** adding `src/shared` to `tsconfig.web.json` makes `tsc` verify the shared modules compile under the web/DOM lib with no `@types/node`; the one plausible snag (`NodeJS.Timeout`) has a platform-neutral fix called out.
- **No new importer yet:** the renderer does not import `src/shared` in this slice — adding it to the web tsconfig with no renderer importer is harmless and intentional (readies the boundary for 2c-3).
