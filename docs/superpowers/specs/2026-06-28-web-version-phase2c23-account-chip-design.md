# Web Version — Phase 2c-23: Top-Right Account Chip (web)

**Date:** 2026-06-28 · **Status:** Approved

## Goal
On the **web** build, move the account out of the App-settings modal into a chip
in the title bar's top-right, and drop the now-empty settings entry point. Desktop
is untouched.

## Scope (web-only)
1. **Account chip** in the title bar's right slot (empty on web — window controls
   are desktop-only): avatar + Discord name button → a dropdown showing the role
   and **Sign out**.
2. **Surface the Discord identity** — `AuthStatus` gains optional `name?`/
   `avatarUrl?`, populated by `webAuthStatus` from the OAuth session's
   `user.user_metadata`.
3. **Remove the sidebar cog on web** — the App-settings modal's only web entry
   point. The "Synced" badge stays in the footer. The modal + `CheckForUpdates`
   stay for desktop (and check-for-update is already hidden on web since 2c-18).

## Identity mapping
`webAuthStatus` already fetches `user` via `sb.auth.getUser()`. Add a pure helper
`discordIdentity(meta)`:
- `name = meta.full_name || meta.name || meta.user_name || meta.preferred_username
  || 'Discord user'`
- `avatarUrl = meta.avatar_url || meta.picture || ''`
(Supabase's Discord provider populates these.) `webAuthStatus` returns
`{ …, name, avatarUrl }` on the signed-in branch. `AuthStatus.name`/`avatarUrl`
are optional, so the desktop `auth:status` impl (which omits them) stays valid.

## Components
- New `src/renderer/src/components/WebAccountMenu.tsx` (default export, no props):
  loads `client.authStatus()` on mount; renders the chip (avatar — `<img>` when
  `avatarUrl`, else the name's initial in a circle — + name + caret). Click toggles
  a dropdown (role badge + Sign out); closes on outside-click and Escape. **Sign
  out** → `await client.authSignOut()` then `globalThis.location.reload()` (the
  post-reload `WebRoot` resolves no session → Landing; realtime tears down via its
  `onAuthStateChange`). If not signed in (shouldn't happen on web — Landing gates
  it), render nothing.
- `Titlebar.tsx`: in the right-hand area, render `{isWeb() && <WebAccountMenu />}`
  (alongside the existing `!isWeb()` window controls — exactly one shows per
  platform).
- `App.tsx`: wrap the footer cog `<button>` in `{!isWeb() && ( … )}`. The
  `SYNC_META[sync]` badge and `AppSettings`/`appSettingsOpen` plumbing stay (still
  used by desktop and by `GuildSharing`'s `onOpenAppSettings`).

## Testing
Vitest (node, pure-logic only — no RTL).
- `discordIdentity`: full metadata → `{ name, avatarUrl }` from the preferred
  keys; fallback order (e.g. only `name`, only `user_name`); empty/undefined →
  `{ name: 'Discord user', avatarUrl: '' }`.
- `webAuthStatus` (extend `auth.test.ts`): a signed-in fake whose `getUser`
  returns `user_metadata: { full_name: 'Rasho', avatar_url: 'http://x/a.png' }`
  → the result includes `name: 'Rasho'`, `avatarUrl: 'http://x/a.png'`; the
  signed-out branch is unchanged.
- The chip/dropdown JSX and the cog gate are presentational — verified by
  `npm run typecheck` + `npm run build:web` + review.
- Full suite (`--pool=forks --poolOptions.forks.maxForks=2`) + typecheck +
  build:web green.

## Out of scope
- Desktop account UI (keeps the modal). Editing the Discord profile. An account
  page/settings beyond sign-out. Hiding the `v0.0.0-web` version label (separate
  nicety if wanted). Changing `AppSettings` internals.
