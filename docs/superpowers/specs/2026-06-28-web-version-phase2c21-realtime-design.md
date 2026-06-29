# Web Version — Phase 2c-21: Web Realtime Push

**Date:** 2026-06-28 · **Status:** Approved (option A)

## Goal
Make the web app update **live** when another officer changes data in the same
workspace — roster annotations/links/members, membership/invites/config, and the
audit log — instead of only on manual refresh. Mirrors the desktop
`SupabaseSyncProvider`, adapted to the web client (which has no local stores).

## Why web is simpler than desktop
Desktop maps each `postgres_changes` row into its local stores, then nudges the
renderer (`sync:changed`/`workspace:changed`). The web client has **no local
stores** — the renderer's event callbacks already re-fetch from Supabase
(`RosterView` re-`buildRoster`, member/invite panels re-query, `GuildLog`
re-loads audit). So web realtime only needs to **fire those callbacks** on a
change; no row→store mapping. The renderer's event seam already exists and needs
**zero component changes**.

## All target tables already stream
The realtime publication includes every table we need (verified):
roster_annotations / roster_links / roster_members (0001), workspace_members
(0001), workspace_invites (0005), workspaces (0006), audit_events (0009). No
migration needed.

## Architecture
New `src/renderer/src/lib/webClient/realtime.ts`:
`createWebRealtime(sb: SupabaseClient, settings: WebSettings): WebRealtime`.

```ts
interface WebRealtime {
  onSync(cb: () => void): () => void       // roster_annotations/links/members
  onWorkspace(cb: () => void): () => void  // workspace_members/invites/workspaces
  onAudit(cb: () => void): () => void       // audit_events
  onStatus(cb: (s: SyncStatus) => void): () => void
  status(): SyncStatus
  resync(): void   // active workspace changed → re-subscribe
  stop(): void     // sign-out
}
```

Internals: four callback `Set`s (sync/workspace/audit/status), one active
`RealtimeChannel`, the `currentWs` it's bound to, a serialized `ensure()`
(promise-chained so concurrent registrations/`resync`s can't double-subscribe),
and a tracked `_status`.

- `on*(cb)` adds `cb` to its set, calls `ensure()`, returns an unsubscribe that
  removes it. `onStatus(cb)` also immediately calls `cb(currentStatus)`.
- **`ensure()`** (serialized): resolve `activeWorkspaceId(sb, settings)`. None →
  `teardown()` + status `'disabled'`. Same as `currentWs` with a live channel →
  no-op. Otherwise: `teardown()` the old channel; set `currentWs`; status
  `'connecting'`; **`sb.realtime.setAuth(session.access_token)` BEFORE
  subscribe** (the realtime socket carries its own token — without this RLS drops
  every row and nothing arrives); open `axiroster-web:<ws>` with 7
  `postgres_changes` listeners (`event:'*'`, `schema:'public'`,
  `filter: workspace_id=eq.<ws>`): the 3 roster tables → `fan(sync)`, the 3 meta
  tables → `fan(workspace)`, `audit_events` → `fan(audit)`; `subscribe(st =>
  …)` maps `'SUBSCRIBED'`→`'connected'`, `'CHANNEL_ERROR'`/`'TIMED_OUT'`→`'error'`.
- **`teardown()`**: `sb.removeChannel(channel)` (guarded), clear `channel` +
  `currentWs`.
- **`resync()`**: `void ensure()` — after `setActiveGuild` changed the setting,
  `activeWorkspaceId` returns the new ws so `ensure()` re-subscribes (same ws →
  no-op).
- **Auth lifecycle** via `sb.auth.onAuthStateChange`:
  - `SIGNED_OUT` → `teardown()` + status `'disabled'`.
  - `TOKEN_REFRESHED` → `sb.realtime.setAuth(session.access_token)` only (the live
    socket re-auths existing channels; no resubscribe needed).
  - `SIGNED_IN` → `setAuth` + `ensure()` (subscribe now that we're authed).

## Wiring in `createWebClient`
- `const realtime = deps.supabase ? createWebRealtime(deps.supabase, settings) : null`.
- `onSyncChanged: (cb) => realtime ? realtime.onSync(cb) : noopUnsub()` (same for
  `onWorkspaceChanged`→`onWorkspace`, `onAuditUpdated`→`onAudit`,
  `onSyncStatus`→`onStatus`).
- `syncStatus: async () => realtime ? realtime.status() : 'disabled'`
  (`reinitSync` likewise returns `realtime?.status() ?? 'disabled'` after a
  `resync()`).
- `setActiveGuild: async (id) => { await webSetActiveGuild(settings, id);
  realtime?.resync() }`.

No renderer component changes. `onAuditError`/`onAuditStatus` stay no-op (audit
status isn't surfaced on web).

## Testing
Vitest (node), fakes only. A fake `sb` with: `auth.getSession` (returns a session
with `access_token`), `auth.getUser` + `from('workspace_members').select().eq()`
(for `activeWorkspaceId`), `auth.onAuthStateChange(cb)` (capture `cb`,
returns `{ data: { subscription: { unsubscribe(){} } } }`), `realtime.setAuth`
(spy recording call order), `channel(name)` → a fake channel recording each
`.on(type, opts, handler)` by `opts.table` and a `.subscribe(cb)` that invokes
`cb('SUBSCRIBED')`, and `removeChannel` (spy).
- `onSync` subscribe → channel opened for the active ws; firing the captured
  `roster_annotations` handler runs the sync callback; a `workspace_members`
  handler runs the workspace callback; an `audit_events` handler runs the audit
  callback.
- `setAuth` is called BEFORE `subscribe` (assert recorded order).
- `subscribe('SUBSCRIBED')` → `status()` is `'connected'`; an error state →
  `'error'`; `onStatus` receives the transitions.
- `resync()` after the active ws changes → old channel removed, new channel for
  the new ws (assert `removeChannel` called + new `channel(name)` with the new
  ws).
- `stop()` / a `SIGNED_OUT` event → `removeChannel` called, status `'disabled'`.
- no active workspace → no channel, status `'disabled'`.
- `webClient.test.ts`: with no supabase, `onSyncChanged`/`onWorkspaceChanged`/
  `onAuditUpdated`/`onSyncStatus` return a callable no-op unsubscribe and
  `syncStatus()` resolves `'disabled'` (unchanged).
- Full suite (`--pool=forks --poolOptions.forks.maxForks=2`) + `npm run typecheck`
  + `npm run build:web` green.

## Out of scope
- Optimistic local echo / row-level diffing (renderer re-fetches; debounced in
  `RosterView`). Presence/typing indicators. Retention realtime. Changing any
  renderer component or Edge Function. Backfill (the on-demand fetches already do
  initial load).
