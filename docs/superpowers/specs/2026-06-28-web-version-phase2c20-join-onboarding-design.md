# Web Version — Phase 2c-20: Web "Join a guild" Onboarding

**Date:** 2026-06-28 · **Status:** Approved (option A, mockup shown)

## Goal
Give a signed-in web member with **no guild** a way forward (audit #6/#7). Today
they drop past the Landing into App and see "No guilds yet. Click *Add a guild* to
connect one" — but Add-a-guild needs a GW2 leader key they usually lack, so it's a
soft lock. Replace that dead-end (on web only) with a focused **invite-code
redemption** empty-state.

## Design (option A — dedicated empty-state)
A web-only `WebJoinGuild` component rendered in App's main content area when a
signed-in web user has **zero guilds**. Contents (matches the approved mockup):
- Heading "You're in — now join a guild" + a line ("Ask your guild lead for an
  invite code").
- **Redeem an invite code** card: a text input + "Join" button → `redeemInvite`.
  On success, join the workspace and land in it. On failure, show the error.
- A hint that pending invites appear in the sidebar (accept there).
- A footnote that creating a *new* guild uses a GW2 leader key (desktop / the
  sidebar "Add a guild" for those who have it).

Creating/claiming a guild is unchanged — the sidebar "Add a guild" still works for
GW2 leaders (2c-16). This only fills the empty-member case.

## Flow
- `redeemInvite(code)` already exists (2c-15) → `{ ok; error?; role?; workspaceId? }`
  (`webRedeemInvite` trims, handles empty → `{ ok:false, error:'Enter an invite
  code' }`, invokes the `redeem-invite` Edge Function).
- On `ok`, call `onJoined(workspaceId)`; App selects the new guild (`selectGuild`,
  which sets it active + reloads) so the user lands on its roster.
- On failure, render `res.error` (or a default) inline; the input stays.

## Architecture
- New `src/renderer/src/components/WebJoinGuild.tsx`:
  - default export `WebJoinGuild({ onJoined }: { onJoined: (workspaceId?: string)
    => void })`.
  - exported pure helper `redeemErrorMessage(res: { ok: boolean; error?: string })
    : string | null` → `res.ok ? null : (res.error ?? 'Could not redeem that
    code')` (unit-tested; the component is otherwise presentational).
  - calls `client.redeemInvite(code)`; busy + error local state.
- `src/renderer/src/App.tsx`:
  - import `isWeb` (`./lib/runtime`) and `WebJoinGuild`.
  - In the `!selected` branch, when `isWeb() && guilds.length === 0` render
    `<WebJoinGuild onJoined={(wsId) => { if (wsId) void selectGuild(wsId); else
    void loadGuilds() }} />`; otherwise the existing "No guilds yet" text
    (desktop unchanged). Gating on `guilds.length === 0` (not just `!selected`)
    avoids a flash during transient deselect when guilds exist.

## Testing
Vitest (node, pure-logic only — no RTL).
- `redeemErrorMessage`: `{ok:true}` → null; `{ok:false, error:'x'}` → 'x';
  `{ok:false}` → 'Could not redeem that code'.
- The component JSX + the App gate are verified by `npm run typecheck` +
  `npm run build:web` (consistent with prior slices' presentational changes).
- Full suite (`--pool=forks --poolOptions.forks.maxForks=2`) + typecheck +
  build:web green.

## Out of scope
- Changing the Landing (signed-out) screen or the sidebar "Add a guild".
- An in-app "create a keyless guild" path; realtime; owner-side delete.
- Surfacing pending invites *inside* the empty-state (they already live in the
  sidebar; the hint points there).
