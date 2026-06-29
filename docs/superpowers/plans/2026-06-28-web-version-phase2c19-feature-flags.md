# Web Version — Phase 2c-19: Web Guild Feature-Flag Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist per-guild `retentionEnabled`/`pipelineEnabled` on web via new `workspaces` columns, and fix the latent web-owner config-edit silent-fail by routing edits through a direct RLS `workspaces.update` instead of `share-keys`.

**Architecture:** Migration adds two boolean columns; `share-keys` writes them on create; `webUpsertGuild` writes config (incl. flags) via `workspaces.update` on edit; `workspace.ts` mappers read them back. Deploy (migration + function) is a controller step after merge.

**Tech Stack:** Postgres (Supabase), Deno Edge Function, TypeScript renderer, Vitest (node, pure-logic). No new deps.

## Global Constraints

- Touch ONLY: `supabase/migrations/0011_guild_feature_flags.sql` (new), `supabase/functions/share-keys/index.ts`, `src/renderer/src/lib/webClient/guilds.ts`, `src/renderer/src/lib/webClient/guilds.test.ts`, `src/renderer/src/lib/webClient/workspace.ts`, `src/renderer/src/lib/webClient/workspace.test.ts`. Do NOT touch other migrations/functions, `src/main`, `src/shared`, `src/preload`, or other renderer files.
- `webUpsertGuild` NEVER throws (keep the outer `try/catch` → `null`).
- Column names: `retention_enabled` (bool, default false), `pipeline_enabled` (bool, default true). Web read-back: `retentionEnabled: Boolean(row.retention_enabled)`, `pipelineEnabled: row.pipeline_enabled !== false`.
- Edit path must NOT call `claim-guild`; it calls `workspaces.update` always, and `share-keys` ONLY when `input.gw2ApiKey` is non-empty.
- `share-keys` must set the flag columns only when the body value is a boolean (`typeof === 'boolean'`) — no clobber when desktop omits them.
- The `roleFor` helper stays (used by the create `already_claimed` branch + `webRemoveGuild`).
- Run vitest with `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` + `npm run build:web` green. (Edge function / migration are Deno/SQL — not in the JS typecheck; verified by review + the controller deploy.)

---

### Task 1: Migration + `share-keys` flag write (backend)

**Files:**
- Create: `supabase/migrations/0011_guild_feature_flags.sql`
- Modify: `supabase/functions/share-keys/index.ts`

(No unit harness — `share-keys` is an inline Deno function with no deps/test; correctness verified by review and the controller's redeploy. Do NOT add a JS test for it.)

- [ ] **Step 1: Write the migration**

`supabase/migrations/0011_guild_feature_flags.sql`:
```sql
-- Per-guild feature flags shared across the workspace (mirrors member_role_id /
-- bridge_repos moving onto workspaces in 0007). retention_enabled gates the
-- Retention radar tab; pipeline_enabled gates the Recruitment tab (default on).
-- Read by ws_select (is_member); written by ws_update_write (can_write) — both
-- already exist. No publication change needed (workspaces already streams).
alter table workspaces
  add column if not exists retention_enabled boolean not null default false,
  add column if not exists pipeline_enabled  boolean not null default true;
```

- [ ] **Step 2: Extend `share-keys` to persist the flags**

In `supabase/functions/share-keys/index.ts`, add the two optional fields to the parsed `body` type (the `as { … }` object after `req.json()`):
```ts
    memberRoleId?: string
    bridgeRepos?: unknown
    retentionEnabled?: boolean
    pipelineEnabled?: boolean
```
Then, inside the existing `if (body.share) { … }` block, right after the `if (Array.isArray(body.bridgeRepos)) wsUpdate.bridge_repos = body.bridgeRepos` line, add:
```ts
    if (typeof body.retentionEnabled === 'boolean') wsUpdate.retention_enabled = body.retentionEnabled
    if (typeof body.pipelineEnabled === 'boolean') wsUpdate.pipeline_enabled = body.pipelineEnabled
```

- [ ] **Step 3: Sanity-check the function file**

Re-read the modified `share-keys/index.ts` and confirm: the two new body fields are typed, the two `wsUpdate` assignments are inside the `if (body.share)` block (so they ride the same owner-gated update), and nothing else changed. (If `deno` is available: `deno check supabase/functions/share-keys/index.ts` — optional; skip if Deno isn't installed.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0011_guild_feature_flags.sql supabase/functions/share-keys/index.ts
git commit -m "feat(supabase): workspaces.retention_enabled/pipeline_enabled + share-keys persists them"
```

---

### Task 2: Web read/write of the flags + fixed edit path

**Files:**
- Modify: `src/renderer/src/lib/webClient/guilds.ts` (`shareBody` + edit path), `src/renderer/src/lib/webClient/workspace.ts` (`wsRowToSummary` + `wsRowToProfile`)
- Test: `src/renderer/src/lib/webClient/guilds.test.ts`, `src/renderer/src/lib/webClient/workspace.test.ts`

**Interfaces:**
- Consumes: the `0011` columns (Task 1) and `share-keys` accepting `retentionEnabled`/`pipelineEnabled` (Task 1).

- [ ] **Step 1: Update the failing tests**

In `src/renderer/src/lib/webClient/guilds.test.ts`:

(a) The **create** test (`'create: claims then shares keys, sets active, returns summary'`) — extend the 2nd-invoke (`share-keys`) body assertion to include the flags. The `body` object currently ends with `bridgeRepos: [{ owner: 'o', repo: 'r' }]`; add:
```ts
      bridgeRepos: [{ owner: 'o', repo: 'r' }],
      retentionEnabled: false,
      pipelineEnabled: true
```

(b) Replace the two edit tests (`'edit (owner): shares keys only, no claim'` and `'edit (write): updates workspaces config, no invoke'`) with:
```ts
test('edit without key re-entry persists config via workspaces.update, no share-keys', async () => {
  const invoke = vi.fn()
  const { sb, rec } = fakeSb({ members: [{ workspace_id: 'g1', role: 'owner' }], invoke })
  const out = await webUpsertGuild(sb, settings(), baseInput({ id: 'g1', gw2ApiKey: '' }))
  expect(invoke).not.toHaveBeenCalled()
  expect(rec.wsUpdate).toEqual({
    member_role_id: 'r1',
    bridge_repos: [{ owner: 'o', repo: 'r' }],
    retention_enabled: false,
    pipeline_enabled: true
  })
  expect(rec.wsUpdateId).toBe('g1')
  expect(out?.id).toBe('g1')
})

test('edit with key re-entry also calls share-keys', async () => {
  const invoke = vi.fn(async () => ({ data: {}, error: null }))
  const { sb, rec } = fakeSb({ members: [{ workspace_id: 'g1', role: 'owner' }], invoke })
  await webUpsertGuild(sb, settings(), baseInput({ id: 'g1' })) // gw2ApiKey 'KEY-1'
  expect(rec.wsUpdate).toMatchObject({ retention_enabled: false, pipeline_enabled: true })
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(invoke.mock.calls[0][0]).toBe('share-keys')
})
```

In `src/renderer/src/lib/webClient/workspace.test.ts`, add a test after the existing `webListGuilds maps …` test (the `WS` constant has no flag columns → defaults; a populated row reflects real values):
```ts
test('webListGuilds reads retention/pipeline feature flags from the workspace row', async () => {
  const settings = createWebSettings(fakeStorage())
  const sb = fakeSb({
    memberships: [{ workspace_id: 'w1', role: 'owner' }],
    workspaces: [{ ...WS, retention_enabled: true, pipeline_enabled: false }]
  })
  const [g] = await webListGuilds(sb, settings)
  expect(g).toMatchObject({ retentionEnabled: true, pipelineEnabled: false })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/guilds.test.ts src/renderer/src/lib/webClient/workspace.test.ts`
Expected: FAIL — create body lacks the flags; the new edit tests expect `workspaces.update` with flag columns (current code calls `share-keys`); `webListGuilds` returns hardcoded `retentionEnabled:false`/`pipelineEnabled:true`.

- [ ] **Step 3: Implement the web changes**

In `src/renderer/src/lib/webClient/guilds.ts`, add the two flags to `shareBody`'s returned object (after `bridgeRepos: input.bridgeRepos`):
```ts
    bridgeRepos: input.bridgeRepos,
    retentionEnabled: input.retentionEnabled,
    pipelineEnabled: input.pipelineEnabled
```
Replace the edit branch (the block beginning `// Edit: push config by role (mirrors desktop pushSharedConfig).` through the `const active = …; return summaryFor(...)`) with:
```ts
    // Edit: persist non-secret config (incl. feature flags) directly via RLS —
    // ws_update_write permits owner+write. share-keys would demand a GW2 apiKey
    // the browser doesn't hold for an existing guild, so only call it when the
    // owner is actually (re)entering keys. (Read members' update is RLS-filtered
    // to a harmless no-op; the editor form is hidden from them.)
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
(The `roleFor` import + function stay — still used by the create `already_claimed` path.)

In `src/renderer/src/lib/webClient/workspace.ts`, replace the hardcodes in BOTH `wsRowToSummary` and `wsRowToProfile`:
```ts
    retentionEnabled: Boolean(row.retention_enabled),
    pipelineEnabled: row.pipeline_enabled !== false
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/`
Expected: PASS. If a fake chain shape is off (e.g. `workspaces.update` builder), fix the fake — not the module.

- [ ] **Step 5: Full gates**

Run: `npm test` → all pass. Run: `npm run typecheck` → clean. Run: `npm run build:web` → succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/webClient/guilds.ts src/renderer/src/lib/webClient/guilds.test.ts src/renderer/src/lib/webClient/workspace.ts src/renderer/src/lib/webClient/workspace.test.ts
git commit -m "feat(web): persist + read retention/pipeline flags; fix owner config-edit via direct workspaces.update"
```

---

## Self-Review Notes

- **Spec coverage:** columns → Task 1 Step 1. `share-keys` writes flags (create path) → Task 1 Step 2. `shareBody` carries flags → Task 2 Step 3. Edit via `workspaces.update` (fixes the apiKey silent-fail) + conditional `share-keys` → Task 2 Step 3. Read-back in both mappers → Task 2 Step 3. Tests for create body, both edit paths, and read-back → Task 2 Step 1. Deploy is a controller step (post-merge), not a task.
- **Placeholder scan:** none — migration SQL, the function delta, the edit block, the mapper lines, and all tests are complete.
- **Type consistency:** column names `retention_enabled`/`pipeline_enabled` identical across migration, share-keys, `workspaces.update`, and the mappers. `GuildSummary`/`GuildProfile` fields `retentionEnabled`/`pipelineEnabled` (booleans) unchanged. `shareBody` adds keys matching `share-keys`'s new body fields (`retentionEnabled`/`pipelineEnabled`). Edit `workspaces.update` shape matches the new edit test's `rec.wsUpdate` expectation exactly (`member_role_id, bridge_repos, retention_enabled, pipeline_enabled`).
- **No clobber / no regression:** `share-keys` guards on `typeof === 'boolean'`, so desktop's flag-less `pushSharedConfig` leaves the columns alone. Edit no longer needs the unreadable web apiKey. Create path otherwise unchanged.
