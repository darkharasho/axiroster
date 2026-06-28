# Web Version — Phase 2b-3a: `WebAxiClient` Skeleton

**Date:** 2026-06-28
**Status:** Approved (design; sensible-defaults run — decisions flagged inline)

## Background & Goal

The shared-core prep is done (2a seam, 2b-1 adapters, 2b-2 `assembleRoster`).
**2b-3** implements `AxiClient` for the browser. It is sliced to stay
unit-testable:

- **2b-3a (this spec)** — the **skeleton**: a `createWebClient(): AxiClient`
  factory that compile-enforces conformance to the full `AxiRosterApi` contract,
  with the trivially-web methods implemented (device settings via localStorage;
  real web behavior for the Electron-only methods; no-op event unsubscribes) and
  the data/auth methods as **typed `NotImplemented` placeholders** that later
  2b-3 slices fill in. Unwired (no entry installs it yet — that's 2c),
  zero desktop impact, fully mock-tested.
- **2b-3b+** — fill the data methods (Supabase-direct + Edge Functions + browser
  GW2 + `assembleRoster`).

> **Verification note:** from 2b-3 on this is browser code; it is verified by
> unit tests against fakes only. Real validation needs a browser + Supabase
> (your job, on a real run). Decisions a browser can't make for us are **flagged
> as [DECISION]** below with the default taken.

## Scope

**In scope:** new files under `src/renderer/src/lib/webClient/` only:
- `settings.ts` — a localStorage-backed device-settings adapter (injectable
  storage for tests).
- `notImplemented.ts` — a typed helper producing a method that throws.
- `webClient.ts` — `createWebClient(): AxiClient` assembling all methods.
- tests for each.

**Out of scope / deferred:**
- Wiring the client into any entry point (2c installs it via `setClient`).
- Any real data/auth/Supabase/Edge/GW2 logic (2b-3b+).
- The Vite web build, web shell, Discord web auth (2c).
- Any change to `src/main`, `src/preload`, the existing renderer, or the
  `AxiClient` contract.

## Current State

`AxiClient = AxiRosterApi` (from 2a) is defined at `src/preload/index.d.ts:309` —
61 methods spanning settings, guild profiles, AxiTools/Discord, roster,
annotations/links/tags, auth, members, invites, sync, audit, retention, window
controls, auto-update, and What's New. The skeleton must satisfy all of them.

## Architecture

### `settings.ts`
```ts
export interface WebSettings {
  get(key: string): string | null
  set(key: string, value: string): void
}
export function createWebSettings(storage?: Storage): WebSettings
```
- Defaults `storage` to `window.localStorage`; tests pass a fake `Storage`.
- Namespaces keys as `axiroster:setting:<key>` to avoid collisions.
- `get` returns `null` for a missing key.
- On web, the desktop's encrypted-file `SettingsStore` is replaced by this; only
  genuinely device-local settings are stored (e.g. `activeGuildId`,
  `lastSeenVersion`). [DECISION] localStorage (not IndexedDB/cookies) — simplest,
  synchronous, matches the sync `getSetting`/`setSetting` signatures.

### `notImplemented.ts`
```ts
export function notImplemented(name: string): (...args: never[]) => never
```
- Returns a function that throws `Error(\`${name}: not implemented on web yet\`)`.
- Used (with a cast at the call site) for methods a later 2b-3 slice will
  implement, so the skeleton conforms to `AxiClient` without faking behavior.

### `webClient.ts` — `createWebClient(deps?): AxiClient`

**Injectable browser deps (the vitest env is `node`, not jsdom — browser globals
must be injectable so tests never touch a missing `window`/`navigator`):**
```ts
interface WebClientDeps {
  storage?: Storage          // default globalThis.localStorage
  open?: (url: string, target?: string, features?: string) => unknown // default globalThis.open
  userAgent?: string         // default globalThis.navigator?.userAgent ?? ''
  appVersion?: string        // default import.meta.env.VITE_APP_VERSION ?? '0.0.0-web'
}
export function createWebClient(deps?: WebClientDeps): AxiClient
```
Browser globals are accessed **lazily inside methods** (never at factory-eval),
and always via `deps.* ?? globalThis.*`, so constructing/calling the client in a
node test with injected fakes never dereferences a missing global.

Returns an object literal typed `AxiClient` (the annotation compile-enforces the
full surface). Methods by category:

**(A) Settings** → the `settings.ts` adapter:
- `getSetting(key)` → `settings.get(key)` (wrapped in `Promise.resolve`).
- `setSetting(key, value)` → `settings.set(key, value)`.

**(B) Electron-only, real web behavior:**
- `windowMinimize`/`windowClose` → async no-op.
- `windowMaximizeToggle` → async `false`; `windowIsMaximized` → async `false`.
- `platform()` → derive from `navigator.userAgent`: `/Mac/i`→`'darwin'`,
  `/Win/i`→`'win32'`, else `'linux'` (a valid `NodeJS.Platform`). [DECISION] map
  UA → platform so the titlebar styling still works; the web shell (2c) may hide
  the native titlebar entirely.
- `appVersion()` → `import.meta.env.VITE_APP_VERSION ?? '0.0.0-web'`. [DECISION]
  read a build-injected env var; 2c wires the real version.
- `openExternal(url)` → `window.open(url, '_blank', 'noopener,noreferrer')`,
  resolve.
- `getWhatsNew`/`markWhatsNewSeen` → `getWhatsNew` resolves a minimal "nothing
  new" `WhatsNew` (the implementer derives the exact shape from the type;
  `markSeen`/empty so the modal never shows); `markWhatsNewSeen` async no-op.
  [DECISION] no What's New on web for now.
- **Auto-update (N/A on web):** `checkForUpdate` → async `{ ok: true }`;
  `restartToUpdate` → async no-op.

**(C) Event subscriptions** → no-op unsubscribe (`() => {}`): every `onX(cb)`
method (`onWindowMaximized`, `onSyncChanged`, `onSyncStatus`,
`onWorkspaceChanged`, `onUpdateStatus`, `onUpdateAvailable`, `onUpdateProgress`,
`onUpdateDownloaded`, `onUpdateError`, `onAuditUpdated`, `onAuditError`,
`onAuditStatus`) returns a callable no-op unsubscribe, so the renderer can
subscribe without crashing once wired. [DECISION] no real event stream in the
skeleton; 2b-3b+/2c wire Supabase realtime where needed.
- `auditStatus()` → async `null` (its signature allows null).
- `syncStatus()` / `reinitSync()` → async `'disabled'` (`SyncStatus` is the
  string union `'disabled'|'connecting'|'connected'|'error'`). [DECISION] the
  skeleton reports sync disabled until 2b-3b+/2c wire Supabase realtime.

**(D) Data + auth → `NotImplemented` placeholders:** all remaining methods
(guild profiles `listGuilds`/`getGuild`/`upsertGuild`/`removeGuild`/
`setActiveGuild`; AxiTools/Discord `axitoolsListGuilds`/`axitoolsGuildRoles`/
`discordOverview`/`discordAction`; `buildRoster`/`refreshRoster`;
annotations/links/tags; `authStatus`/`authSignIn`/`authSignOut`; `claimGuild`;
members; invites; `adoptSharedKeys`; `logRetention`; `listWorkspaceRoles`;
`discordMembers`; `syncStatus`/`reinitSync`; `auditList`/`auditRefresh`) →
`notImplemented('<name>')` cast to the method type. These are filled by 2b-3b+.

## Data Flow

None yet for category D. Category A reads/writes `localStorage`; B/C touch
browser globals (`navigator`, `window.open`). The skeleton is not installed
anywhere, so nothing calls it at runtime — it exists to be the install target and
to compile-prove the contract is satisfiable on web.

## Error Handling

Category-D methods throw a clear `"<name>: not implemented on web yet"` if
called. Because the skeleton is unwired, this can only happen once a later slice
installs the client — by which time those methods will be implemented. The throw
is a loud, honest placeholder, not a silent `undefined`.

## Testing

Vitest, `--pool=forks --poolOptions.forks.maxForks=2`. The test env is **node**
(no `window`/`navigator`/`localStorage`), so tests inject fakes via the
`WebClientDeps` and a fake `Storage` — never relying on browser globals.

- **`settings.test.ts`:** set→get roundtrip via a fake `Storage`; missing key →
  `null`; key namespacing (`axiroster:setting:<key>`).
- **`notImplemented.test.ts`:** the produced function throws with the name in the
  message.
- **`webClient.test.ts`:** `platform()` maps a Mac/Windows/other UA correctly;
  `openExternal` calls `window.open` with the url + `'_blank'`; `window*` and
  `checkForUpdate`/`restartToUpdate` resolve without throwing; every `onX` returns
  a callable that runs without throwing; `getSetting`/`setSetting` round-trip
  through localStorage; a representative category-D method (e.g. `buildRoster`)
  rejects/throws "not implemented"; `auditStatus()` resolves `null`.
- **Conformance is compile-enforced:** `createWebClient(): AxiClient` plus
  `npm run typecheck` (web tsconfig includes `src/renderer/src/**/*`) proves every
  `AxiRosterApi` method is present with a matching signature.

## Out of Scope (2b-3a)

- Installing/using the client; the web build/shell/auth (2c).
- Any real data/auth implementation (2b-3b+).
- `src/main`, `src/preload`, existing renderer, or contract changes.
