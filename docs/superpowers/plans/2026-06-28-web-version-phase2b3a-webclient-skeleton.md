# Web Version — Phase 2b-3a: `WebAxiClient` Skeleton — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `createWebClient(deps?): AxiClient` skeleton (new files under `src/renderer/src/lib/webClient/`) that compile-enforces conformance to the full `AxiRosterApi` contract — implementing the web-trivial methods (localStorage settings, Electron-only web behaviors, no-op event unsubscribes) and stubbing data/auth methods as typed `NotImplemented` placeholders. Unwired, zero desktop impact, mock-tested.

**Architecture:** Three small modules — `settings.ts` (localStorage adapter, injectable `Storage`), `notImplemented.ts` (throwing-stub helper), `webClient.ts` (the factory assembling all `AxiClient` methods). The `: AxiClient` return annotation + `npm run typecheck` (web tsconfig covers `src/renderer/src/**/*`) prove every method is present with a correct signature. The vitest env is **node**, so browser globals are injected via deps in tests.

**Tech Stack:** TypeScript, React renderer, Vitest. No new dependencies.

## Global Constraints

- **New files only, all under `src/renderer/src/lib/webClient/`.** Do NOT change `src/main`, `src/preload`, the existing renderer, the `AxiClient` contract, or wire the client into any entry point.
- **Conformance is the point:** `createWebClient` returns an object literal typed `AxiClient` (= `AxiRosterApi`). Every method must be present; `npm run typecheck` must pass. Reconcile the method set against the real `AxiRosterApi` at `src/preload/index.d.ts:309` — the type, not this plan's lists, is the source of truth for the exact set/signatures.
- **Node test env:** never dereference `window`/`navigator`/`localStorage`/`open` directly at factory-eval; access them lazily inside methods via `deps.* ?? globalThis.*`. Tests inject fakes.
- **Tests:** Vitest, `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` green.

---

### Task 1: The `WebAxiClient` skeleton + tests

**Files:**
- Create: `src/renderer/src/lib/webClient/settings.ts`, `.../settings.test.ts`
- Create: `src/renderer/src/lib/webClient/notImplemented.ts`, `.../notImplemented.test.ts`
- Create: `src/renderer/src/lib/webClient/webClient.ts`, `.../webClient.test.ts`

**Interfaces:**
- Consumes: `AxiClient` from `../client` (the 2a seam type).
- Produces: `createWebSettings(storage?)`, `notImplemented(name)`, `createWebClient(deps?)`.

- [ ] **Step 1: Write failing tests for settings + notImplemented**

`src/renderer/src/lib/webClient/settings.test.ts`:
```ts
import { test, expect } from 'vitest'
import { createWebSettings } from './settings'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size
    }
  } as Storage
}

test('round-trips and returns null for a missing key', () => {
  const s = createWebSettings(fakeStorage())
  expect(s.get('activeGuildId')).toBeNull()
  s.set('activeGuildId', 'g1')
  expect(s.get('activeGuildId')).toBe('g1')
})

test('namespaces keys under axiroster:setting:', () => {
  const store = fakeStorage()
  createWebSettings(store).set('k', 'v')
  expect(store.getItem('axiroster:setting:k')).toBe('v')
  expect(store.getItem('k')).toBeNull()
})
```

`src/renderer/src/lib/webClient/notImplemented.test.ts`:
```ts
import { test, expect } from 'vitest'
import { notImplemented } from './notImplemented'

test('produces a function that throws with the method name', () => {
  expect(() => notImplemented('buildRoster')()).toThrow(/buildRoster: not implemented on web/)
})
```

- [ ] **Step 2: Run them — expect FAIL (missing modules)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/`
Expected: FAIL — cannot find `./settings` / `./notImplemented`.

- [ ] **Step 3: Implement settings.ts + notImplemented.ts**

`src/renderer/src/lib/webClient/settings.ts`:
```ts
// src/renderer/src/lib/webClient/settings.ts
// Device-local settings for the web build. On web the desktop's encrypted-file
// SettingsStore becomes localStorage; only genuinely device-local settings live
// here (activeGuildId, lastSeenVersion). Storage is injectable for tests.
export interface WebSettings {
  get(key: string): string | null
  set(key: string, value: string): void
}

const PREFIX = 'axiroster:setting:'

export function createWebSettings(storage: Storage = globalThis.localStorage): WebSettings {
  return {
    get: (key) => storage.getItem(PREFIX + key),
    set: (key, value) => storage.setItem(PREFIX + key, value)
  }
}
```

`src/renderer/src/lib/webClient/notImplemented.ts`:
```ts
// src/renderer/src/lib/webClient/notImplemented.ts
// A loud placeholder for AxiClient methods a later 2b-3 slice will implement.
// Returns a function that throws, so the skeleton conforms to AxiClient without
// silently returning undefined.
export function notImplemented(name: string): (...args: never[]) => never {
  return () => {
    throw new Error(`${name}: not implemented on web yet`)
  }
}
```

- [ ] **Step 4: Run — expect PASS (settings: 2, notImplemented: 1)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/settings.test.ts src/renderer/src/lib/webClient/notImplemented.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing webClient test**

`src/renderer/src/lib/webClient/webClient.test.ts`:
```ts
import { test, expect, vi } from 'vitest'
import { createWebClient } from './webClient'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size
    }
  } as Storage
}

test('platform() maps the user agent', async () => {
  expect(await createWebClient({ userAgent: 'Mozilla Mac OS X' }).platform()).toBe('darwin')
  expect(await createWebClient({ userAgent: 'Windows NT 10' }).platform()).toBe('win32')
  expect(await createWebClient({ userAgent: 'X11; Linux x86_64' }).platform()).toBe('linux')
})

test('appVersion() uses the injected version or the default', async () => {
  expect(await createWebClient({ appVersion: '1.2.3' }).appVersion()).toBe('1.2.3')
  expect(await createWebClient({ appVersion: undefined }).appVersion()).toBe('0.0.0-web')
})

test('openExternal opens a noopener tab', async () => {
  const open = vi.fn()
  await createWebClient({ open }).openExternal('https://x.test')
  expect(open).toHaveBeenCalledWith('https://x.test', '_blank', 'noopener,noreferrer')
})

test('settings round-trip through the injected storage', async () => {
  const c = createWebClient({ storage: fakeStorage() })
  expect(await c.getSetting('k')).toBeNull()
  await c.setSetting('k', 'v')
  expect(await c.getSetting('k')).toBe('v')
})

test('window/update/sync/audit stubs resolve sensibly', async () => {
  const c = createWebClient({ storage: fakeStorage() })
  await expect(c.windowMaximizeToggle()).resolves.toBe(false)
  await expect(c.windowIsMaximized()).resolves.toBe(false)
  await expect(c.checkForUpdate()).resolves.toEqual({ ok: true })
  await expect(c.syncStatus()).resolves.toBe('disabled')
  await expect(c.reinitSync()).resolves.toBe('disabled')
  await expect(c.auditStatus()).resolves.toBeNull()
  await expect(c.getWhatsNew()).resolves.toMatchObject({ releaseNotes: null })
})

test('event subscriptions return a callable no-op unsubscribe', () => {
  const c = createWebClient({ storage: fakeStorage() })
  const unsub = c.onWorkspaceChanged(() => {})
  expect(typeof unsub).toBe('function')
  expect(() => unsub()).not.toThrow()
})

test('a data method throws not-implemented (sync)', () => {
  expect(() => createWebClient({ storage: fakeStorage() }).buildRoster()).toThrow(
    /not implemented on web/
  )
})
```

- [ ] **Step 6: Run — expect FAIL (missing webClient)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/webClient.test.ts`
Expected: FAIL — cannot find `./webClient`.

- [ ] **Step 7: Implement webClient.ts**

`src/renderer/src/lib/webClient/webClient.ts` — start from the code below. **Then run `npm run typecheck` and reconcile against the real `AxiRosterApi`** (`src/preload/index.d.ts:309`): if typecheck reports a missing method, add a `notImplemented` stub for it (category D); if a signature mismatches, fix it. The `: AxiClient` annotation guarantees you've covered the whole contract.

```ts
// src/renderer/src/lib/webClient/webClient.ts
// The web implementation of the AxiClient contract (the 2a seam type). This is
// the SKELETON: web-trivial methods are real; data/auth methods throw
// notImplemented and are filled by later 2b-3 slices. Unwired — 2c installs it
// via setClient at the web entry. The vitest env is node, so browser globals are
// taken from deps (injected in tests) ?? globalThis (real browser).
import type { AxiClient } from '../client'
import { createWebSettings } from './settings'
import { notImplemented } from './notImplemented'

export interface WebClientDeps {
  storage?: Storage
  open?: (url: string, target?: string, features?: string) => unknown
  userAgent?: string
  appVersion?: string
}

export function createWebClient(deps: WebClientDeps = {}): AxiClient {
  const settings = createWebSettings(deps.storage)
  const ua = deps.userAgent ?? globalThis.navigator?.userAgent ?? ''
  const openUrl =
    deps.open ?? ((url: string, target?: string, features?: string) => globalThis.open?.(url, target, features))
  const version = deps.appVersion ?? '0.0.0-web'
  const noopUnsub = (): (() => void) => () => {}
  const ni = <K extends keyof AxiClient>(name: K): AxiClient[K] =>
    notImplemented(name as string) as unknown as AxiClient[K]

  return {
    // (A) settings -> localStorage
    getSetting: async (key) => settings.get(key),
    setSetting: async (key, value) => {
      settings.set(key, value)
    },

    // (B) Electron-only -> web behavior
    windowMinimize: async () => {},
    windowClose: async () => {},
    windowMaximizeToggle: async () => false,
    windowIsMaximized: async () => false,
    platform: async () => (/Mac/i.test(ua) ? 'darwin' : /Win/i.test(ua) ? 'win32' : 'linux'),
    appVersion: async () => version,
    openExternal: async (url) => {
      openUrl(url, '_blank', 'noopener,noreferrer')
    },
    getWhatsNew: async () => ({ version, lastSeenVersion: null, releaseNotes: null }),
    markWhatsNewSeen: async () => {},
    checkForUpdate: async () => ({ ok: true }),
    restartToUpdate: async () => {},
    syncStatus: async () => 'disabled',
    reinitSync: async () => 'disabled',
    auditStatus: async () => null,

    // (C) event subscriptions -> no-op unsubscribe
    onWindowMaximized: () => noopUnsub(),
    onSyncChanged: () => noopUnsub(),
    onSyncStatus: () => noopUnsub(),
    onWorkspaceChanged: () => noopUnsub(),
    onUpdateStatus: () => noopUnsub(),
    onUpdateAvailable: () => noopUnsub(),
    onUpdateProgress: () => noopUnsub(),
    onUpdateDownloaded: () => noopUnsub(),
    onUpdateError: () => noopUnsub(),
    onAuditUpdated: () => noopUnsub(),
    onAuditError: () => noopUnsub(),
    onAuditStatus: () => noopUnsub(),

    // (D) data + auth -> NotImplemented (filled by 2b-3b+)
    listGuilds: ni('listGuilds'),
    getGuild: ni('getGuild'),
    upsertGuild: ni('upsertGuild'),
    removeGuild: ni('removeGuild'),
    setActiveGuild: ni('setActiveGuild'),
    axitoolsListGuilds: ni('axitoolsListGuilds'),
    axitoolsGuildRoles: ni('axitoolsGuildRoles'),
    discordOverview: ni('discordOverview'),
    discordAction: ni('discordAction'),
    buildRoster: ni('buildRoster'),
    upsertAnnotation: ni('upsertAnnotation'),
    removeAnnotation: ni('removeAnnotation'),
    getTagRegistry: ni('getTagRegistry'),
    setTagRegistry: ni('setTagRegistry'),
    setLink: ni('setLink'),
    removeLink: ni('removeLink'),
    authStatus: ni('authStatus'),
    authSignIn: ni('authSignIn'),
    authSignOut: ni('authSignOut'),
    claimGuild: ni('claimGuild'),
    listWorkspaceRoles: ni('listWorkspaceRoles'),
    listMembers: ni('listMembers'),
    setMemberRole: ni('setMemberRole'),
    revokeMember: ni('revokeMember'),
    discordMembers: ni('discordMembers'),
    createInvite: ni('createInvite'),
    redeemInvite: ni('redeemInvite'),
    listInvites: ni('listInvites'),
    respondInvite: ni('respondInvite'),
    pendingSentInvites: ni('pendingSentInvites'),
    revokeInvite: ni('revokeInvite'),
    adoptSharedKeys: ni('adoptSharedKeys'),
    refreshRoster: ni('refreshRoster'),
    logRetention: ni('logRetention'),
    auditList: ni('auditList'),
    auditRefresh: ni('auditRefresh')
  }
}
```

- [ ] **Step 8: Run the webClient test + full suite + typecheck**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/webClient.test.ts`
Expected: PASS (7 tests).

Run: `npm test`
Expected: all suites pass (the 3 new web-client suites + everything pre-existing).

Run: `npm run typecheck`
Expected: no errors — the `: AxiClient` return type proves full conformance. If it reports a missing/extra/mismatched method, reconcile against `src/preload/index.d.ts:309` (add/remove a `notImplemented` stub or fix a signature) until clean.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/lib/webClient
git commit -m "feat(web): WebAxiClient skeleton (settings + web stubs, conformance-enforced)"
```

---

## Self-Review Notes

- **Spec coverage:** `settings.ts` localStorage adapter (Step 3); `notImplemented.ts` helper (Step 3); `createWebClient(): AxiClient` with categories A (settings), B (Electron-only web behavior + `syncStatus`/`reinitSync` → `'disabled'`, `auditStatus` → null), C (no-op event unsubscribes), D (NotImplemented placeholders) (Step 7); conformance compile-enforced via the return annotation + typecheck (Step 8); unit tests for all three modules (Steps 1, 5). Unwired; no `src/main`/`src/preload`/existing-renderer/contract change.
- **Node-env safety:** browser globals are read lazily via `deps.* ?? globalThis.*`; tests inject `storage`/`open`/`userAgent`/`appVersion`, so no test dereferences a missing `window`/`navigator`.
- **Type consistency:** `createWebClient` returns `AxiClient` (= `AxiRosterApi`); the `ni` helper casts `notImplemented` to the exact `AxiClient[K]`; the method set is reconciled against the real type during Step 7/8 (typecheck is the gate, not the plan's hand-listed names).
- **Decisions flagged (sensible defaults):** localStorage for settings; UA→platform mapping; `appVersion` default `'0.0.0-web'` (real version injected in 2c); no What's New / sync 'disabled' / auto-update no-op on web. All revisited in 2c.
