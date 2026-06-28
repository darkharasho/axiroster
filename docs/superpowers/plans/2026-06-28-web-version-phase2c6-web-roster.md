# Web Version — Phase 2c-6: Web Roster — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `buildRoster()` + `refreshRoster()` for the web client — pre-fetch the workspace + synced members + annotations + links from Supabase, feed them into the shared `assembleRoster`, with Discord via the `axitools` Edge Function and GW2 from the synced `roster_members` table. Mock-tested.

**Architecture:** A new `roster.ts` module builds a `RosterAssemblyDeps` (sync local accessors over pre-fetched Supabase rows + async Discord-via-function) and calls the shared `assembleRoster`. `webClient.ts` wires the two methods.

**Tech Stack:** TypeScript, React renderer, Vitest, `@supabase/supabase-js`. No new dependencies.

## Global Constraints

- Changes confined to `src/renderer/src/lib/webClient/` (one new module + tests + edits to `webClient.ts`/`webClient.test.ts`). Do NOT touch `src/main`, `src/shared`, `src/preload`, the rest of the renderer, or the `AxiClient` contract.
- `createWebClient` stays a conformant `AxiClient`; only `buildRoster`/`refreshRoster` change from `ni(...)`.
- `buildRoster` returns `Result<RosterPayload>` and never throws (catches into `fail`). `refreshRoster` returns `RosterRefreshResult` and MAY throw (mirrors desktop) — incl. "Supabase client not configured" / "No active workspace".
- Renderer→shared imports use `../../../../shared/…`; preload via `../../../../preload/index.d`.
- Node test env: fake `SupabaseClient` (cast `as unknown as SupabaseClient`); `bridge_repos: []` in tests so `AxibridgeClient` is never called (no network).
- Tests: Vitest `--pool=forks --poolOptions.forks.maxForks=2`. `npm test` + `npm run typecheck` green.

---

### Task 1: `roster.ts` (buildRoster + refreshRoster) + wiring

**Files:**
- Create: `src/renderer/src/lib/webClient/roster.ts`, `.../roster.test.ts`
- Modify: `src/renderer/src/lib/webClient/webClient.ts` (+ `webClient.test.ts`)

**Interfaces:**
- Consumes: `invokeAxitools`/`activeWorkspaceId` (`./discordGw2`); `assembleRoster`/`RosterAssemblyDeps`/`GuildMeta`/`RosterPayload` (`../../../../shared/roster/assembleRoster`); `InGameMemberRaw`/`ManualLinkRaw`/`AnnotationRaw`/`isReservedAnnotationKey` (`../../../../shared/rosterReconcile`); `AxibridgeClient`/`RepoRef` (`../../../../shared/axibridgeClient`); `Result`/`RosterRefreshResult` (`../../../../preload/index.d`); `WebSettings` (`./settings`).
- Produces: `webBuildRoster(sb, settings)`, `webRefreshRoster(sb, settings)`.

- [ ] **Step 1: Write the failing test**

`src/renderer/src/lib/webClient/roster.test.ts`:
```ts
import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { webBuildRoster, webRefreshRoster } from './roster'
import { createWebSettings } from './settings'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size
    }
  } as Storage
}

// A thenable that also exposes maybeSingle(), covering both `await eq(...)` and
// `eq(...).maybeSingle()` chains.
function tableResult(data: unknown): Promise<{ data: unknown }> & { maybeSingle: () => Promise<{ data: unknown }> } {
  const p = Promise.resolve({ data }) as Promise<{ data: unknown }> & {
    maybeSingle: () => Promise<{ data: unknown }>
  }
  p.maybeSingle = () => Promise.resolve({ data })
  return p
}

function fakeSb(
  tables: Record<string, unknown>,
  invoke: ReturnType<typeof vi.fn>,
  userId: string | null = 'u1'
): SupabaseClient {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: (t: string) => ({
      select: () => ({
        eq: () =>
          t === 'workspace_members'
            ? tableResult([{ workspace_id: 'w1', role: 'owner' }])
            : tableResult(tables[t])
      })
    }),
    functions: { invoke }
  } as unknown as SupabaseClient
}

test('webBuildRoster reconciles synced members + annotations into a payload', async () => {
  const tables = {
    workspaces: {
      workspace_id: 'w1',
      guild_name: 'My Guild',
      discord_guild_id: 'd1',
      member_role_id: 'role1',
      bridge_repos: []
    },
    roster_members: [{ member_id: 'Alice.1', payload: { name: 'Alice.1', rank: 'Member', joined: null } }],
    roster_links: [],
    roster_annotations: [
      { member_id: 'acct:Alice.1', nickname: 'Ally', aliases: [], notes: '', tags: ['core'], main_account: '' }
    ]
  }
  const invoke = vi.fn(async (fn: string, opts: { body: { op?: string } }) => {
    if (fn === 'axitools' && opts.body.op === 'discordOverview')
      return { data: { data: { members: [], roles: [] } }, error: null }
    return { data: { data: [] }, error: null }
  })
  const r = await webBuildRoster(fakeSb(tables, invoke), createWebSettings(fakeStorage()))
  expect(r.ok).toBe(true)
  if (r.ok) {
    expect(r.data.members.length).toBeGreaterThan(0)
    expect(r.data.sources.gw2.count).toBe(1)
  }
})

test('a Discord invoke failure still returns the roster with a warning', async () => {
  const tables = {
    workspaces: { workspace_id: 'w1', discord_guild_id: 'd1', guild_name: 'G', bridge_repos: [] },
    roster_members: [{ member_id: 'A.1', payload: { name: 'A.1' } }],
    roster_links: [],
    roster_annotations: []
  }
  const invoke = vi.fn(async (fn: string) =>
    fn === 'axitools' ? { data: null, error: { message: 'bot down' } } : { data: { count: 0 }, error: null }
  )
  const r = await webBuildRoster(fakeSb(tables, invoke), createWebSettings(fakeStorage()))
  expect(r.ok).toBe(true)
  if (r.ok) expect(r.data.warnings.some((w) => /Discord/i.test(w))).toBe(true)
})

test('webBuildRoster with no active workspace fails', async () => {
  const r = await webBuildRoster(fakeSb({}, vi.fn(), null), createWebSettings(fakeStorage()))
  expect(r.ok).toBe(false)
})

test('webRefreshRoster invokes refresh-roster and returns count', async () => {
  const invoke = vi.fn(async () => ({ data: { count: 7 }, error: null }))
  const r = await webRefreshRoster(fakeSb({}, invoke), createWebSettings(fakeStorage()))
  expect(r).toEqual({ count: 7 })
  expect(invoke).toHaveBeenCalledWith('refresh-roster', { body: { guildId: 'w1' } })
})

test('webRefreshRoster without active workspace throws', async () => {
  await expect(
    webRefreshRoster(fakeSb({}, vi.fn(), null), createWebSettings(fakeStorage()))
  ).rejects.toThrow(/active workspace/i)
})
```

- [ ] **Step 2: Run — expect FAIL (missing module)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/roster.test.ts`
Expected: FAIL — cannot find `./roster`.

- [ ] **Step 3: Implement `roster.ts`**

```ts
// src/renderer/src/lib/webClient/roster.ts
// Web roster: pre-fetch the workspace + synced members + annotations + links from
// Supabase, then feed the shared assembleRoster (which applies the adapters and
// reconcile). Discord comes from the axitools Edge Function; GW2 from the synced
// roster_members table (no client-side live pull). All best-effort sources degrade
// to warnings inside assembleRoster.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Result, RosterRefreshResult } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { invokeAxitools, activeWorkspaceId } from './discordGw2'
import {
  assembleRoster,
  type RosterAssemblyDeps,
  type GuildMeta,
  type RosterPayload
} from '../../../../shared/roster/assembleRoster'
import {
  isReservedAnnotationKey,
  type InGameMemberRaw,
  type ManualLinkRaw,
  type AnnotationRaw
} from '../../../../shared/rosterReconcile'
import { AxibridgeClient, type RepoRef } from '../../../../shared/axibridgeClient'

const ok = <T>(data: T): Result<T> => ({ ok: true, data })
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

function unwrap(r: Result<unknown>): unknown {
  if (!r.ok) throw new Error(r.error)
  return r.data
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

function wsRowToGuildMeta(row: Record<string, unknown> | null): GuildMeta {
  const repos = Array.isArray(row?.bridge_repos) ? (row!.bridge_repos as RepoRef[]) : []
  return {
    discordGuildId: str(row?.discord_guild_id),
    discordGuildName: str(row?.discord_guild_name),
    gw2GuildId: str(row?.workspace_id),
    gw2GuildName: str(row?.guild_name),
    // attempt the Discord source when a server is configured; the function reports
    // no_key if the workspace has no AxiTools key (web can't read workspace_secrets)
    hasAxitoolsKey: Boolean(row?.discord_guild_id),
    // web uses the synced roster source — never a client-side live GW2 pull
    hasGw2Key: false,
    memberRoleId: str(row?.member_role_id),
    bridgeRepos: repos,
    retentionEnabled: false
  }
}

function syncedFromRows(rows: Record<string, unknown>[]): InGameMemberRaw[] {
  return rows
    .map((r) => {
      const p = (r.payload ?? {}) as Record<string, unknown>
      return {
        name: typeof p.name === 'string' ? p.name : '',
        rank: typeof p.rank === 'string' ? p.rank : undefined,
        joined: typeof p.joined === 'string' ? p.joined : undefined
      }
    })
    .filter((m) => m.name)
}

function linksFromRows(rows: Record<string, unknown>[]): ManualLinkRaw[] {
  return rows.map((r) => ({ accountName: String(r.account_name), memberId: String(r.member_id) }))
}

function annsFromRows(rows: Record<string, unknown>[]): AnnotationRaw[] {
  return rows
    .map((r) => ({
      memberId: String(r.member_id),
      nickname: typeof r.nickname === 'string' ? r.nickname : '',
      aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [],
      notes: typeof r.notes === 'string' ? r.notes : '',
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
      mainAccount: typeof r.main_account === 'string' ? r.main_account : ''
    }))
    .filter((a) => !isReservedAnnotationKey(a.memberId))
}

export async function webBuildRoster(
  sb: SupabaseClient,
  settings: WebSettings
): Promise<Result<RosterPayload>> {
  try {
    const wsId = await activeWorkspaceId(sb, settings)
    if (!wsId) return fail('No active workspace')
    const [wsRes, memRes, linkRes, annRes] = await Promise.all([
      sb.from('workspaces').select('*').eq('workspace_id', wsId).maybeSingle(),
      sb.from('roster_members').select('member_id, payload').eq('workspace_id', wsId),
      sb.from('roster_links').select('account_name, member_id').eq('workspace_id', wsId),
      sb.from('roster_annotations').select('*').eq('workspace_id', wsId)
    ])
    const guild = wsRowToGuildMeta((wsRes.data ?? null) as Record<string, unknown> | null)
    const members = (memRes.data ?? []) as Record<string, unknown>[]
    const links = (linkRes.data ?? []) as Record<string, unknown>[]
    const anns = (annRes.data ?? []) as Record<string, unknown>[]
    const deps: RosterAssemblyDeps = {
      activeGuild: () => guild,
      membersLinked: async (gid) =>
        unwrap(await invokeAxitools(sb, { op: 'membersLinked', workspaceId: wsId, guildId: gid })),
      discordOverview: async (gid) =>
        unwrap(
          await invokeAxitools(sb, {
            op: 'discordOverview',
            workspaceId: wsId,
            guildId: gid,
            includeMembers: true
          })
        ),
      inGameMembers: async () => [],
      guildRanks: async () => [],
      syncedMembers: () => syncedFromRows(members),
      manualLinks: () => linksFromRows(links),
      annotations: () => annsFromRows(anns),
      bridgeMetrics: async (repos) => new AxibridgeClient(repos).playerMetrics(),
      attendance: async (repos) => new AxibridgeClient(repos).attendanceRaids()
    }
    return ok(await assembleRoster(deps))
  } catch (e) {
    return fail((e as Error).message)
  }
}

export async function webRefreshRoster(
  sb: SupabaseClient,
  settings: WebSettings
): Promise<RosterRefreshResult> {
  const wsId = await activeWorkspaceId(sb, settings)
  if (!wsId) throw new Error('No active workspace')
  const { data, error } = await sb.functions.invoke('refresh-roster', { body: { guildId: wsId } })
  if (error) throw error
  return { count: (data as { count?: number } | null)?.count ?? 0 }
}
```

- [ ] **Step 4: Run — expect PASS (5 tests)**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/roster.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `buildRoster` + `refreshRoster` in `webClient.ts`**

1. Add import: `import { webBuildRoster, webRefreshRoster } from './roster'`.
2. Replace `buildRoster: ni('buildRoster'),` with:
   ```ts
   buildRoster: () => withSb((sb) => webBuildRoster(sb, settings)),
   ```
3. Replace `refreshRoster: ni('refreshRoster'),` with:
   ```ts
   refreshRoster: async () => {
     if (!deps.supabase) throw new Error('Supabase client not configured')
     return webRefreshRoster(deps.supabase, settings)
   },
   ```
   Leave every other `ni(...)` method unchanged.

- [ ] **Step 6: Add `webClient.test.ts` smoke cases**

```ts
test('buildRoster returns a Result via an injected supabase', async () => {
  const sb = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => ({
      select: () => ({
        eq: () => {
          const data = t === 'workspace_members' ? [{ workspace_id: 'w1', role: 'owner' }]
            : t === 'workspaces' ? { workspace_id: 'w1', bridge_repos: [] }
            : []
          const p = Promise.resolve({ data }) as Promise<{ data: unknown }> & { maybeSingle: () => Promise<{ data: unknown }> }
          p.maybeSingle = () => Promise.resolve({ data })
          return p
        }
      })
    }),
    functions: { invoke: async () => ({ data: { data: { members: [], roles: [] } }, error: null }) }
  } as unknown as import('@supabase/supabase-js').SupabaseClient
  expect((await createWebClient({ storage: fakeStorage(), supabase: sb }).buildRoster()).ok).toBe(true)
})

test('buildRoster without supabase returns a failed Result', async () => {
  expect((await createWebClient({ storage: fakeStorage() }).buildRoster()).ok).toBe(false)
})
```

- [ ] **Step 7: Run web-client suite + full suite + typecheck**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/webClient/`
Expected: PASS.

Run: `npm test` → all pass. Run: `npm run typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/lib/webClient
git commit -m "feat(web): roster — buildRoster via shared assembleRoster + refreshRoster"
```

---

## Self-Review Notes

- **Spec coverage:** `webBuildRoster` pre-fetches workspace/members/links/annotations, builds `GuildMeta` (synced source: `hasGw2Key=false`) + the deps, calls shared `assembleRoster` (Step 3); `webRefreshRoster` invokes `refresh-roster` (Step 3); `webClient.ts` wires both (Step 5); tests cover reconciliation, the Discord-failure warning path, no-workspace, refresh count, and refresh-no-workspace-throws (Step 1). Other data methods stay `ni(...)`; `src/main`/`src/shared`/`src/preload` untouched.
- **Sync vs async deps:** the four Supabase reads happen up-front (`Promise.all`), so the assembler's synchronous `syncedMembers`/`manualLinks`/`annotations` accessors return already-fetched arrays; `membersLinked`/`discordOverview`/`bridgeMetrics`/`attendance` stay async. `membersLinked`/`discordOverview` `unwrap` the Result (throw on failure) so the assembler's Discord try/catch produces the warning.
- **Type consistency:** `buildRoster` returns `Result<RosterPayload>`; `refreshRoster` returns `RosterRefreshResult` — matching `AxiRosterApi`. `GuildMeta`/`RosterAssemblyDeps` come from the shared `assembleRoster`; reconcile raw types + `isReservedAnnotationKey` from shared `rosterReconcile`; `AxibridgeClient`/`RepoRef` from shared `axibridgeClient`.
- **No network in tests:** `bridge_repos: []` → the assembler never constructs `AxibridgeClient`; Discord/refresh use the fake `functions.invoke`.
- **Flagged for real-run:** `hasGw2Key=false` makes the `gw2Source` banner read "No GW2 API key" on web though the roster is correct (from sync); `AxibridgeClient` browser-direct relies on GitHub-raw CORS. Both verified on a live run.
