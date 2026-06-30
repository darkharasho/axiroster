# Retention Radar reliable sync + Audit log robustness — Design

**Date:** 2026-06-30
**Status:** Approved (design)
**Repos touched:** `axiroster` (desktop + web + Supabase), `../axitools` (Python Discord bot)

Two independent pieces, brainstormed together because the user raised them in one
request. They share no code and can be implemented and shipped separately.

---

## Part 1 — Retention Radar: reliable sync

### Problem

`workspaces.retention_enabled` already exists, the edit checkbox is already shared
between desktop and web and already disabled for read-only members, and the
Retention tab already only appears when the flag is on. But the flag does **not**
sync reliably:

1. A member who **adopts a shared guild on desktop never receives the flag** —
   `get-shared-keys` doesn't return `retention_enabled`, so their local
   `GuildProfile.retentionEnabled` stays `false` and the tab is missing even when
   the owner enabled it.
2. A **write-member toggling it on desktop doesn't sync** — `pushSharedConfig`'s
   non-owner branch writes only `member_role_id` + `bridge_repos` to `workspaces`,
   dropping `retention_enabled` (the same gap also drops `pipeline_enabled`).

The web side already reads the flag from the workspace row (`wsRowToProfile` /
`wsRowToSummary`) and writes it via a direct RLS `workspaces.update`
(`webClient/guilds.ts`), so it is correct once the desktop/edge gaps close.

### Scope of change

Role model is unchanged: owner + write can toggle; read-only members see it
disabled. We are only making the existing setting sync reliably everywhere.

### Changes

1. **Edge function `supabase/functions/get-shared-keys/index.ts`** — include
   `retention_enabled` and `pipeline_enabled` from the `workspaces` row in the
   JSON response (additive; no signature break).
2. **Desktop `src/main/index.ts` `adoptWorkspaceGuild`** — map the returned
   `retentionEnabled` / `pipelineEnabled` onto the upserted local profile instead
   of hardcoding `existing?.retentionEnabled ?? false` /
   `existing?.pipelineEnabled !== false`. Preserve the "don't overwrite a member's
   own non-shared profile" guard. Fold both flags into the no-op change-detection
   check so adoption still no-ops when nothing changed.
3. **Desktop `src/main/index.ts` `pushSharedConfig` (write-member branch)** — add
   `retention_enabled` and `pipeline_enabled` to the direct `workspaces.update`.
   RLS `ws_update_write` already permits owner+write, so no policy change.

### Data flow after the fix

- Owner toggles (desktop) → `share-keys` (already sets the columns) → workspace row.
- Write-member toggles (desktop) → `pushSharedConfig` direct update → workspace row.
- Write-member/owner toggles (web) → direct RLS update → workspace row (already works).
- Any member's desktop → `adoptWorkspaceGuild` (startup / 20s poll / on-adopt) reads
  the flags via `get-shared-keys` and updates the local profile → Retention tab
  appears/disappears within ~20s.
- Any member's web → reads the workspace row directly on load.

### Testing

- Edge: extend `get-shared-keys` handler test (if present) / add one asserting the
  two flags are echoed from the workspace row.
- Desktop: unit-cover the `adoptWorkspaceGuild` flag mapping and the
  `pushSharedConfig` write-branch payload where the harness allows (these live in
  `src/main/index.ts`; if not directly unit-testable, assert via the smallest
  extractable helper or document the manual verification path).
- Manual: owner enables retention on web → second account (write) sees the tab on
  desktop within ~20s without re-login; write-member toggles on desktop → owner's
  web reflects it.

---

## Part 2 — Audit log robustness (AxiTools producer + AxiRoster consumer)

### Problem

Discord audit rows render as `DISCORD (roosterothers) Channel: <#1449262177046495356>`:
- channels show as raw `<#id>` instead of `#name`,
- the actor shows as a bare `(roosterothers)`,
- most rows have **no action verb** — only rows whose `details` is a full sentence
  (e.g. "Member left the server.") read sensibly.

Root cause: AxiTools captures the Discord channel object (it has `.name`, `.id`) and
the actor's `.bot` flag, but discards them by formatting `channel.mention` (`<#id>`)
into a free-text `details` string. The AxiRoster renderer then lets `details`
*replace* the event verb, and has no channel-id→name lookup.

### Approach: additive

Add structured fields alongside the existing `details`. Already-stored rows keep
working; no backfill. The consumer prefers structured fields and falls back to
`details` (with token substitution) for old/edge events.

### Producer — AxiTools (`../axitools`, Python)

1. **Storage migration (`axitools/storage.py`)** — additive columns on
   `discord_audit_events`: `channel_id` (TEXT, snowflake-as-string, nullable),
   `channel_name` (TEXT, nullable), `actor_is_bot` (BOOLEAN/INT, nullable),
   `target_type` (TEXT: `user|role|channel|message|guild|emoji`, nullable). Old
   rows have NULLs.
2. **Audit cog (`axitools/cogs/audit.py`)** — populate the new fields at capture
   time:
   - `channel_id` / `channel_name` from the channel object the handler already
     holds (replaces relying on `<#id>` inside `details`; `details` may keep human
     extras like message content / role lists).
   - `actor_is_bot` from `entry.user.bot` (already fetched for the actor).
   - `target_type` from the event context (the handler already knows whether the
     target is a member, role, channel, message, emoji, or the guild).
   - `event_type` stays always-present (already true).
3. **API (`axitools/api/server.py` `/guilds/{id}/audit/discord`)** — return the new
   fields additively in each event object. Existing fields and `details` unchanged.
4. **Tests (`tests/`)** — add a test pinning the new API payload fields for a
   representative channel event and a member-leave event.

### Consumer — AxiRoster

1. **Types (`src/main/auditNormalize.ts`)** — extend `DiscordAuditRaw` with
   `channel_id?`, `channel_name?`, `actor_is_bot?`, `target_type?`. `normalizeDiscord`
   carries them through into the stored `raw` (the normalized `AuditEvent` already
   preserves `raw`, so no schema change to `audit_events`).
2. **Renderer `src/renderer/src/lib/auditIdentities.ts` `describeDiscord`** —
   - **Always lead with the humanized `event_type` verb** so an action always
     exists; `details`/changes become trailing context, never the whole row.
   - Resolve **actor**: roster match by `actor_id` → solid (green) identity chip;
     else cleaned `actor_name` → dashed chip. (`actor_is_bot` may add a subtle bot
     marker; not required for v1.)
   - Resolve **target** by `target_type`: `channel` → blue `#channel_name` chip;
     `user`/`role` → identity chip; others → cleaned name.
3. **`humanizeType`** — extend the verb map: `channel_create` → "created channel",
   `channel_delete` → "deleted channel", `channel_update` → "updated channel",
   plus role/emoji/guild verbs, so every captured `event_type` yields a verb.
4. **Back-compat for old rows** — build a `channelId → name` map from the Discord
   overview already fetched for the roster (add `asDiscordChannels()` in
   `src/shared/roster/adapters.ts`, thread the channels into the log view), and
   substitute leftover `<#id>` / `<@id>` tokens in any free-text `details`.
   Unresolvable ids (e.g. a deleted channel not in the overview and with no
   `channel_name`) render as a **dimmed raw id** — the approved Option 2 fallback
   (never silently drop).
5. **Tests (vitest)** — cover `describeDiscord` for: a structured channel event
   (verb + `#name` chip), an old-style row resolved via the overview map, an
   unresolvable channel (dimmed id), a roster-matched actor (green), and a
   member-leave (verb only). Cover `humanizeType` additions.

### Rendering contract (target row shape)

`time · DISCORD · <actor chip> <verb> [<target chip>] [· dim context]`

- actor chip: green if roster-matched, dashed if name-only.
- channel target: blue `#name` chip, or dimmed raw id if unresolvable.
- verb: always present, from `event_type`.

---

## Decomposition / sequencing

Two independent implementation streams; Part 2 has an internal producer→consumer
order:

1. **Part 1** — Retention sync (edge + desktop). Smallest; ships on its own.
2. **Part 2a** — AxiTools producer (migration + cog + API + tests).
3. **Part 2b** — AxiRoster consumer (types + renderer + back-compat + tests),
   against the Part 2a contract. The back-compat path means 2b also improves old
   rows even before 2a is deployed.

## Non-goals (YAGNI)

- No change to the roster role model or RLS policies.
- No structured before/after "changes" object in v1 (keep change details in
  `details` text; revisit only if a row type needs it).
- No backfill of historical audit rows on either side.
- No `audit_events` (AxiRoster local) schema change — new fields ride in `raw`.
