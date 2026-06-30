# Retention Radar Reliable Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing `workspaces.retention_enabled` (and `pipeline_enabled`) feature flag sync reliably to every member's desktop and web, changeable by owner+write.

**Architecture:** The column, edit UI, role-gating, and tab-visibility already exist. Close three wiring gaps: (1) the `get-shared-keys` edge function omits the flags, (2) desktop `adoptWorkspaceGuild` hardcodes them instead of reading the workspace value, (3) desktop `pushSharedConfig`'s write-member branch drops them. Web already reads/writes them correctly.

**Tech Stack:** TypeScript, Electron main, Supabase JS + Deno edge functions, vitest.

## Global Constraints

- Vitest runs with `--pool=forks --poolOptions.forks.maxForks=2` (see `package.json` `test` script). Never raise parallelism.
- Role model is UNCHANGED: owner+write can toggle; read-only members see the toggle disabled. Do not add/alter RLS policies — `ws_update_write` already permits `can_write`.
- `pipeline_enabled` defaults to **true** (opt-out); `retention_enabled` defaults to **false** (opt-in). Preserve these defaults everywhere.
- Flag keys are camelCase on the wire from edge functions (`retentionEnabled`, `pipelineEnabled`) and snake_case in Postgres (`retention_enabled`, `pipeline_enabled`).

---

### Task 1: `get-shared-keys` returns the feature flags

**Files:**
- Modify: `supabase/functions/get-shared-keys/index.ts`

**Interfaces:**
- Produces: the edge function's JSON response gains `retentionEnabled: boolean` and `pipelineEnabled: boolean`, derived from the `workspaces` row.

- [ ] **Step 1: Add the columns to the workspaces select**

In `supabase/functions/get-shared-keys/index.ts`, change the workspaces query to also select the two flag columns:

```ts
  const { data: ws } = await db
    .from('workspaces')
    .select('guild_name, discord_guild_id, discord_guild_name, member_role_id, bridge_repos, retention_enabled, pipeline_enabled')
    .eq('workspace_id', body.guildId)
    .maybeSingle()
```

- [ ] **Step 2: Add the flags to the JSON response**

In the same file, extend the returned object (the `return json({ ... })` block) with the two flags, preserving the opt-in/opt-out defaults:

```ts
    memberRoleId: ws?.member_role_id ?? '',
    bridgeRepos: Array.isArray(ws?.bridge_repos) ? ws.bridge_repos : [],
    retentionEnabled: Boolean(ws?.retention_enabled),
    pipelineEnabled: ws?.pipeline_enabled !== false
  })
```

- [ ] **Step 3: Typecheck the edge function compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/axiroster && npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0 (edge functions are Deno but this confirms the repo still typechecks; the file has no repo-side type deps).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/get-shared-keys/index.ts
git commit -m "feat(supabase): get-shared-keys returns retention/pipeline flags"
```

---

### Task 2: Pure flag-merge helper + desktop adoption uses it

**Files:**
- Create: `src/main/sharedFlags.ts`
- Create: `src/main/sharedFlags.test.ts`
- Modify: `src/main/index.ts` (`adoptWorkspaceGuild`, ~lines 365–446)

**Interfaces:**
- Produces: `mergeSharedFlags(shared, existing) => { retentionEnabled: boolean; pipelineEnabled: boolean }` where `shared` is the (possibly partial) get-shared-keys response and `existing` is the current local profile (or undefined). The workspace value wins; if the workspace didn't send a flag, fall back to the existing local value, then the type default.
- Consumes (in index.ts): the `get-shared-keys` response `r` now carries `retentionEnabled?: boolean` and `pipelineEnabled?: boolean` (from Task 1).

- [ ] **Step 1: Write the failing test**

Create `src/main/sharedFlags.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mergeSharedFlags } from './sharedFlags'

describe('mergeSharedFlags', () => {
  it('takes the workspace value when present', () => {
    expect(mergeSharedFlags({ retentionEnabled: true, pipelineEnabled: false }, undefined)).toEqual({
      retentionEnabled: true,
      pipelineEnabled: false
    })
  })

  it('defaults retention=false and pipeline=true when nothing is provided', () => {
    expect(mergeSharedFlags({}, undefined)).toEqual({ retentionEnabled: false, pipelineEnabled: true })
  })

  it('falls back to the existing local profile when the workspace omits a flag', () => {
    expect(
      mergeSharedFlags({}, { retentionEnabled: true, pipelineEnabled: false })
    ).toEqual({ retentionEnabled: true, pipelineEnabled: false })
  })

  it('workspace value overrides the existing local value', () => {
    expect(
      mergeSharedFlags({ retentionEnabled: false, pipelineEnabled: true }, { retentionEnabled: true, pipelineEnabled: false })
    ).toEqual({ retentionEnabled: false, pipelineEnabled: true })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/sharedFlags.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — `Cannot find module './sharedFlags'`.

- [ ] **Step 3: Implement the helper**

Create `src/main/sharedFlags.ts`:

```ts
// src/main/sharedFlags.ts
// Resolve the synced feature flags (retention/pipeline) for a member adopting a
// shared guild. The workspace value (from get-shared-keys) is authoritative; if it
// omits a flag we keep the existing local value, then fall back to the type default
// (retention opt-in => false, pipeline opt-out => true).

export interface SharedFlagSource {
  retentionEnabled?: boolean | null
  pipelineEnabled?: boolean | null
}

export interface ResolvedFlags {
  retentionEnabled: boolean
  pipelineEnabled: boolean
}

export function mergeSharedFlags(shared: SharedFlagSource, existing?: SharedFlagSource): ResolvedFlags {
  const retentionEnabled =
    typeof shared.retentionEnabled === 'boolean'
      ? shared.retentionEnabled
      : typeof existing?.retentionEnabled === 'boolean'
        ? existing.retentionEnabled
        : false
  const pipelineEnabled =
    typeof shared.pipelineEnabled === 'boolean'
      ? shared.pipelineEnabled
      : typeof existing?.pipelineEnabled === 'boolean'
        ? existing.pipelineEnabled
        : true
  return { retentionEnabled, pipelineEnabled }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/sharedFlags.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the helper into `adoptWorkspaceGuild`**

In `src/main/index.ts`:

1. Add the import near the other `src/main` imports at the top of the file:

```ts
import { mergeSharedFlags } from './sharedFlags'
```

2. Extend the `r` response type inside `adoptWorkspaceGuild` (the `const r = data as { ... }` cast) to include the two flags:

```ts
    const r = data as {
      apiKey?: string | null
      axitoolsKey?: string | null
      axitoolsShared?: boolean
      gw2GuildName?: string
      discordGuildId?: string
      discordGuildName?: string
      memberRoleId?: string
      bridgeRepos?: { owner: string; repo: string }[]
      retentionEnabled?: boolean
      pipelineEnabled?: boolean
    } | null
    if (!r) return false
```

3. Just before the no-op change-detection `if (existing && ...)` block, compute the resolved flags:

```ts
    const flags = mergeSharedFlags(
      { retentionEnabled: r.retentionEnabled, pipelineEnabled: r.pipelineEnabled },
      existing
    )
```

4. Add the two flags to the no-op change-detection condition so a flag-only change still re-upserts. The block currently ends with `JSON.stringify(existing.bridgeRepos) === reposKey`. Change that block to:

```ts
    if (
      existing &&
      existing.gw2ApiKey === apiKey &&
      existing.gw2GuildName === gw2GuildName &&
      existing.axitoolsShared === axitoolsShared &&
      (!axitoolsShared || existing.axitoolsKey === axitoolsKey) &&
      existing.memberRoleId === memberRoleId &&
      JSON.stringify(existing.bridgeRepos) === reposKey &&
      existing.retentionEnabled === flags.retentionEnabled &&
      existing.pipelineEnabled === flags.pipelineEnabled
    ) {
      return false
    }
```

5. In the `guilds.upsert({ ... })` call, replace the two hardcoded flag lines:

```ts
      retentionEnabled: existing?.retentionEnabled ?? false,
      pipelineEnabled: existing?.pipelineEnabled !== false
```

with:

```ts
      retentionEnabled: flags.retentionEnabled,
      pipelineEnabled: flags.pipelineEnabled
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/main/sharedFlags.ts src/main/sharedFlags.test.ts src/main/index.ts
git commit -m "feat(desktop): adopt synced retention/pipeline flags on shared guilds"
```

---

### Task 3: Desktop write-member sync persists the flags

**Files:**
- Modify: `src/main/index.ts` (`pushSharedConfig`, write-member branch ~lines 504–510)

**Interfaces:**
- Consumes: `guilds.active()` profile (already has `retentionEnabled`/`pipelineEnabled`).
- Produces: the non-owner `workspaces.update` now writes `retention_enabled` + `pipeline_enabled`.

- [ ] **Step 1: Extend the write-member update**

In `src/main/index.ts`, in `pushSharedConfig`, replace the `else if (ws.role === 'write')` branch body:

```ts
  } else if (ws.role === 'write') {
    await client
      .from('workspaces')
      .update({
        member_role_id: guild.memberRoleId,
        bridge_repos: guild.bridgeRepos,
        retention_enabled: guild.retentionEnabled ?? false,
        pipeline_enabled: guild.pipelineEnabled !== false
      })
      .eq('workspace_id', guildId)
      .then(undefined, () => {})
  }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "fix(desktop): write-members sync retention/pipeline flags to workspace"
```

---

### Task 4: Full verification + web confirmation

**Files:** none (verification only).

- [ ] **Step 1: Run the full typecheck + test suite**

Run:
```bash
npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json
npx vitest run --pool=forks --poolOptions.forks.maxForks=2
```
Expected: both typechecks exit 0; all tests pass (prior 302 + the 4 new `sharedFlags` tests).

- [ ] **Step 2: Confirm the web path needs no change**

Read `src/renderer/src/lib/webClient/workspace.ts` (`wsRowToProfile` / `wsRowToSummary`) and `src/renderer/src/lib/webClient/guilds.ts` (the edit branch `sb.from('workspaces').update({... retention_enabled ...})`). Confirm web already reads `retention_enabled` from the workspace row and writes it via RLS for owner+write. No code change expected; if either is missing the flag, add it mirroring the desktop change and note it here.

- [ ] **Step 3: Manual integration matrix (document results in the PR)**

Verify, signed in as two accounts on one workspace:
1. Owner enables Retention on **web** → a **write** member's **desktop** shows the Retention tab within ~20s (the `watchMembership` poll → `adoptAllMemberships` → `get-shared-keys`) without re-login.
2. A **write** member toggles Retention on **desktop** → the **owner's web** reflects the change on reload.
3. A **read-only** member sees the toggle disabled and the tab follows the workspace flag.

- [ ] **Step 4: No commit** (verification task). If Step 2 required a web edit, it was committed there.

---

## Notes for the executor

- `adoptAllMemberships`, `watchMembership`, and `initSync` already call `adoptWorkspaceGuild`, so once Task 2 lands the flag propagates on startup and on the 20s poll automatically — no scheduler changes needed.
- Do not introduce a backfill; existing adopted profiles update on the next adopt cycle.
