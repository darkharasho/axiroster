# Web Version — Phase 2a: Renderer Data-Layer Seam

**Date:** 2026-06-28
**Status:** Approved (design)

## Background & Goal

AxiRoster is an Electron desktop app moving toward a **web companion sharing one
core** (Supabase as source of truth; see the Phase 0/1 specs). Phase 2 builds the
web client; it was decomposed into three sub-projects:

- **2a (this spec)** — the renderer **data-layer seam**: replace every direct
  `window.axiroster.*` reference with a single injected client, so a web build
  can supply a different implementation. Ship only the Electron implementation;
  desktop behavior stays byte-identical.
- **2b** — the **web client implementation** of that same interface
  (Supabase-direct for RLS domains, Phase-1 `axitools` + other Edge Functions for
  keyed ops, browser-direct GW2; roster assembly lifted into shared core).
- **2c** — the **web shell + auth + build** (Vite web entry, Discord OAuth via
  Supabase redirect, web treatments for Electron-only bits, deploy).

Recommended order 2a → 2b → 2c: the seam unblocks everything; the client must
exist before the shell can use it.

**2a's job:** introduce the injectable client seam and migrate the renderer onto
it, with zero visible behavior change — the same invisible-refactor discipline as
Phase 0.

## Scope

**In scope:**

- A new renderer module exposing an injectable `AxiClient` (one install point).
- Migrating all `window.axiroster.*` call sites (108 references across 17 files)
  to the injected client.
- Installing the Electron implementation (`window.axiroster`) at the renderer
  entry point.
- Unit tests for the seam module + a regression-guard test.

**Explicitly out of scope / deferred:**

- Any web implementation of the client (2b).
- The web shell, web build, web auth (2c).
- Any change to `src/preload`, `src/main`, or the `AxiRosterApi` contract.
- Any visible behavior change. The desktop app must look and act identically.

## Current State

- The renderer talks to the main process through exactly one typed global,
  `window.axiroster`, of type `AxiRosterApi` (defined and exported at
  `src/preload/index.d.ts:309`; the global `Window.axiroster: AxiRosterApi` is
  declared in the same file).
- `window.axiroster` is referenced **only** inside `src/renderer/src` — 108
  references across 17 files (components + `App.tsx`). Nothing outside the
  renderer uses it.
- The renderer already imports shared types from `../../preload/index.d` (e.g.
  `App.tsx`, `AppSettings.tsx`), so importing `AxiRosterApi` from there is an
  established pattern.

## Architecture

One new module, `src/renderer/src/lib/client.ts`, is the seam. It owns the active
client implementation and exposes it three ways:

```ts
// src/renderer/src/lib/client.ts
import type { AxiRosterApi } from '../../../preload/index.d'

/** The renderer's data-layer contract — identical to the preload bridge, so
 *  there is one source of truth and nothing to keep in sync. */
export type AxiClient = AxiRosterApi

let impl: AxiClient | null = null

/** Install the active implementation. Electron installs `window.axiroster` at
 *  startup; tests (and, later, the web entry) install their own. */
export function setClient(c: AxiClient): void {
  impl = c
}

/** The active implementation, or throw if none is installed yet. */
export function getClient(): AxiClient {
  if (!impl) throw new Error('AxiClient not initialized — call setClient() first')
  return impl
}

/** A typed handle that forwards every call to the active implementation, so call
 *  sites read `client.foo(...)`. Resolves lazily on each access. */
export const client: AxiClient = new Proxy({} as AxiClient, {
  get(_t, prop) {
    return Reflect.get(getClient() as object, prop)
  }
}) as AxiClient
```

**Why a Proxy:** call sites stay a near-verbatim rename (`window.axiroster.X` →
`client.X`), and the implementation is resolved lazily per access, so the module
can be imported before `setClient` runs (e.g. at module-eval time) without
crashing — it only throws if a method is *called* before init.

**Closure-method requirement:** the Proxy returns the impl's property as-is
without binding `this`. Every `AxiRosterApi` method is a closure today (the
preload `api` object is built from arrow functions over `ipcRenderer`), so `this`
is never used. Any future implementation (2b's web client) must likewise expose
closure methods. This is the one constraint the seam places on implementations.

### Entry-point wiring

`src/renderer/src/main.tsx` installs the Electron implementation before the first
render:

```ts
import { setClient } from './lib/client'
setClient(window.axiroster)
// …then createRoot(...).render(<App />)
```

This is the **only** place `window.axiroster` is referenced after 2a.

### Call-site migration

Every `window.axiroster.X(...)` in the 17 renderer files becomes `client.X(...)`,
with `import { client } from '@renderer/lib/client'` (or the correct relative
path) added per file. This includes the event-subscription methods
(`onAuditUpdated`, `onWorkspaceChanged`, `onSyncStatus`, …) which return an
unsubscribe function — they forward through the Proxy unchanged.

## Data Flow

Unchanged from today. `component → client.foo() → (Proxy) → window.axiroster.foo()
→ ipcRenderer.invoke → main process`. The seam adds one transparent forwarding
hop on the renderer side and nothing else. Event pushes
(`ipcRenderer.on → callback`) are likewise unchanged; the renderer subscribes via
`client.onX(cb)` which forwards to `window.axiroster.onX(cb)`.

## Error Handling

No new error semantics. The single new failure mode is calling a client method
before `setClient` has run, which throws a clear
`"AxiClient not initialized"` error. In the Electron entry this cannot happen at
runtime because `setClient(window.axiroster)` runs synchronously at module load,
before React renders. The throw exists to make a future mis-wired web entry fail
loudly instead of silently calling `undefined`.

## Testing

Vitest, `--pool=forks --poolOptions.forks.maxForks=2` (project default).

- **`src/renderer/src/lib/client.test.ts`:**
  - `getClient()` throws before any `setClient`.
  - After `setClient(fake)`, `client.someMethod(args)` forwards to
    `fake.someMethod` and returns its value (use a fake with a spy method).
  - A second `setClient(other)` swaps the active impl (a later call routes to
    `other`).
  - An event-style method (`fake.onX` returning an unsubscribe fn) forwards and
    returns the unsubscribe function.
  - (Reset module state between tests so `impl` doesn't leak — e.g. re-`setClient`
    per test, or `setClient(null as never)` is not used; tests install their own
    fake in `beforeEach`.)
- **Regression-guard test** (`src/renderer/src/lib/clientSeam.guard.test.ts`):
  reads every `.ts`/`.tsx` file under `src/renderer/src` and asserts that
  `window.axiroster` appears in **none** except `main.tsx`. This keeps the seam
  from silently rotting as new code is added.
- **Existing renderer tests** (`notesDoc`, `tagRegistry`, `bulkTags`,
  `retention`, `pipeline`) must stay green — they don't touch the bridge, so they
  are unaffected, but the full suite is the safety net.
- **`npm run typecheck`** must pass (renderer tsconfig), proving the migrated
  call sites type-check against `AxiClient = AxiRosterApi` exactly as they did
  against `window.axiroster`.

## Out of Scope (2a)

- Any web/Supabase/HTTP implementation of `AxiClient` (2b).
- The web shell, Vite web build, Discord web auth, Electron-only-bit treatments
  (2c).
- Changes to `src/preload`, `src/main`, or the `AxiRosterApi` contract.
- React Context / hooks-based injection — a module singleton with a forwarding
  Proxy is sufficient and far less invasive across 17 files. (Revisit only if a
  later phase needs per-subtree client overrides, which it does not.)
