# Web Version — Phase 2c-11: Web Audit Log (auditList + auditRefresh)

**Date:** 2026-06-28
**Status:** Approved (sensible-defaults run)

## Goal
Make the **Log tab** show data on web: implement `auditList(filter?)` and
`auditRefresh()` (the last two `notImplemented` audit stubs — `auditStatus`
already returns `null`, and `onAudit*` are no-op). `auditList` reads the Phase-0
`audit_events` Supabase table directly (CORS-ok, no Edge Function).

## How (uses the Phase-0 schema as designed)
`audit_events(workspace_id, uid, source, type, actor, target, summary, ts,
payload jsonb, …)` — `payload` is the full normalized `AuditEvent`; the
broken-out columns (`source`/`type`/`actor`/`target`/`summary`/`ts`) exist
precisely for DB filtering, with an index on `(workspace_id, ts desc)`.

- **`auditList(filter?): { events: AuditEvent[]; updatedAt: string }`**
  - Resolve the active workspace (`activeWorkspaceId`); none → `{ events: [], updatedAt: '' }`.
  - `from('audit_events').select('payload').eq('workspace_id', ws)
    .order('ts', { ascending: false }).limit(filter?.limit ?? 1000)`;
    `+ .eq('source', filter.source)` / `.eq('type', filter.type)` when present;
    for `filter.search`, sanitize (strip `,()%*`) then
    `.or('actor.ilike.%s%,target.ilike.%s%,summary.ilike.%s%')`.
  - Map each row's `payload` → `AuditEvent`; `updatedAt = events[0]?.time ?? ''`.
  - Never throws → `{ events: [], updatedAt: '' }` on error (GuildLog calls it on
    mount/poll).
- **`auditRefresh(): Result<number>`** — there is no server-side audit poller on
  web (the desktop's `auditSync` runs in the main process; the GW2/AxiTools keys
  are server-side and there is no audit-refresh function), so refresh is a no-op
  that returns `{ ok: true, data: 0 }` (0 new events). [FLAG] the web Log shows
  whatever the desktop poller has synced into `audit_events`; a server-side
  poller is a separately-deferred phase. Honest: it genuinely added 0.

`auditStatus()` stays `null` (GuildLog guards `s && setStatus(s)`, so the
per-source badges simply don't render on web). `onAuditUpdated`/`onAuditError`/
`onAuditStatus` stay no-op.

## Architecture
New `src/renderer/src/lib/webClient/audit.ts`: `webAuditList(sb, settings, filter)`
+ `webAuditRefresh()`. Imports `AuditEvent`/`AuditFilter`/`Result` from
`../../../../preload/index.d`; reuses `activeWorkspaceId` from `./discordGw2`.

`webClient.ts` wiring: `auditList` → `deps.supabase ? webAuditList(...) : { events: [], updatedAt: '' }`; `auditRefresh` → `{ ok: true, data: 0 }` (no supabase needed — it's a no-op).

## Testing
Vitest (node), fakes only. Chainable supabase builder supporting
`.select/.eq/.order/.limit/.or` (chainable + thenable resolving `{ data }`) +
`auth.getUser`/`workspace_members` for `activeWorkspaceId`.
- `webAuditList`: rows with `payload` AuditEvents → mapped events newest-first,
  `updatedAt` = first event's `time`; a `source` filter adds `.eq('source', …)`;
  a `search` filter adds `.or(...)`; no workspace → `{ events: [], updatedAt: '' }`.
- `webAuditRefresh`: resolves `{ ok: true, data: 0 }`.
- `webClient.test.ts`: `auditList()` with no supabase → `{ events: [], updatedAt: '' }`.
- Full suite + typecheck green; `createWebClient` stays conformant.

## Out of scope
- A server-side audit poller (separate deferred phase); building a real
  `auditStatus`; members/pipeline; the Cloudflare deploy.
