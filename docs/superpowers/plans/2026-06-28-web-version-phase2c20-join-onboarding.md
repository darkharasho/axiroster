# Web Version — Phase 2c-20: Web "Join a guild" Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the web no-guild dead-end with an invite-code redemption empty-state (`WebJoinGuild`), gated into App for signed-in web members with zero guilds.

**Architecture:** One new presentational component with an exported pure `redeemErrorMessage` helper (unit-tested), wired into `App.tsx`'s `!selected` branch behind `isWeb() && guilds.length === 0`.

**Tech Stack:** TypeScript, React renderer, Tailwind, Vitest (node, pure-logic only — no RTL), lucide-react. No new deps.

## Global Constraints

- Touch ONLY: `src/renderer/src/components/WebJoinGuild.tsx` (new), `src/renderer/src/components/redeemErrorMessage.test.ts` (new), `src/renderer/src/App.tsx`. Do NOT touch the webClient, `src/main`, `src/shared`, `src/preload`, `supabase/`, or other components.
- Desktop behavior unchanged: the `!selected` branch still shows "No guilds yet…" when `!isWeb()` or `guilds.length > 0`.
- `redeemInvite(code)` returns `{ ok: boolean; error?: string; role?: string; workspaceId?: string }` (existing). On `ok`, call `onJoined(res.workspaceId)`.
- Tailwind tokens already in the app: `panel`/`panel-raised`/`panel-line`/`panel-line2`, `ink`/`ink-dim`/`ink-faint`, `accent`, `emerald-*`. The app uses lucide-react icons.
- Run vitest with `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` + `npm run build:web` green.

---

### Task 1: `WebJoinGuild` component + App gate

**Files:**
- Create: `src/renderer/src/components/WebJoinGuild.tsx`, `src/renderer/src/components/redeemErrorMessage.test.ts`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Produces: `WebJoinGuild({ onJoined }: { onJoined: (workspaceId?: string) => void }): JSX.Element` (default export); `redeemErrorMessage(res: { ok: boolean; error?: string }): string | null` (named export).

- [ ] **Step 1: Write the failing test**

`src/renderer/src/components/redeemErrorMessage.test.ts`:
```ts
import { test, expect } from 'vitest'
import { redeemErrorMessage } from './WebJoinGuild'

test('ok result → no error', () => {
  expect(redeemErrorMessage({ ok: true })).toBeNull()
})

test('failure with a message → that message', () => {
  expect(redeemErrorMessage({ ok: false, error: 'Invite already used' })).toBe('Invite already used')
})

test('failure without a message → default', () => {
  expect(redeemErrorMessage({ ok: false })).toBe('Could not redeem that code')
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/components/redeemErrorMessage.test.ts`
Expected: FAIL — cannot find `./WebJoinGuild` / `redeemErrorMessage` not exported.

- [ ] **Step 3: Implement `WebJoinGuild.tsx`**

```tsx
// src/renderer/src/components/WebJoinGuild.tsx
// Web-only onboarding for a signed-in member with no guild yet: redeem an invite
// code to join. Creating a NEW guild needs a GW2 leader key (desktop / the
// sidebar "Add a guild"), so this focuses on the common member path.
import { useState } from 'react'
import { Link2, Loader2, ShieldCheck, Info } from 'lucide-react'
import { client } from '../lib/client'

export function redeemErrorMessage(res: { ok: boolean; error?: string }): string | null {
  return res.ok ? null : res.error ?? 'Could not redeem that code'
}

export default function WebJoinGuild({
  onJoined
}: {
  onJoined: (workspaceId?: string) => void
}): JSX.Element {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const redeem = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const res = await client.redeemInvite(code)
    setBusy(false)
    const msg = redeemErrorMessage(res)
    if (msg) {
      setError(msg)
      return
    }
    onJoined(res.workspaceId)
  }

  return (
    <div className="grid flex-1 place-items-center px-8 py-10">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-panel-line bg-panel-raised shadow-raise">
          <ShieldCheck size={26} className="text-emerald-400" />
        </div>
        <h1 className="mb-1.5 text-lg font-semibold text-white">You&apos;re in — now join a guild</h1>
        <p className="mb-6 text-sm leading-relaxed text-ink-dim">
          Ask your guild lead for an invite code, then drop it in below.
        </p>

        <div className="rounded-xl border border-panel-line bg-panel-raised/60 p-5 text-left shadow-raise">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-dim">
            <Link2 size={14} className="text-emerald-400" /> Redeem an invite code
          </h2>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) void redeem()
              }}
              placeholder="e.g.  K7P2-9XQM"
              className="min-w-0 flex-1 rounded-lg border border-panel-line2 bg-panel-sunk px-3 py-2.5 font-mono text-[13px] tracking-wide text-ink shadow-sunk outline-none placeholder:font-sans placeholder:text-ink-faint focus:border-accent"
            />
            <button
              onClick={() => void redeem()}
              disabled={busy}
              className="btn btn-accent shrink-0 px-5"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : 'Join'}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-faint">
            Already invited? Pending invites show in the left sidebar — accept one there.
          </p>
        </div>

        <p className="mt-4 flex items-start justify-center gap-2 px-1 text-left text-xs leading-relaxed text-ink-faint">
          <Info size={14} className="mt-px shrink-0" />
          <span>
            Setting up a <em>new</em> guild uses your GW2 leader API key — do that in the desktop app (or via
            “Add a guild” if you have the key).
          </span>
        </p>
      </div>
    </div>
  )
}
```
NOTE: `.btn` and `.btn-accent` are existing CSS component classes (defined in
`src/renderer/src/index.css`, used in `AppSettings.tsx`/`PendingInvites.tsx`), so
`className="btn btn-accent shrink-0 px-5"` is correct. `shadow-raise`,
`bg-panel-sunk`, `bg-panel-raised`, `shadow-sunk`, `focus:border-accent` are all
valid project tokens.

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/components/redeemErrorMessage.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `App.tsx`**

Add imports near the other component imports:
```ts
import WebJoinGuild from './components/WebJoinGuild'
import { isWeb } from './lib/runtime'
```
Replace the `!selected` empty-state block:
```tsx
          ) : !selected ? (
            isWeb() && guilds.length === 0 ? (
              <WebJoinGuild
                onJoined={(wsId) => {
                  if (wsId) void selectGuild(wsId)
                  else void loadGuilds()
                }}
              />
            ) : (
              <div className="grid flex-1 place-items-center px-8 text-center text-sm text-ink-faint">
                No guilds yet. Click <span className="mx-1 text-ink">Add a guild</span> to connect one.
              </div>
            )
          ) : tab === 'roster' ? (
```

- [ ] **Step 6: Full gates**

Run: `npm run typecheck` → clean (both new imports used; no unused symbols). Run: `npm run build:web` → succeeds. Run: `npm test` (`npx vitest run --pool=forks --poolOptions.forks.maxForks=2`) → all pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/WebJoinGuild.tsx src/renderer/src/components/redeemErrorMessage.test.ts src/renderer/src/App.tsx
git commit -m "feat(web): Join-a-guild onboarding empty-state (redeem invite code) for no-guild members"
```

---

## Self-Review Notes

- **Spec coverage:** `WebJoinGuild` redeem-code empty-state with `redeemErrorMessage` helper → Task 1 Steps 1,3. App gate behind `isWeb() && guilds.length === 0`, desktop unchanged → Step 5. `onJoined` → `selectGuild(wsId)` lands the user in the joined guild → Step 5. Pending-invite hint + desktop-create footnote → component JSX. Tests for the helper → Step 1.
- **Placeholder scan:** none — full component, test, and gate code provided. The `btn-accent` note gives a concrete fallback so there's no ambiguity.
- **Type consistency:** `WebJoinGuild({ onJoined: (workspaceId?: string) => void })` matches the App call `onJoined={(wsId) => …}`. `redeemErrorMessage(res: { ok; error? })` matches the test and the `redeemInvite` return shape. `selectGuild(id: string)` / `loadGuilds()` are existing App functions. `isWeb` import path `./lib/runtime` matches other renderer usage (`../lib/runtime` from components; `./lib/runtime` from App at `src/renderer/src/`).
