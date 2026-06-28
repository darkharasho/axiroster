# Web Version — Phase 2a: Renderer Data-Layer Seam — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every direct `window.axiroster.*` reference in the renderer with a single injectable client (`client` from a new seam module), so a future web build can supply a different implementation — with zero visible desktop behavior change.

**Architecture:** A new module `src/renderer/src/lib/client.ts` owns the active `AxiClient` (= the existing `AxiRosterApi` contract) behind `setClient`/`getClient` and a forwarding `Proxy` named `client`. The Electron entry (`main.tsx`) installs `window.axiroster` via `setClient` at startup; all 108 call sites across 17 files switch from `window.axiroster.X` to `client.X`. A regression-guard test pins `window.axiroster` to `main.tsx` only.

**Tech Stack:** React 18, TypeScript, Vitest. No new dependencies.

## Global Constraints

- **Only `src/renderer/src` changes.** Do NOT touch `src/preload`, `src/main`, or the `AxiRosterApi` contract.
- **Desktop behavior must stay byte-identical.** No visible change; existing renderer tests (`notesDoc`, `tagRegistry`, `bulkTags`, `retention`, `pipeline`) stay green; `npm run typecheck` passes.
- **After this work, `window.axiroster` appears in exactly one file: `src/renderer/src/main.tsx`** (the single install point).
- **Import paths are RELATIVE** — there is no `@renderer` tsconfig path alias, so the vite alias does not help `tsc`. From `src/renderer/src/App.tsx` the import is `./lib/client`; from any `src/renderer/src/components/*` file it is `../lib/client`.
- **`AxiClient = AxiRosterApi`**, imported from `../../../preload/index.d` (from `client.ts`'s location `src/renderer/src/lib/`). Implementations expose **closure methods** (no `this` reliance) — the preload `api` already does.
- **Tests:** Vitest, always `--pool=forks --poolOptions.forks.maxForks=2`.

---

### Task 1: The seam module + Electron install point

**Files:**
- Create: `src/renderer/src/lib/client.ts`
- Create: `src/renderer/src/lib/client.test.ts`
- Modify: `src/renderer/src/main.tsx`

**Interfaces:**
- Produces:
  - `type AxiClient = AxiRosterApi`
  - `setClient(c: AxiClient): void`
  - `getClient(): AxiClient` (throws `"AxiClient not initialized …"` if none installed)
  - `const client: AxiClient` (a `Proxy` forwarding each access to the active impl)
- Consumed by Task 2 (every migrated call site imports `client`).

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/lib/client.test.ts`:

```ts
// src/renderer/src/lib/client.test.ts
import { test, expect, vi } from 'vitest'

test('getClient throws before any setClient', async () => {
  vi.resetModules()
  const mod = await import('./client')
  expect(() => mod.getClient()).toThrow(/not initialized/i)
})

test('client forwards calls to the installed impl and returns its value', async () => {
  vi.resetModules()
  const mod = await import('./client')
  const fake = { listGuilds: vi.fn(async () => [{ id: 'g' }]) } as never
  mod.setClient(fake)
  await expect((mod.client as { listGuilds(): Promise<unknown> }).listGuilds()).resolves.toEqual([
    { id: 'g' }
  ])
  expect((fake as { listGuilds: ReturnType<typeof vi.fn> }).listGuilds).toHaveBeenCalled()
})

test('setClient swaps the active impl', async () => {
  vi.resetModules()
  const mod = await import('./client')
  const a = { ping: vi.fn(() => 'a') } as never
  const b = { ping: vi.fn(() => 'b') } as never
  mod.setClient(a)
  expect((mod.client as { ping(): string }).ping()).toBe('a')
  mod.setClient(b)
  expect((mod.client as { ping(): string }).ping()).toBe('b')
})

test('event-style methods forward and return the unsubscribe fn', async () => {
  vi.resetModules()
  const mod = await import('./client')
  const off = vi.fn()
  const fake = { onWorkspaceChanged: vi.fn(() => off) } as never
  mod.setClient(fake)
  const ret = (mod.client as { onWorkspaceChanged(cb: () => void): () => void }).onWorkspaceChanged(
    () => {}
  )
  expect(ret).toBe(off)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/client.test.ts`
Expected: FAIL — cannot find module `./client`.

- [ ] **Step 3: Write the seam module**

Create `src/renderer/src/lib/client.ts`:

```ts
// src/renderer/src/lib/client.ts
// The renderer's single data-layer seam. Components talk to `client`, a typed
// handle that forwards to whichever implementation was installed via setClient().
// Electron installs window.axiroster (see main.tsx); the web build (Phase 2b/2c)
// installs its own. The contract is identical to the preload bridge, so there is
// one source of truth and nothing to keep in sync.
import type { AxiRosterApi } from '../../../preload/index.d'

export type AxiClient = AxiRosterApi

let impl: AxiClient | null = null

/** Install the active implementation. Must run before any client.* call. */
export function setClient(c: AxiClient): void {
  impl = c
}

/** The active implementation, or throw if none is installed yet. */
export function getClient(): AxiClient {
  if (!impl) throw new Error('AxiClient not initialized — call setClient() first')
  return impl
}

/** Typed handle that forwards every access to the active implementation, so call
 *  sites read `client.foo(...)`. Resolves lazily per access (safe to import
 *  before setClient runs; only throws if a method is *called* before init). */
export const client: AxiClient = new Proxy({} as AxiClient, {
  get(_t, prop) {
    return Reflect.get(getClient() as object, prop)
  }
}) as AxiClient
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Install the Electron implementation in `main.tsx`**

Edit `src/renderer/src/main.tsx` to install `window.axiroster` before the first render. The full file becomes:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { setClient } from './lib/client'
import './index.css'

// Electron: the data-layer client is the preload bridge. The web build installs
// its own implementation at its own entry point (Phase 2b/2c).
setClient(window.axiroster)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (`setClient(window.axiroster)` type-checks because `window.axiroster` is `AxiRosterApi`, which is `AxiClient`.)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/lib/client.ts src/renderer/src/lib/client.test.ts src/renderer/src/main.tsx
git commit -m "feat(renderer): injectable AxiClient seam + Electron install point"
```

---

### Task 2: Migrate all call sites to the seam + regression guard

**Files (Modify — replace `window.axiroster` → `client`, add the relative import):**

From `src/renderer/src/components/` (import `import { client } from '../lib/client'`):
- `AppSettings.tsx` (5), `RetentionView.tsx` (7), `WhatsNewModal.tsx` (1), `discordRoster.ts` (1), `Titlebar.tsx` (7), `UpdatePill.tsx` (5), `GuildSettings.tsx` (10), `GuildSharing.tsx` (8), `CheckForUpdates.tsx` (5), `InvitePanel.tsx` (4), `MemberDetail.tsx` (7), `MemberAccessPanel.tsx` (4), `PendingInvites.tsx` (3), `GuildLog.tsx` (7), `RecruitmentView.tsx` (13), `RosterView.tsx` (8)

From `src/renderer/src/` (import `import { client } from './lib/client'`):
- `App.tsx` (13)

(Counts in parentheses are the `window.axiroster` occurrences per file; they total 108. `main.tsx` is NOT in this list — it keeps its single `window.axiroster` reference.)

**Files (Create):**
- `src/renderer/src/lib/clientSeam.guard.test.ts`

**Interfaces:**
- Consumes: `client` from `src/renderer/src/lib/client.ts` (Task 1).

- [ ] **Step 1: Write the failing regression-guard test**

Create `src/renderer/src/lib/clientSeam.guard.test.ts`:

```ts
// src/renderer/src/lib/clientSeam.guard.test.ts
// Guards the data-layer seam: after Phase 2a, window.axiroster may be referenced
// only in main.tsx (the single install point). Any other reference means a
// component bypassed the injectable client and would break the web build.
import { test, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const SRC = join(process.cwd(), 'src/renderer/src')
// Build the needle at runtime so this guard file does not match itself.
const NEEDLE = ['window', 'axiroster'].join('.')
const ALLOWED = ['main.tsx'] // the single Electron install point

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else if (/\.tsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

test('window.axiroster is referenced only in main.tsx (seam intact)', () => {
  const offenders = walk(SRC).filter((p) => {
    if (ALLOWED.some((a) => p.endsWith(a))) return false
    return readFileSync(p, 'utf8').includes(NEEDLE)
  })
  expect(offenders).toEqual([])
})
```

- [ ] **Step 2: Run the guard to verify it fails**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/clientSeam.guard.test.ts`
Expected: FAIL — `offenders` lists the 17 not-yet-migrated files.

- [ ] **Step 3: Migrate every call site**

For each of the 17 files listed above, make exactly two mechanical edits:

1. Add the import after the file's existing imports — `import { client } from '../lib/client'` for `components/*` files, or `import { client } from './lib/client'` for `App.tsx`.
2. Replace **every** occurrence of `window.axiroster` with `client` in that file (e.g. `window.axiroster.listGuilds()` → `client.listGuilds()`, `window.axiroster.onAuditUpdated(cb)` → `client.onAuditUpdated(cb)`). This is a literal find-and-replace of the string `window.axiroster` → `client`; it covers method calls and any bare reference identically.

Do not change any other code, logic, or formatting. Do not touch `main.tsx`.

- [ ] **Step 4: Run the guard + full suite + typecheck**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/clientSeam.guard.test.ts`
Expected: PASS (`offenders` is empty).

Run: `npm test`
Expected: all suites pass (the new `client` + guard tests plus the pre-existing renderer tests — nothing regressed).

Run: `npm run typecheck`
Expected: no errors — every migrated `client.X(...)` type-checks against `AxiClient = AxiRosterApi` exactly as `window.axiroster.X(...)` did.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src
git commit -m "refactor(renderer): route all 108 bridge calls through the AxiClient seam"
```

---

## Self-Review Notes

- **Spec coverage:** seam module with `setClient`/`getClient`/`client` Proxy (Task 1); Electron install point in `main.tsx` (Task 1 Step 5); migrate all 108 sites across 17 files (Task 2 Step 3); `client.test.ts` unit tests incl. throw-before-init, forwarding, swap, event-method (Task 1); regression-guard test pinning `window.axiroster` to `main.tsx` (Task 2); existing tests + typecheck as the no-regression gate (both tasks). Out-of-scope items (web impl, shell, auth, preload/main changes) are untouched.
- **Type consistency:** `AxiClient` is defined once (Task 1) as `AxiRosterApi` and consumed by `client` (Task 1) and every call site (Task 2). `setClient`/`getClient`/`client` names are identical across the module, its test, `main.tsx`, and the migration.
- **Import-path correctness:** relative paths only (no `@renderer` alias in tsconfig). `client.ts` imports `AxiRosterApi` from `../../../preload/index.d` (three levels up from `src/renderer/src/lib/`). Call sites import `client` from `../lib/client` (components) or `./lib/client` (App.tsx).
- **Guard self-match avoided:** the guard builds its search needle via `['window','axiroster'].join('.')`, so the guard file itself is not flagged; `main.tsx` is the lone allowed reference.
- **Proxy `this` safety:** the Proxy returns impl properties unbound; all `AxiRosterApi` methods are closures (preload `api`), so no binding is needed. Documented as the one constraint on future implementations.
