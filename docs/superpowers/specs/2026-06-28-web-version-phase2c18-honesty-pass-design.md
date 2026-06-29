# Web Version — Phase 2c-18: Web Honesty Pass

**Date:** 2026-06-28 · **Status:** Approved (autonomous edge-case run)

## Goal
Stop the web build from **lying or dead-ending** in five concrete spots an
edge-case audit found. These are bugfixes, not new features — each makes a web
control honest about what it can actually do. (Two larger findings — server
persistence for retention/pipeline flags, and a web invite-code onboarding
screen — need real design and are deferred, see Out of scope.)

The web build runs the SAME renderer components as desktop with `createWebClient`
installed; `isWeb()` (`src/renderer/src/lib/runtime.ts`) is the one branch point.

## Fixes

### F1 — Owner "Remove guild" lies on web (audit #1) [High]
`GuildSettings.tsx` Remove button does `confirm("Remove guild … Its keys and
selections are deleted.")` → `client.removeGuild` → `onRemoved()`, but on web
`webRemoveGuild` is a no-op for owners (2c-17) and the guild reappears on reload.
**Fix:** decide the button via a pure helper `guildRemoveAction(role, web,
guildName)`:
- Desktop (`web === false`) → `{ label:'Remove', title:'Remove guild',
  confirmText:'Remove guild "<name>"? Its keys and selections are deleted.' }`
  (unchanged).
- Web **owner** → `null` (hide the button — owner-side guild deletion is a
  deferred destructive feature; desktop never deletes the server workspace
  either). [FLAG]
- Web **non-owner** (`write`/`read`) → `{ label:'Leave', title:'Leave guild',
  confirmText:'Leave guild "<name>"? You'll lose access to its roster.' }` — this
  works now via 2c-17's `wm_self_leave`.
`App` passes the role it already holds (`roles[guild.id]`) into `GuildSettings`
as a new `role?: string` prop; `GuildSettings` renders the button only when the
helper returns non-null, using its label/title/confirm, still calling
`client.removeGuild(guild.id)` then `onRemoved()`.

### F2 — Updates section is dead UI + empty What's-new modal on web (audit #2, #3) [High]
`AppSettings.tsx` always renders the Updates `<section>`: `CheckForUpdates` hangs
on "Checking…" forever (the update events are no-op on web) and the "What's new"
button opens a modal that says "Release notes unavailable" (`getWhatsNew` →
`releaseNotes:null`). **Fix:** wrap the entire Updates `<section>` in
`{!isWeb() && ( … )}`. That removes both the updater UI and the What's-new button
on web in one gate. (The auto-show What's-new path in `App.tsx` is already guarded
by `w.releaseNotes`, so it never fires on web; `openWhatsNew` is only reachable
from the now-hidden button.)

### F3 — "Refresh roster" swallows failures on web (audit #5) [Med]
`GuildSharing.tsx` `handleRefreshRoster` has `try/finally` but no `catch`;
`webRefreshRoster` is the one web method that throws, so a failure is an unhandled
rejection — spinner stops, no message. **Fix:** add a `catch` that sets
`refreshMsg` to a human error (`Refresh failed: <message>`).

### F4 — Invite "Generate code" silently does nothing with no active guild (audit #8) [Med]
`admin.ts` `webCreateInvite` returns `{}` (no code, no error) when there's no
active workspace, so `InvitePanel` shows neither. **Fix:** return `{ error: 'No
active guild selected.' }` — `InvitePanel` already renders `result.error`
(`InvitePanel.tsx:45`).

### F5 — Sync badge always says "Synced", even unconfigured (audit #9) [Med]
`webClient.ts` hardcodes `syncStatus`/`reinitSync` → `'connected'` ("Synced"),
even when the client was built with no Supabase (missing `VITE_SUPABASE_*`).
**Fix:** return `'connected'` only when `deps.supabase` is set, else `'disabled'`
(App maps `disabled` → "Local only"). This honestly distinguishes a configured
web client from an unconfigured one. (Realtime-liveness nuance — "Synced" while
there's no realtime push — is left as-is; it is genuinely synced on read, just
not live.)

## Architecture / testing
Vitest env is `node` (no RTL); the repo tests **pure logic**, not rendered
components.
- **F1**: pure `guildRemoveAction(role: string | undefined, web: boolean,
  guildName: string)` helper exported from `GuildSettings.tsx` → unit-tested
  (desktop→Remove; web+owner→null; web+read→Leave; web+write→Leave; confirm text
  interpolates the name). The JSX consuming it + the `App` role prop are verified
  by typecheck + build.
- **F4**, **F5**: pure webClient logic → unit-tested (`webCreateInvite` no-ws →
  `{error}`; `createWebClient` without supabase → `syncStatus()==='disabled'`,
  with supabase → `'connected'`).
- **F2**, **F3**: presentational `{!isWeb() && …}` gate and a handler `catch` —
  no extractable logic; verified by `npm run typecheck` + `npm run build:web` +
  review. (Adding RTL infra for two trivial gates is unjustified.)
- All gates: full suite (`--pool=forks --poolOptions.forks.maxForks=2`) +
  `npm run typecheck` + `npm run build:web` green.

## Out of scope (deferred, flagged)
- **Retention/pipeline flag server persistence** (audit #4) — `retentionEnabled`/
  `pipelineEnabled` are desktop-local-only; web hardcodes `false`/`true`, so the
  Settings toggles don't persist and the Retention tab can't appear on web. Needs
  a storage decision (workspaces columns vs a meta row) — separate slice.
- **Web invite-code onboarding** (audit #6, #7) — a signed-in member with no
  guild/invite has no "enter an invite code" UI and the "Add a guild" path needs
  a GW2 leader key. A proper web empty-state / redeem-code screen is a designed
  feature — separate slice.
- Owner-side destructive guild deletion; realtime push.
