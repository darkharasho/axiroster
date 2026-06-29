# Web Version — Phase 2c-18: Web Honesty Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five bugfixes so the web build stops lying/dead-ending: honest sync status, honest invite-generate error, gated dead Updates UI, caught refresh-roster failures, and a web Remove→Leave/owner-hide.

**Architecture:** Two webClient logic fixes (unit-tested) + one pure decision helper for the remove/leave button (unit-tested) + two presentational gates (typecheck/build-verified). `isWeb()` from `src/renderer/src/lib/runtime.ts` is the branch point.

**Tech Stack:** TypeScript, React renderer, Vitest (node env, pure-logic tests only — no RTL). No new deps.

## Global Constraints

- Vitest env is `node`; test PURE LOGIC only — do NOT add RTL/jsdom. Presentational `{!isWeb() && …}` gates and handler `catch`es are verified by `npm run typecheck` + `npm run build:web` + review.
- Touch ONLY: `src/renderer/src/lib/webClient/webClient.ts`, `admin.ts`, `admin.test.ts`; `src/renderer/src/components/GuildSettings.tsx` (+ a new `guildRemoveAction.test.ts`); `src/renderer/src/App.tsx`; `src/renderer/src/components/AppSettings.tsx`; `src/renderer/src/components/GuildSharing.tsx`. Do NOT touch `src/main`, `src/shared`, `src/preload`, `supabase/`, or other files.
- Web methods must still NEVER throw (webClient layer).
- Run vitest with `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` + `npm run build:web` green.

Reused facts:
- `SyncStatus = 'disabled' | 'connecting' | 'connected' | 'error'` (App maps `disabled` → "Local only", `connected` → "Synced").
- `InvitePanel.tsx:45` renders `result.error`.
- `App.tsx` holds `roles: Record<string,string>` (role per guild id) and renders `<GuildSettings guild={selected} … />` at ~364.
- `isWeb()` returns the runtime web flag; `import { isWeb } from '../lib/runtime'` (from a `components/` file).

---

### Task 1: webClient honesty — sync status (F5) + invite no-workspace error (F4)

**Files:**
- Modify: `src/renderer/src/lib/webClient/webClient.ts` (syncStatus/reinitSync), `src/renderer/src/lib/webClient/admin.ts` (webCreateInvite)
- Test: `src/renderer/src/lib/webClient/admin.test.ts` (+ a webClient sync test)

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/lib/webClient/admin.test.ts`, the existing `fakeSb` hardcodes `workspace_members` → `[{ workspace_id: 'w1', role: 'owner' }]`. Add an optional `members` to its opts so a test can force "no active workspace". Change the opts type and the `workspace_members` branch:
```ts
function fakeSb(opts: { rows?: unknown[]; invoke?: ReturnType<typeof vi.fn>; insertCode?: string; members?: { workspace_id: string; role: string }[] } = {}) {
  // ...unchanged...
    from: (t: string) =>
      t === 'workspace_members'
        ? { select: () => ({ eq: () => Promise.resolve({ data: opts.members ?? [{ workspace_id: 'w1', role: 'owner' }] }) }) }
        : invitesBuilder(),
```
Then add the test:
```ts
test('createInvite returns an explicit error when there is no active workspace', async () => {
  const { sb } = fakeSb({ members: [] })
  expect(await webCreateInvite(sb, settings(), { role: 'write' })).toEqual({ error: 'No active guild selected.' })
})
```

In `src/renderer/src/lib/webClient/webClient.test.ts`, the test `window/update/sync/audit stubs resolve sensibly` (≈line 43) builds a NO-supabase client (`createWebClient({ storage: fakeStorage() })`) and currently asserts `syncStatus`/`reinitSync` resolve `'connected'` (lines 48-49). Those two lines ARE the no-supabase case — change them to `'disabled'`:
```ts
  await expect(c.syncStatus()).resolves.toBe('disabled')
  await expect(c.reinitSync()).resolves.toBe('disabled')
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/admin.test.ts src/renderer/src/lib/webClient/webClient.test.ts`
Expected: FAIL — `createInvite` returns `{}`; `syncStatus` returns `'connected'`.

- [ ] **Step 3: Implement**

In `admin.ts` `webCreateInvite`, change the no-workspace return:
```ts
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) return { error: 'No active guild selected.' }
```
In `webClient.ts`, make the two methods honest:
```ts
    syncStatus: async () => (deps.supabase ? 'connected' : 'disabled'),
    reinitSync: async () => (deps.supabase ? 'connected' : 'disabled'),
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/webClient/webClient.ts src/renderer/src/lib/webClient/admin.ts src/renderer/src/lib/webClient/admin.test.ts src/renderer/src/lib/webClient/webClient.test.ts
git commit -m "fix(web): honest syncStatus when unconfigured + explicit createInvite no-workspace error"
```

---

### Task 2: Web Remove → Leave / owner-hide (F1)

**Files:**
- Modify: `src/renderer/src/components/GuildSettings.tsx` (export `guildRemoveAction` + consume it; add `role?` prop), `src/renderer/src/App.tsx` (pass `role`)
- Test: `src/renderer/src/components/guildRemoveAction.test.ts`

**Interfaces:**
- Produces: `guildRemoveAction(role: string | undefined, web: boolean, guildName: string): { label: string; title: string; confirmText: string } | null`.

- [ ] **Step 1: Write the failing test**

`src/renderer/src/components/guildRemoveAction.test.ts`:
```ts
import { test, expect } from 'vitest'
import { guildRemoveAction } from './GuildSettings'

test('desktop: always Remove with the destructive confirm', () => {
  expect(guildRemoveAction('owner', false, 'Saga')).toEqual({
    label: 'Remove',
    title: 'Remove guild',
    confirmText: 'Remove guild "Saga"? Its keys and selections are deleted.'
  })
  expect(guildRemoveAction('read', false, 'Saga')?.label).toBe('Remove')
})

test('web owner: button hidden (null)', () => {
  expect(guildRemoveAction('owner', true, 'Saga')).toBeNull()
})

test('web non-owner: Leave with a non-destructive confirm', () => {
  for (const role of ['write', 'read', undefined]) {
    expect(guildRemoveAction(role, true, 'Saga')).toEqual({
      label: 'Leave',
      title: 'Leave guild',
      confirmText: 'Leave guild "Saga"? You\'ll lose access to its roster.'
    })
  }
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/components/guildRemoveAction.test.ts`
Expected: FAIL — `guildRemoveAction` not exported.

- [ ] **Step 3: Add the helper + consume it**

In `GuildSettings.tsx`: add the import `import { isWeb } from '../lib/runtime'` (if not present), and export the helper near the top (module level, after imports):
```ts
export function guildRemoveAction(
  role: string | undefined,
  web: boolean,
  guildName: string
): { label: string; title: string; confirmText: string } | null {
  if (!web) {
    return {
      label: 'Remove',
      title: 'Remove guild',
      confirmText: `Remove guild "${guildName}"? Its keys and selections are deleted.`
    }
  }
  // Owner-side guild deletion is a deferred destructive feature; desktop never
  // deletes the server workspace either. Non-owners can leave (2c-17).
  if (role === 'owner') return null
  return {
    label: 'Leave',
    title: 'Leave guild',
    confirmText: `Leave guild "${guildName}"? You'll lose access to its roster.`
  }
}
```
Add `role` to the props:
```ts
export default function GuildSettings({
  guild,
  role,
  onChanged,
  onRemoved
}: {
  guild: GuildSummary
  role?: string
  onChanged: () => void
  onRemoved: () => void
}): JSX.Element {
```
Replace the existing Remove `<button>` (the one with the `confirm("Remove guild …")`) with a conditional that uses the helper:
```tsx
          {(() => {
            const action = guildRemoveAction(role, isWeb(), guild.name)
            if (!action) return null
            return (
              <button
                onClick={async () => {
                  if (confirm(action.confirmText)) {
                    await client.removeGuild(guild.id)
                    onRemoved()
                  }
                }}
                className="btn text-ink-faint hover:text-red-400"
                title={action.title}
              >
                <Trash2 size={14} /> {action.label}
              </button>
            )
          })()}
```

In `App.tsx`, pass the role into `GuildSettings` (it renders with `guild={selected}`):
```tsx
            <GuildSettings
              guild={selected}
              role={roles[selected.id]}
              onChanged={loadGuilds}
              onRemoved={async () => {
                setView('guild')
                setSelectedId(null)
                await loadGuilds()
              }}
            />
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/components/guildRemoveAction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/GuildSettings.tsx src/renderer/src/components/guildRemoveAction.test.ts src/renderer/src/App.tsx
git commit -m "fix(web): owner Remove-guild no longer lies — hide for owners, Leave for members"
```

---

### Task 3: Gate dead Updates UI (F2) + catch refresh-roster failures (F3)

**Files:**
- Modify: `src/renderer/src/components/AppSettings.tsx` (gate Updates section), `src/renderer/src/components/GuildSharing.tsx` (add catch)

(No new unit tests — both are presentational/handler changes with no extractable logic; verified by typecheck + build + review.)

- [ ] **Step 1: Gate the Updates section in `AppSettings.tsx`**

Add `import { isWeb } from '../lib/runtime'` (after the existing imports). Wrap the entire Updates `<section>` (the one containing `<CheckForUpdates />` and the "What's new in this version" button) so it renders only off-web:
```tsx
        {/* Updates — desktop only (no auto-updater or release notes on web) */}
        {!isWeb() && (
          <section className="space-y-3 rounded-lg border border-panel-line bg-panel-raised/40 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Updates</h2>
              {version && <span className="text-xs text-ink-faint">v{version}</span>}
            </div>
            <CheckForUpdates />
            <button onClick={onShowWhatsNew} className="btn w-full justify-center">
              <Sparkles size={14} /> What&apos;s new in this version
            </button>
          </section>
        )}
```

- [ ] **Step 2: Add a catch to `handleRefreshRoster` in `GuildSharing.tsx`**

Replace the handler body:
```ts
  const handleRefreshRoster = async (): Promise<void> => {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const result = await client.refreshRoster()
      setRefreshMsg(`Synced ${result.count} members`)
      setTimeout(() => setRefreshMsg(null), 4000)
    } catch (e) {
      setRefreshMsg(`Refresh failed: ${e instanceof Error ? e.message : 'unknown error'}`)
      setTimeout(() => setRefreshMsg(null), 6000)
    } finally {
      setRefreshing(false)
    }
  }
```

- [ ] **Step 3: Verify gates**

Run: `npm run typecheck` → clean (the `isWeb` import is used; no unused symbols). Run: `npm run build:web` → succeeds. Run: `npm test` → all pass (no test changed here, but confirm nothing broke).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/AppSettings.tsx src/renderer/src/components/GuildSharing.tsx
git commit -m "fix(web): hide desktop-only Updates section; surface refresh-roster failures"
```

---

## Self-Review Notes

- **Spec coverage:** F5 syncStatus/reinitSync honesty → Task 1. F4 createInvite no-ws error → Task 1. F1 owner Remove lie → Task 2 (helper + JSX + App role prop). F2 dead Updates/What's-new → Task 3 Step 1. F3 refresh-roster catch → Task 3 Step 2. Deferred items (retention/pipeline persistence; web invite onboarding) intentionally NOT in any task — flagged in spec.
- **Placeholder scan:** none — every step has full code.
- **Type consistency:** `guildRemoveAction(role?, web, guildName)` signature identical in Task 2 Step 1 (test) and Step 3 (impl) and consumer. `role?: string` prop added to `GuildSettings` and supplied as `roles[selected.id]` (both `string | undefined`). `syncStatus`/`reinitSync` return `SyncStatus` (`'connected'`/`'disabled'`). `webCreateInvite` returns `InviteResult` (`{ error }` is valid). The `isWeb` import path `'../lib/runtime'` matches Titlebar's usage.
- **Test reality:** F1/F4/F5 are unit-tested; F2/F3 are presentational and rely on typecheck+build (node-env repo has no RTL — consistent with prior slices like 2c-16's `saveOutcome`).
