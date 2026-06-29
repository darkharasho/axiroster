# Web Version — Phase 2c-23: Top-Right Account Chip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On web, surface the Discord account as a title-bar chip (avatar + name → dropdown with role + Sign out) and remove the sidebar settings cog; desktop untouched.

**Architecture:** `AuthStatus` gains optional `name`/`avatarUrl` populated by `webAuthStatus` (via a pure `discordIdentity` helper). A web-only `WebAccountMenu` renders in `Titlebar`'s right slot; the `App` footer cog is gated `!isWeb()`.

**Tech Stack:** TypeScript, React renderer, Tailwind, lucide-react, Vitest (node, pure-logic only — no RTL). No new deps.

## Global Constraints

- Touch ONLY: `src/preload/index.d.ts` (AuthStatus fields), `src/renderer/src/lib/webClient/auth.ts` + `auth.test.ts`, `src/renderer/src/components/WebAccountMenu.tsx` (new), `src/renderer/src/components/Titlebar.tsx`, `src/renderer/src/App.tsx`. Do NOT touch `src/main`, `src/shared`, other functions/migrations, `AppSettings.tsx`, or other components.
- Web-only behavior; desktop unchanged. `AuthStatus.name`/`avatarUrl` are OPTIONAL (the desktop `auth:status` impl omits them — must stay valid).
- The cog stays for desktop; `AppSettings`/`appSettingsOpen`/`GuildSharing.onOpenAppSettings` plumbing is NOT removed — only the footer cog `<button>` is gated `!isWeb()`.
- Run vitest with `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` + `npm run build:web` green.

Reused facts:
- `webAuthStatus(sb, settings)` signed-in branch currently returns `{ signedIn: true, role, workspaceId, userId }` (auth.ts:41).
- `isWeb()` from `../lib/runtime` (components) / `./lib/runtime` (App). `App.tsx` already imports `isWeb` (2c-20).
- `client.authStatus()`/`client.authSignOut()` exist on `AxiClient`.
- Tailwind tokens: `panel`/`panel-raised`/`panel-hover`/`panel-line`/`panel-line2`, `ink`/`ink-faint`, `accent`, `emerald-*`, `shadow-raise-lg`; `.no-drag` opts a control out of the titlebar drag region.

---

### Task 1: `AuthStatus` identity fields + `discordIdentity` + `webAuthStatus`

**Files:**
- Modify: `src/preload/index.d.ts` (AuthStatus), `src/renderer/src/lib/webClient/auth.ts`, `src/renderer/src/lib/webClient/auth.test.ts`

**Interfaces:**
- Produces: `discordIdentity(meta: Record<string, unknown> | undefined): { name: string; avatarUrl: string }`; `AuthStatus.name?: string`, `AuthStatus.avatarUrl?: string`.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/lib/webClient/auth.test.ts`: add `discordIdentity` to the import (`import { webAuthStatus, webSignIn, webSignOut, discordIdentity } from './auth'`), extend the `fakeSb` `getUser` to carry metadata (add `meta?: Record<string, unknown>` to its opts type and return `user: opts.userId ? { id: opts.userId, user_metadata: opts.meta } : null`), and add:
```ts
test('discordIdentity: prefers full_name then falls back, maps avatar', () => {
  expect(discordIdentity({ full_name: 'Rasho', name: 'x', avatar_url: 'http://a/p.png' })).toEqual({
    name: 'Rasho',
    avatarUrl: 'http://a/p.png'
  })
  expect(discordIdentity({ user_name: 'rasho_gw2', picture: 'http://a/q.png' })).toEqual({
    name: 'rasho_gw2',
    avatarUrl: 'http://a/q.png'
  })
  expect(discordIdentity(undefined)).toEqual({ name: 'Discord user', avatarUrl: '' })
})

test('webAuthStatus: surfaces Discord name + avatar from user_metadata', async () => {
  const sb = fakeSb({
    session: {},
    userId: 'u1',
    memberships: [{ workspace_id: 'w1', role: 'owner' }],
    meta: { full_name: 'Rasho', avatar_url: 'http://a/p.png' }
  })
  const r = await webAuthStatus(sb, createWebSettings(fakeStorage()))
  expect(r).toMatchObject({ signedIn: true, role: 'owner', name: 'Rasho', avatarUrl: 'http://a/p.png' })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/auth.test.ts`
Expected: FAIL — `discordIdentity` not exported; `webAuthStatus` result lacks `name`/`avatarUrl`.

- [ ] **Step 3: Implement**

In `src/preload/index.d.ts`, add two optional fields to `AuthStatus`:
```ts
export interface AuthStatus {
  signedIn: boolean
  role?: string
  workspaceId?: string
  userId?: string
  name?: string
  avatarUrl?: string
}
```
In `src/renderer/src/lib/webClient/auth.ts`, add the exported helper (near the top, after imports):
```ts
// Map a Supabase Discord-OAuth user_metadata bag to a display name + avatar.
export function discordIdentity(meta: Record<string, unknown> | undefined): {
  name: string
  avatarUrl: string
} {
  const m = meta ?? {}
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = m[k]
      if (typeof v === 'string' && v) return v
    }
    return ''
  }
  return {
    name: pick('full_name', 'name', 'user_name', 'preferred_username') || 'Discord user',
    avatarUrl: pick('avatar_url', 'picture')
  }
}
```
In `webAuthStatus`, compute the identity and include it in the signed-in return. Replace the signed-in `return` (currently `return { signedIn: true, role: ws?.role, workspaceId: ws?.workspaceId, userId }`) with:
```ts
    const { name, avatarUrl } = discordIdentity(user?.user_metadata as Record<string, unknown> | undefined)
    return { signedIn: true, role: ws?.role, workspaceId: ws?.workspaceId, userId, name, avatarUrl }
```
(Place the `discordIdentity(...)` line just before the `return`, where `user` is in scope.)

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.d.ts src/renderer/src/lib/webClient/auth.ts src/renderer/src/lib/webClient/auth.test.ts
git commit -m "feat(web): surface Discord name/avatar on AuthStatus (discordIdentity + webAuthStatus)"
```

---

### Task 2: `WebAccountMenu` chip + Titlebar slot + cog gate

**Files:**
- Create: `src/renderer/src/components/WebAccountMenu.tsx`
- Modify: `src/renderer/src/components/Titlebar.tsx`, `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `AuthStatus.name`/`avatarUrl`/`role` (Task 1); `client.authStatus()`/`authSignOut()`.

(Presentational — no new unit test; the identity logic is covered by Task 1's `discordIdentity` tests. Verified by typecheck + build + review.)

- [ ] **Step 1: Create `WebAccountMenu.tsx`**

```tsx
// src/renderer/src/components/WebAccountMenu.tsx
// Web-only account chip in the title bar's right slot: avatar + Discord name →
// a dropdown with the workspace role and Sign out. Sign-out clears the session
// and reloads, so WebRoot re-gates to the Landing.
import { useEffect, useRef, useState } from 'react'
import { LogOut, ChevronDown } from 'lucide-react'
import type { AuthStatus } from '../../../preload/index.d'
import { client } from '../lib/client'

export default function WebAccountMenu(): JSX.Element | null {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void client.authStatus().then(setStatus)
  }, [])
  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [])

  if (!status?.signedIn) return null
  const name = status.name || 'Discord user'
  const initial = name.charAt(0).toUpperCase()
  const avatar = (size: string, text: string): JSX.Element =>
    status.avatarUrl ? (
      <img src={status.avatarUrl} alt="" className={`${size} rounded-full`} />
    ) : (
      <span className={`${size} grid place-items-center rounded-full bg-accent ${text} font-bold text-white`}>
        {initial}
      </span>
    )

  const signOut = async (): Promise<void> => {
    await client.authSignOut()
    globalThis.location?.reload()
  }

  return (
    <div ref={ref} className="no-drag relative mr-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1 transition hover:border-panel-line hover:bg-panel-hover"
      >
        {avatar('h-6 w-6', 'text-[11px]')}
        <span className="text-[12.5px] font-semibold text-ink">{name}</span>
        <ChevronDown size={14} className="text-ink-faint" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-56 overflow-hidden rounded-xl border border-panel-line bg-panel-raised shadow-raise-lg">
          <div className="flex items-center gap-2.5 p-3">
            {avatar('h-8 w-8', 'text-[13px]')}
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-white">{name}</div>
              {status.role && (
                <span className="mt-0.5 inline-block rounded-full bg-emerald-500/14 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-emerald-400">
                  {status.role}
                </span>
              )}
            </div>
          </div>
          <div className="h-px bg-panel-line" />
          <button
            onClick={signOut}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-red-400 transition hover:bg-red-500/10"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Render it in `Titlebar.tsx`**

Add the import: `import WebAccountMenu from './WebAccountMenu'`. In the right-hand container (`<div className="flex h-full items-center">`, which holds `<UpdatePill />` and the `{!isWeb() && …}` window controls), add the web chip after `<UpdatePill />`:
```tsx
      <div className="flex h-full items-center">
        <UpdatePill />
        {isWeb() && <WebAccountMenu />}
        {/* Window controls are Electron-only; the browser provides its own chrome. */}
        {!isWeb() && (
```
(`isWeb` is already imported in `Titlebar.tsx`.)

- [ ] **Step 3: Gate the footer cog in `App.tsx`**

Wrap the App-settings cog `<button>` (the one with `title="App settings"` / `<Cog size={15} />`, in the sidebar footer) in `{!isWeb() && ( … )}`:
```tsx
            {!isWeb() && (
              <button
                onClick={() => setAppSettingsOpen(true)}
                className="grid h-7 w-7 place-items-center rounded-md border border-transparent text-ink-faint transition hover:border-panel-line2 hover:bg-panel-hover hover:text-ink"
                title="App settings"
              >
                <Cog size={15} />
              </button>
            )}
```
Leave the `SYNC_META[sync]` badge, `AppSettings`, `appSettingsOpen`, and `setAppSettingsOpen` as-is (still used by desktop + `GuildSharing`).

- [ ] **Step 4: Gates**

Run: `npm run typecheck` → clean (no unused symbols — `Cog`/`AppSettings`/`setAppSettingsOpen` are still referenced; `WebAccountMenu`/`isWeb` used). Run: `npm run build:web` → succeeds. Run: `npm test` (`npx vitest run --pool=forks --poolOptions.forks.maxForks=2`) → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/WebAccountMenu.tsx src/renderer/src/components/Titlebar.tsx src/renderer/src/App.tsx
git commit -m "feat(web): top-right account chip in titlebar; hide sidebar settings cog on web"
```

---

## Self-Review Notes

- **Spec coverage:** `AuthStatus.name`/`avatarUrl` + `discordIdentity` + `webAuthStatus` populate → Task 1. `WebAccountMenu` chip+dropdown (avatar fallback, role badge, sign-out→reload, outside-click/Esc close, render-nothing when signed-out) → Task 2 Step 1. Titlebar right-slot render (`isWeb()`) → Step 2. Cog gated `!isWeb()`, badge/modal kept → Step 3. Identity logic tested via `discordIdentity` (Task 1); UI presentational. Desktop untouched (optional fields, web-gated UI).
- **Placeholder scan:** none — full helper, full component, exact Titlebar/App edits, full tests.
- **Type consistency:** `discordIdentity(meta): { name; avatarUrl }` identical in test + impl; `AuthStatus` optional fields match `webAuthStatus`'s return + the component's reads (`status.name`/`avatarUrl`/`role`). `WebAccountMenu` default export consumed by Titlebar. `isWeb` import paths correct (`../lib/runtime` in components, `./lib/runtime` in App — already present).
- **No regression:** desktop `auth:status` omits the new optional fields (valid); the cog/modal/`onOpenAppSettings` remain for desktop; only the cog render is web-gated.
