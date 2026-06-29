# Web Version — Phase 2c-19: Web Guild Feature-Flag Persistence

**Date:** 2026-06-28 · **Status:** Approved (autonomous sensible-defaults run)

## Goal
Make the per-guild **Retention** and **Recruitment** toggles persist on web (audit
#4), and fix the latent bug the same investigation surfaced: **a web owner's guild
config edits silently fail today** because the 2c-16 edit path routes through
`share-keys`, which mandates a GW2 `apiKey` the browser doesn't hold for an
existing guild.

## Two problems, one slice
1. **Flags don't persist** — `retentionEnabled`/`pipelineEnabled` live only in the
   desktop's local `guildStore`; web hardcodes `false`/`true` in `wsRowToSummary`/
   `wsRowToProfile`. So an owner ticking "Enable Retention radar" sees "Settings
   saved" but the Retention tab never appears (gated on `selected.retentionEnabled`)
   and the value resets on reload; Recruitment can't be disabled.
2. **Owner config edits silently fail** — `wsRowToProfile` sets `gw2ApiKey: ''`
   (keys aren't readable on web), so on an edit `buildInput().gw2ApiKey === ''`.
   The 2c-16 edit path (`role === 'owner'` → `share-keys`) hits `share-keys`'s
   `if (!body.apiKey) return { error: 'apiKey required' }`, and `webUpsertGuild`'s
   `.catch(() => {})` swallows it — member role / bridge repos / flags never save.

## Fix

### Migration `0011_guild_feature_flags.sql`
```sql
-- Per-guild feature flags shared across the workspace (mirrors how member_role_id
-- / bridge_repos moved onto workspaces in 0007). retention gates the Retention
-- radar tab; pipeline gates the Recruitment tab (default on).
alter table workspaces
  add column if not exists retention_enabled boolean not null default false,
  add column if not exists pipeline_enabled  boolean not null default true;
```
No new RLS needed: `ws_select` (is_member) reads them; `ws_update_write`
(can_write) updates them — both already exist (0002/0007). `workspaces` is already
in the realtime publication (0006); adding columns needs no publication change.

### `share-keys` Edge Function (`supabase/functions/share-keys/index.ts`)
Extend the body type with `retentionEnabled?: boolean; pipelineEnabled?: boolean`
and, inside the existing `if (body.share)` `wsUpdate` block, set them when present:
```ts
if (typeof body.retentionEnabled === 'boolean') wsUpdate.retention_enabled = body.retentionEnabled
if (typeof body.pipelineEnabled === 'boolean') wsUpdate.pipeline_enabled = body.pipelineEnabled
```
This carries the flags on the **create** path (which always re-shares with a key).
Desktop's `pushSharedConfig` never sends them → the `typeof === 'boolean'` guard
leaves the columns untouched there (no clobber). Owner-only (already gated).

### `webUpsertGuild` (`src/renderer/src/lib/webClient/guilds.ts`)
- **`shareBody`** gains `retentionEnabled: input.retentionEnabled` and
  `pipelineEnabled: input.pipelineEnabled` (used by create + key-reentry).
- **Edit path** (`input.id` present) — replace the broken owner→share-keys /
  write→workspaces.update role-branch with a single direct RLS update that works
  for owner **and** write (read members' update is RLS-filtered to a harmless
  no-op; the editor form is hidden from them anyway), plus a `share-keys` call
  ONLY when the owner is actually (re)entering a key:
  ```ts
  // Persist non-secret config (incl. feature flags) directly via RLS. share-keys
  // would demand a GW2 apiKey the browser doesn't hold for an existing guild, so
  // only call it when the owner is (re)entering keys.
  await sb
    .from('workspaces')
    .update({
      member_role_id: input.memberRoleId,
      bridge_repos: input.bridgeRepos,
      retention_enabled: input.retentionEnabled ?? false,
      pipeline_enabled: input.pipelineEnabled !== false
    })
    .eq('workspace_id', ws)
  if (input.gw2ApiKey) {
    await sb.functions.invoke('share-keys', { body: shareBody(input, ws) }).catch(() => {})
  }
  const active = settings.get('activeGuildId') === ws
  return summaryFor(input, ws, active)
  ```
  The `roleFor` import/helper stays (still used by the create `already_claimed`
  check and by `webRemoveGuild`).
- **Create path** unchanged except `shareBody` now also persists the initial flag
  state (the user's toggles at creation time).

### Read-back (`src/renderer/src/lib/webClient/workspace.ts`)
Replace the hardcodes in both mappers:
- `wsRowToSummary`: `retentionEnabled: Boolean(row.retention_enabled),
  pipelineEnabled: row.pipeline_enabled !== false`.
- `wsRowToProfile`: same two lines.
(`!== false` keeps pre-migration/undefined rows defaulting Recruitment on.)

## Deploy (applied as part of this slice — user authorized)
1. `supabase db push` → applies `0011` to the live remote.
2. `supabase functions deploy share-keys --use-api` → redeploys the function.
Until both land, the web read-back returns the column default (false/true) and the
flags don't persist — additive, no breakage.

## Testing
Vitest (node), fakes only.
- `guilds.test.ts`:
  - **create**: the `share-keys` (2nd invoke) body assertion gains
    `retentionEnabled: false, pipelineEnabled: true` (from `baseInput`).
  - **edit, no key re-entry** (`baseInput({ id:'g1', gw2ApiKey:'' })`): asserts
    `workspaces.update` called with `{ member_role_id, bridge_repos,
    retention_enabled, pipeline_enabled }` and **no** `share-keys` invoke.
  - **edit, owner re-enters key** (`baseInput({ id:'g1' })`, key `'KEY-1'`):
    asserts `workspaces.update` recorded AND `share-keys` invoked.
  - The old "edit (owner): shares keys only" and "edit (write): updates workspaces
    config, no invoke" tests are replaced by the two above.
- `workspace.test.ts`: a `workspaces` row with `retention_enabled:true,
  pipeline_enabled:false` → summary `retentionEnabled:true, pipelineEnabled:false`;
  a row omitting them → `false`/`true`. (Update the existing summary test's
  expected object accordingly.)
- `share-keys` has no unit harness (inline `index.ts`); its change is covered by
  the redeploy + the create-path integration. [FLAG]
- Full suite (`--pool=forks --poolOptions.forks.maxForks=2`) + `npm run typecheck`
  + `npm run build:web` green.

## Out of scope
- Web invite-code onboarding (audit #6/#7 — separate designed slice).
- `hasAxitoolsKey` heuristic; owner-side guild deletion; realtime push.
- Desktop sending these flags through `share-keys` (desktop persists them locally;
  the no-clobber guard keeps web and desktop independent).
