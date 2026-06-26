# Guild Log — Design

**Date:** 2026-06-26
**Status:** Approved (design), pending implementation plan

## Summary

A guild-scoped **Guild Log**: a unified, chronological audit log that merges
**GW2 guild-log events** and **Discord audit events** into one stream. Data is
pulled live from two sources, persisted to a **local per-guild JSON store**, and
**never synced to Supabase**. Each member's AxiRoster instance keeps its own
local copy, fetched with the API keys it already holds — there is no cross-member
sync. A main-process poller keeps the local copy current while the app runs.

## Goals

- One chronological, filterable view of guild activity combining GW2 + Discord.
- Local-only persistence (no Supabase rows — keeps the shared instance lean).
- "Live-feeling": frequent background sync so the tab is current on open.
- Accumulate history locally beyond the bot's 30-day retention window.

## Non-goals

- No cross-member sync of audit data (no SyncProvider involvement).
- No write/mutation of audit events — read-only view.
- No new persistence dependency (stay on plain JSON files, like existing stores).

## Sources

Both sources already exist; the GW2 half is wired today and the Discord half is
served by the AxiTools bot (a repo we control).

| Source  | Origin                                   | Fetch                                                       |
|---------|------------------------------------------|------------------------------------------------------------|
| GW2     | GW2 API `GET /v2/guild/:id/log`          | `Gw2Client.guildLog(guildId, sinceLogId)` (exists)         |
| Discord | AxiTools bot `GET /guilds/:id/audit/discord` | new `AxitoolsClient.auditDiscord(guildId, { sinceId?, limit })` |

> **Decision:** GW2 is pulled **directly from the GW2 API** on AxiRoster's own
> frequent schedule — NOT from the bot's `/audit/gw2` endpoint, whose internal
> sync only runs every 24h. Discord is pulled from the bot, which already
> aggregates ~20 event types with **pre-resolved actor/target names**.

### AxiTools bot facts (repo: `../axitools`)

- aiohttp server, Bearer auth via `axt1.` per-guild keys (same as roster calls).
- `GET /guilds/{guild_id}/audit/discord` — query: `limit` (≤200, default 50),
  `event_type`, `actor`, `target`. Returns newest-first JSON, IDs as strings.
- Per-guild encrypted SQLite store, **30-day retention**.
- Discord event types: `member_join`, `member_leave`, `member_kick`,
  `member_ban`, `member_unban`, `member_role_update`, server mute/deaf variants,
  `message_delete`, `message_edit`, `role_create/update/delete`, `guild_update`,
  `emoji_update`, `channel_create/update/delete`.

## Architecture

```
GW2 API  /guild/:id/log ──┐
                          ├─► auditSync (5-min poller, main) ─► auditStore (JSON, userData) ─► IPC ─► GuildLog.tsx
AxiTools /audit/discord ──┘
```

### Components

- **`src/main/auditStore.ts`** (new) — owns `userData/auditLog/<guildId>.json`.
  Idioms copied from `rosterStore.ts`: atomic tmp+rename, debounced writes,
  corrupt/missing-file safe (never throws, treats as empty). Responsibilities:
  dedupe by `uid`, sort newest-first, rolling cap **50,000** events per guild,
  persist source cursors.
- **`src/main/auditSync.ts`** (new) — the poller. A 5-min interval timer plus an
  on-demand `refresh(guildId)`. Each tick pulls both sources incrementally,
  normalizes, merges into the store, advances cursors, and emits an
  `audit:updated` IPC event to the renderer. Re-targets when the active guild
  changes; stops when no guild is active. Sources pull independently — one
  failing does not block the other.
- **Normalizers** (in `auditSync.ts` or a sibling `auditNormalize.ts`) — map each
  API's records to the unified `AuditEvent` shape and build a human `summary`
  per event type.
- **`src/renderer/src/components/GuildLog.tsx`** (new) — the view; new guild-scoped
  **"Log"** nav tab alongside Roster / Sharing / Settings in `App.tsx`.
- **`src/main/axitoolsClient.ts`** — add `auditDiscord(guildId, { sinceId?, limit })`.

## Data model

Unified, normalized event shape so the two sources merge cleanly:

```ts
interface AuditEvent {
  uid: string                    // `${source}:${id}` — dedupe key
  source: 'gw2' | 'discord'
  id: string                     // original id (string; JS-safe)
  time: string                   // ISO 8601
  type: string                   // e.g. 'member_join', 'kick', 'rank_change'
  actor?: string                 // who did it (display name)
  target?: string                // who/what it was done to
  summary: string                // one-line human-readable description
  raw: unknown                   // original payload, for the detail view
}
```

On-disk file shape:

```ts
interface AuditFile {
  events: AuditEvent[]
  cursors: { gw2LastLogId?: number; discordLastId?: string }
  updatedAt: string
}
```

## Sync flow

1. **GW2**: `guildLog(guildId, cursors.gw2LastLogId)` → entries after the last
   seen log id (native `since`). Advance `gw2LastLogId` to the max id seen.
2. **Discord**: pull from `/audit/discord` passing `cursors.discordLastId`.
   Advance `discordLastId` to the newest id seen.
3. **Merge**: normalize → dedupe by `uid` → insert → sort desc by `time` → trim
   to 50k → persist (debounced) → emit `audit:updated`.
4. **Cadence**: 5-min background interval while the app runs **+** immediate pull
   when the Log tab opens **+** manual **Refresh** button. A "last synced"
   timestamp is shown in the UI.

### Required bot change (repo: `../axitools`)

Add a `since_id` query param to `GET /guilds/:id/audit/discord`, mirroring the
existing `since_log_id` on `/audit/gw2`. This makes catch-up after the app has
been closed **correct** rather than capped at the newest 200 events. AxiRoster
passes `cursors.discordLastId`. Small change, follows the existing handler
pattern (`_handle_audit_discord` in `axitools/api/server.py`).

## IPC

- `audit:list` `(guildId, filters?)` → `AuditEvent[]` (from local store).
- `audit:refresh` `(guildId)` → triggers an immediate sync, returns updated events.
- push `audit:updated` `(guildId)` → renderer re-fetches the list.

## UI

- Newest-first list, grouped by day.
- Row: time · **source badge** (GW2 / Discord) · type icon · `summary` ·
  `actor → target`.
- Controls: source filter (All / GW2 / Discord), event-type filter, free-text
  search (actor/target/summary), manual **Refresh** + last-synced label.
- Click a row → detail panel showing the raw payload.
- Empty state guides the first sync.

## Error handling

- Each source pulls independently; a GW2 failure still lets Discord update and
  vice-versa. Surface a non-blocking toast (reuse `Gw2Error` / `AxitoolsError`
  messages), keep showing cached local data.
- Corrupt/missing local file → treated as empty, never throws (mirrors
  `rosterStore.ts`).

## Testing

Vitest (run with `--maxWorkers=2`):

- Normalizers: GW2 log entry → `AuditEvent`; Discord event → `AuditEvent`,
  including `summary` generation per type.
- Store: dedupe by `uid`, newest-first ordering, 50k rolling cap, cursor
  persistence, corrupt-file safety.
- Sync: merge ordering and incremental cursor advance against mocked clients;
  one-source-fails-other-succeeds behavior.

## Retention

Local rolling cap of **50,000** newest events per guild (a tunable constant).
Effectively "keep everything" for any normal guild while preventing a pathological
JSON blow-up.
