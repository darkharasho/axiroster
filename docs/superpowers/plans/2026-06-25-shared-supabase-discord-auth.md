# Shared Supabase + Discord Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move AxiRoster from per-guild self-hosted Supabase to one maintainer-owned Supabase instance where guilds are claimed by a GW2 leader, members sign in with Discord, and access is owner-managed with read/write roles — all enforced by RLS.

**Architecture:** Discord OAuth (Supabase Auth) provides the identity `auth.uid()`; a GW2 *leader* API key proves guild leadership server-side (only a leader's key can read `/v2/guild/:id/members`). Three Edge Functions (`claim-guild`, `refresh-roster`, `redeem-invite`) run privileged logic with the service role; everything else goes through RLS keyed on `workspace_members`. The Electron client keeps its local-first `SyncProvider` seam — only `supabaseSync.ts`, a new auth module, and the Settings UI change.

**Tech Stack:** Supabase (Postgres + Realtime + Edge Functions/Deno), `@supabase/supabase-js` v2, Electron + React + Tailwind, Vitest for tests, Supabase CLI for local DB + migrations.

## Global Constraints

- Vitest parallelism capped: run with `--pool=forks --poolOptions.forks.maxForks=2` (machine runs heavy apps alongside dev).
- `workspace_id` is ALWAYS the GW2 guild id (UUID form `^[0-9a-f]{8}-`). Never a user-chosen string.
- Roles are exactly `'owner' | 'write' | 'read'`. `owner` is the claiming leader and is the SOLE role that can manage members, the leader key, and guild config.
- The GW2 leader key is NEVER returned to a client. Child apps learn only `workspaces.has_leader_key` (boolean). The key is decrypted only inside Edge Functions.
- The anon key + project URL ship in the build as `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (renderer) and equivalents passed to main. RLS — not key secrecy — is the security boundary.
- Edge Function business logic lives in pure, dependency-injected modules under `supabase/functions/_shared/` so it is Vitest-testable without a Deno runtime; the Deno handler is a thin wiring layer.
- Conflict policy stays last-write-wins on `updated_at`. No CRDT.
- Self-host config (manual URL/anon key/workspace id) is removed. `LocalSyncProvider` remains as the no-session offline default.

---

## File Structure

**Created:**
- `vitest.config.ts` — test runner config (forks, maxForks=2).
- `supabase/config.toml` — Supabase CLI project config (via `supabase init`).
- `supabase/migrations/0001_workspaces_schema.sql` — tables.
- `supabase/migrations/0002_rls_policies.sql` — RLS.
- `supabase/functions/_shared/gw2.ts` — `verifyLeaderKey(fetchFn, apiKey, guildId)`.
- `supabase/functions/_shared/claim.ts` — `decideClaim(...)` pure logic.
- `supabase/functions/_shared/invite.ts` — `matchInvite(...)` pure logic.
- `supabase/functions/_shared/crypto.ts` — `encryptKey/decryptKey` (AES-GCM).
- `supabase/functions/claim-guild/index.ts` — Deno handler.
- `supabase/functions/refresh-roster/index.ts` — Deno handler.
- `supabase/functions/redeem-invite/index.ts` — Deno handler.
- `src/main/auth/discordAuth.ts` — PKCE URL build + protocol-callback session exchange.
- `src/main/auth/discordAuth.test.ts`, plus `*.test.ts` siblings for shared modules.
- `tests/integration/rls.test.ts` — two-user RLS policy tests against local Supabase.

**Modified:**
- `package.json` — test scripts + `vitest` devDep.
- `src/main/sync/syncProvider.ts` — config becomes session-based; add `members:*` SyncEvents.
- `src/main/sync/supabaseSync.ts` — auth session client, `roster_members` sync, Edge Function calls.
- `src/main/secrets.ts` — `SettingKey` set (drop `syncUrl/syncAnonKey/syncWorkspaceId`, add `discordSession`, `claimedGuildId`).
- `src/main/index.ts` — IPC handlers for auth/claim/invite/member-mgmt; wire session into sync.
- `src/preload/*` — typed `window.axiroster` surface for the new IPC.
- `src/renderer/src/components/SettingsView.tsx` — role-aware guild section; remove self-host inputs.
- `src/renderer/src/components/` — new `MemberAccessPanel.tsx`, `InvitePanel.tsx`.
- `docs/SUPABASE.md` — rewritten onboarding.

---

## Task 1: Test tooling + Supabase scaffold

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `supabase/config.toml` (via CLI), `supabase/.gitignore`

**Interfaces:**
- Produces: `npm test` runs Vitest with forks/maxForks=2; `supabase/` exists for migrations + functions.

- [ ] **Step 1: Add Vitest + scripts**

In `package.json` add to `devDependencies`: `"vitest": "^2.1.0"`. Add scripts:

```json
"test": "vitest run --pool=forks --poolOptions.forks.maxForks=2",
"test:watch": "vitest --pool=forks --poolOptions.forks.maxForks=2"
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2 } },
    include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node'
  }
})
```

- [ ] **Step 3: Install + init Supabase**

Run: `npm install`
Run: `npx supabase init` (creates `supabase/config.toml`; accept defaults, no VS Code settings).
Expected: `supabase/config.toml` exists.

- [ ] **Step 4: Add a smoke test**

Create `src/main/smoke.test.ts`:

```ts
import { test, expect } from 'vitest'
test('vitest runs', () => { expect(1 + 1).toBe(2) })
```

- [ ] **Step 5: Run + verify**

Run: `npm test`
Expected: PASS (1 test). Then delete `src/main/smoke.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts supabase/
git commit -m "chore: add vitest + supabase CLI scaffold"
```

---

## Task 2: Schema migration

**Files:**
- Create: `supabase/migrations/0001_workspaces_schema.sql`
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Produces: tables `workspaces`, `workspace_secrets`, `workspace_members`, `workspace_invites`, `roster_members`; existing `roster_annotations`/`roster_links` re-created with FK to `workspaces`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0001_workspaces_schema.sql
create table if not exists workspaces (
  workspace_id     text primary key,
  guild_name       text default '',
  discord_guild_id text default '',
  has_leader_key   boolean default false,
  created_at       timestamptz default now()
);

create table if not exists workspace_secrets (
  workspace_id   text primary key references workspaces(workspace_id) on delete cascade,
  leader_key_enc text not null,
  updated_at     timestamptz default now()
);

create table if not exists workspace_members (
  workspace_id text not null references workspaces(workspace_id) on delete cascade,
  user_id      uuid not null,
  discord_id   text,
  role         text not null check (role in ('owner','write','read')),
  created_at   timestamptz default now(),
  primary key (workspace_id, user_id)
);

create table if not exists workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspaces(workspace_id) on delete cascade,
  role         text not null check (role in ('write','read')),
  discord_id   text,
  code         text unique,
  created_by   uuid not null,
  redeemed_by  uuid,
  redeemed_at  timestamptz,
  created_at   timestamptz default now()
);

create table if not exists roster_members (
  workspace_id text not null references workspaces(workspace_id) on delete cascade,
  member_id    text not null,
  payload      jsonb not null,
  updated_at   timestamptz default now(),
  primary key (workspace_id, member_id)
);

create table if not exists roster_annotations (
  workspace_id text not null references workspaces(workspace_id) on delete cascade,
  member_id    text not null,
  nickname     text default '',
  aliases      jsonb default '[]'::jsonb,
  notes        text default '',
  tags         jsonb default '[]'::jsonb,
  main_account text default '',
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  primary key (workspace_id, member_id)
);

create table if not exists roster_links (
  workspace_id text not null references workspaces(workspace_id) on delete cascade,
  account_name text not null,
  member_id    text not null,
  created_at   timestamptz default now(),
  primary key (workspace_id, account_name)
);

alter publication supabase_realtime add table roster_annotations;
alter publication supabase_realtime add table roster_links;
alter publication supabase_realtime add table roster_members;
alter publication supabase_realtime add table workspace_members;
```

- [ ] **Step 2: Write the failing test**

Create `tests/integration/schema.test.ts` (talks to local Supabase via service role):

```ts
import { test, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(url, service, { auth: { persistSession: false } })

test('workspaces table accepts an insert', async () => {
  const id = '00000000-aaaa-bbbb-cccc-000000000001'
  await db.from('workspaces').delete().eq('workspace_id', id)
  const { error } = await db.from('workspaces').insert({ workspace_id: id, guild_name: 'T' })
  expect(error).toBeNull()
})
```

- [ ] **Step 3: Start local Supabase + apply migration**

Run: `npx supabase start` (prints API URL + service_role key).
Run: `npx supabase db reset` (applies migrations from scratch).
Expected: migration `0001` applies with no error.

- [ ] **Step 4: Run the test**

Run: `SUPABASE_SERVICE_ROLE_KEY=<printed key> npm test -- tests/integration/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_workspaces_schema.sql tests/integration/schema.test.ts
git commit -m "feat: workspace + roster schema migration"
```

---

## Task 3: RLS policies

**Files:**
- Create: `supabase/migrations/0002_rls_policies.sql`
- Test: `tests/integration/rls.test.ts`

**Interfaces:**
- Consumes: tables from Task 2.
- Produces: RLS enforcing member-SELECT, write+-mutation on annotations/links, owner-only member/invite management, zero client access to `workspace_secrets`.

- [ ] **Step 1: Write the policies migration**

```sql
-- supabase/migrations/0002_rls_policies.sql
alter table workspaces        enable row level security;
alter table workspace_secrets enable row level security;
alter table workspace_members enable row level security;
alter table workspace_invites enable row level security;
alter table roster_members    enable row level security;
alter table roster_annotations enable row level security;
alter table roster_links       enable row level security;

-- Membership predicates as helper functions (security definer to read members
-- without recursive RLS).
create or replace function is_member(ws text) returns boolean
  language sql security definer set search_path = public stable as $$
  select exists (select 1 from workspace_members m
                 where m.workspace_id = ws and m.user_id = auth.uid());
$$;

create or replace function can_write(ws text) returns boolean
  language sql security definer set search_path = public stable as $$
  select exists (select 1 from workspace_members m
                 where m.workspace_id = ws and m.user_id = auth.uid()
                   and m.role in ('owner','write'));
$$;

create or replace function is_owner(ws text) returns boolean
  language sql security definer set search_path = public stable as $$
  select exists (select 1 from workspace_members m
                 where m.workspace_id = ws and m.user_id = auth.uid()
                   and m.role = 'owner');
$$;

-- workspaces: members read; no client writes (Edge Functions use service role).
create policy ws_select on workspaces for select using (is_member(workspace_id));

-- workspace_secrets: no client access whatsoever.
-- (RLS on with zero policies = deny all for anon/authenticated.)

-- workspace_members: members can see the roster of members; owner manages.
create policy wm_select on workspace_members for select using (is_member(workspace_id));
create policy wm_insert on workspace_members for insert with check (is_owner(workspace_id));
create policy wm_update on workspace_members for update using (is_owner(workspace_id));
create policy wm_delete on workspace_members for delete using (is_owner(workspace_id));

-- workspace_invites: owner only (redemption goes through Edge Function).
create policy wi_all on workspace_invites for all
  using (is_owner(workspace_id)) with check (is_owner(workspace_id));

-- roster_members: members read; no client writes (refresh-roster writes).
create policy rm_select on roster_members for select using (is_member(workspace_id));

-- roster_annotations: members read, write+ mutate.
create policy ra_select on roster_annotations for select using (is_member(workspace_id));
create policy ra_write on roster_annotations for all
  using (can_write(workspace_id)) with check (can_write(workspace_id));

-- roster_links: members read, write+ mutate.
create policy rl_select on roster_links for select using (is_member(workspace_id));
create policy rl_write on roster_links for all
  using (can_write(workspace_id)) with check (can_write(workspace_id));
```

- [ ] **Step 2: Write the failing test**

Create `tests/integration/rls.test.ts`. Helper signs up two users and seeds a workspace via the service role:

```ts
import { test, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const anon = process.env.SUPABASE_ANON_KEY!
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(url, service, { auth: { persistSession: false } })
const WS = '00000000-aaaa-bbbb-cccc-000000000010'

async function userClient(email: string) {
  const c = createClient(url, anon, { auth: { persistSession: false } })
  await admin.auth.admin.createUser({ email, password: 'pw123456', email_confirm: true })
    .catch(() => {})
  await c.auth.signInWithPassword({ email, password: 'pw123456' })
  const { data } = await c.auth.getUser()
  return { c, uid: data.user!.id }
}

let owner: Awaited<ReturnType<typeof userClient>>
let reader: Awaited<ReturnType<typeof userClient>>

beforeAll(async () => {
  owner = await userClient('owner@test.dev')
  reader = await userClient('reader@test.dev')
  await admin.from('roster_annotations').delete().eq('workspace_id', WS)
  await admin.from('workspace_members').delete().eq('workspace_id', WS)
  await admin.from('workspaces').delete().eq('workspace_id', WS)
  await admin.from('workspaces').insert({ workspace_id: WS, guild_name: 'RLS' })
  await admin.from('workspace_members').insert([
    { workspace_id: WS, user_id: owner.uid, role: 'owner' },
    { workspace_id: WS, user_id: reader.uid, role: 'read' }
  ])
})

test('reader can select but not write annotations', async () => {
  const sel = await reader.c.from('roster_annotations').select('*').eq('workspace_id', WS)
  expect(sel.error).toBeNull()
  const ins = await reader.c.from('roster_annotations')
    .insert({ workspace_id: WS, member_id: 'm1', notes: 'x' })
  expect(ins.error).not.toBeNull() // RLS denies
})

test('owner can write annotations', async () => {
  const ins = await owner.c.from('roster_annotations')
    .upsert({ workspace_id: WS, member_id: 'm2', notes: 'ok' })
  expect(ins.error).toBeNull()
})

test('no client can read workspace_secrets', async () => {
  const r = await owner.c.from('workspace_secrets').select('*').eq('workspace_id', WS)
  expect(r.data ?? []).toHaveLength(0)
})

test('non-owner cannot add members', async () => {
  const r = await reader.c.from('workspace_members')
    .insert({ workspace_id: WS, user_id: reader.uid, role: 'write' })
  expect(r.error).not.toBeNull()
})
```

- [ ] **Step 3: Apply + run, verify fail-then-pass**

Run: `npx supabase db reset` (applies `0002`).
Run: `SUPABASE_ANON_KEY=<anon> SUPABASE_SERVICE_ROLE_KEY=<service> npm test -- tests/integration/rls.test.ts`
Expected: all 4 PASS. (If you ran before applying `0002`, the write-denial tests fail — confirming RLS is what enforces them.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0002_rls_policies.sql tests/integration/rls.test.ts
git commit -m "feat: RLS policies for workspace roles"
```

---

## Task 4: Shared GW2 leader-verification logic

**Files:**
- Create: `supabase/functions/_shared/gw2.ts`
- Test: `supabase/functions/_shared/gw2.test.ts`

**Interfaces:**
- Produces: `verifyLeaderKey(fetchFn: typeof fetch, apiKey: string, guildId: string): Promise<{ isLeader: boolean; members: GuildMember[] }>` — returns `isLeader:false` on 403; throws on network error.
- Produces type `GuildMember = { name: string; rank: string; joined: string | null }`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/_shared/gw2.test.ts
import { test, expect } from 'vitest'
import { verifyLeaderKey } from './gw2'

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
}

test('200 with member list => isLeader true', async () => {
  const r = await verifyLeaderKey(fakeFetch(200, [{ name: 'A.1', rank: 'Leader', joined: null }]), 'k', 'g')
  expect(r.isLeader).toBe(true)
  expect(r.members).toHaveLength(1)
})

test('403 => isLeader false', async () => {
  const r = await verifyLeaderKey(fakeFetch(403, { text: 'access restricted' }), 'k', 'g')
  expect(r.isLeader).toBe(false)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- supabase/functions/_shared/gw2.test.ts`
Expected: FAIL ("Cannot find module './gw2'").

- [ ] **Step 3: Implement**

```ts
// supabase/functions/_shared/gw2.ts
export type GuildMember = { name: string; rank: string; joined: string | null }

export async function verifyLeaderKey(
  fetchFn: typeof fetch,
  apiKey: string,
  guildId: string
): Promise<{ isLeader: boolean; members: GuildMember[] }> {
  const resp = await fetchFn(`https://api.guildwars2.com/v2/guild/${guildId}/members`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  })
  if (resp.status === 403) return { isLeader: false, members: [] }
  if (!resp.ok) throw new Error(`GW2 API error (HTTP ${resp.status})`)
  const members = (await resp.json()) as GuildMember[]
  return { isLeader: Array.isArray(members), members: Array.isArray(members) ? members : [] }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- supabase/functions/_shared/gw2.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/gw2.ts supabase/functions/_shared/gw2.test.ts
git commit -m "feat: GW2 leader-key verification helper"
```

---

## Task 5: Claim decision logic + key crypto

**Files:**
- Create: `supabase/functions/_shared/claim.ts`, `supabase/functions/_shared/crypto.ts`
- Test: `supabase/functions/_shared/claim.test.ts`, `supabase/functions/_shared/crypto.test.ts`

**Interfaces:**
- Produces: `decideClaim(existingOwnerCount: number, isLeader: boolean): { ok: boolean; reason?: 'not_leader' | 'already_claimed' }`.
- Produces: `encryptKey(plain, base64Secret): Promise<string>` / `decryptKey(payload, base64Secret): Promise<string>` (AES-GCM, WebCrypto — works in Deno and Node 20+).

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/_shared/claim.test.ts
import { test, expect } from 'vitest'
import { decideClaim } from './claim'
test('leader + unclaimed => ok', () => expect(decideClaim(0, true).ok).toBe(true))
test('not leader => not_leader', () => expect(decideClaim(0, false)).toEqual({ ok: false, reason: 'not_leader' }))
test('already claimed => already_claimed', () => expect(decideClaim(1, true)).toEqual({ ok: false, reason: 'already_claimed' }))
```

```ts
// supabase/functions/_shared/crypto.test.ts
import { test, expect } from 'vitest'
import { encryptKey, decryptKey } from './crypto'
import { webcrypto } from 'node:crypto'
// @ts-expect-error expose WebCrypto for the module under test in Node
globalThis.crypto ??= webcrypto

test('round-trips a key', async () => {
  const secret = Buffer.from(new Uint8Array(32).fill(7)).toString('base64')
  const enc = await encryptKey('SECRET-GW2-KEY', secret)
  expect(enc).not.toContain('SECRET')
  expect(await decryptKey(enc, secret)).toBe('SECRET-GW2-KEY')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- supabase/functions/_shared/claim.test.ts supabase/functions/_shared/crypto.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

```ts
// supabase/functions/_shared/claim.ts
export function decideClaim(
  existingOwnerCount: number,
  isLeader: boolean
): { ok: boolean; reason?: 'not_leader' | 'already_claimed' } {
  if (existingOwnerCount > 0) return { ok: false, reason: 'already_claimed' }
  if (!isLeader) return { ok: false, reason: 'not_leader' }
  return { ok: true }
}
```

```ts
// supabase/functions/_shared/crypto.ts
// AES-GCM via WebCrypto. `secret` is base64 of 32 raw bytes. Payload is
// base64(iv).base64(ciphertext).
function b64ToBytes(b: string): Uint8Array { return Uint8Array.from(atob(b), (c) => c.charCodeAt(0)) }
function bytesToB64(u: Uint8Array): string { return btoa(String.fromCharCode(...u)) }

async function importKey(base64Secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64ToBytes(base64Secret), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptKey(plain: string, base64Secret: string): Promise<string> {
  const key = await importKey(base64Secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)))
  return `${bytesToB64(iv)}.${bytesToB64(ct)}`
}

export async function decryptKey(payload: string, base64Secret: string): Promise<string> {
  const [ivB64, ctB64] = payload.split('.')
  const key = await importKey(base64Secret)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(ivB64) }, key, b64ToBytes(ctB64))
  return new TextDecoder().decode(pt)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- supabase/functions/_shared/claim.test.ts supabase/functions/_shared/crypto.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/claim.ts supabase/functions/_shared/crypto.ts supabase/functions/_shared/*.test.ts
git commit -m "feat: claim decision + AES-GCM key crypto"
```

---

## Task 6: `claim-guild` Edge Function

**Files:**
- Create: `supabase/functions/claim-guild/index.ts`
- Test: `supabase/functions/claim-guild/handler.test.ts`
- Create: `supabase/functions/claim-guild/handler.ts` (runtime-agnostic core)

**Interfaces:**
- Consumes: `verifyLeaderKey`, `decideClaim`, `encryptKey`.
- Produces: `handleClaim(deps, input): Promise<{ status: number; body: object }>` where
  `input = { userId: string; discordId: string|null; apiKey: string; guildId: string; guildName?: string }`
  and `deps = { verify, db, encrypt, keySecret }` with `db` exposing
  `countOwners(ws), upsertWorkspace(row), insertSecret(row), insertMember(row)`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/claim-guild/handler.test.ts
import { test, expect, vi } from 'vitest'
import { handleClaim } from './handler'

function deps(owners: number) {
  return {
    keySecret: Buffer.from(new Uint8Array(32).fill(1)).toString('base64'),
    verify: vi.fn(async () => ({ isLeader: owners === 0, members: [] })),
    encrypt: vi.fn(async () => 'enc'),
    db: {
      countOwners: vi.fn(async () => owners),
      upsertWorkspace: vi.fn(async () => {}),
      insertSecret: vi.fn(async () => {}),
      insertMember: vi.fn(async () => {})
    }
  }
}

const input = { userId: 'u1', discordId: 'd1', apiKey: 'k', guildId: 'g', guildName: 'G' }

test('first leader claims as owner', async () => {
  const d = deps(0)
  const r = await handleClaim(d as any, input)
  expect(r.status).toBe(200)
  expect(d.db.insertMember).toHaveBeenCalledWith(expect.objectContaining({ role: 'owner', workspace_id: 'g' }))
  expect(d.db.insertSecret).toHaveBeenCalled()
})

test('already claimed => 409', async () => {
  const r = await handleClaim(deps(1) as any, input)
  expect(r.status).toBe(409)
})

test('non-leader => 403', async () => {
  const d = deps(0)
  d.verify = vi.fn(async () => ({ isLeader: false, members: [] }))
  const r = await handleClaim(d as any, input)
  expect(r.status).toBe(403)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- supabase/functions/claim-guild/handler.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the core**

```ts
// supabase/functions/claim-guild/handler.ts
import { verifyLeaderKey } from '../_shared/gw2.ts'
import { decideClaim } from '../_shared/claim.ts'
import { encryptKey } from '../_shared/crypto.ts'

export interface ClaimDeps {
  keySecret: string
  verify: typeof verifyLeaderKey
  encrypt: typeof encryptKey
  db: {
    countOwners(ws: string): Promise<number>
    upsertWorkspace(row: Record<string, unknown>): Promise<void>
    insertSecret(row: Record<string, unknown>): Promise<void>
    insertMember(row: Record<string, unknown>): Promise<void>
  }
}
export interface ClaimInput {
  userId: string; discordId: string | null; apiKey: string; guildId: string; guildName?: string
}

export async function handleClaim(deps: ClaimDeps, input: ClaimInput) {
  const { isLeader } = await deps.verify((globalThis as any).fetch, input.apiKey, input.guildId)
  const owners = await deps.db.countOwners(input.guildId)
  const decision = decideClaim(owners, isLeader)
  if (!decision.ok) {
    const status = decision.reason === 'already_claimed' ? 409 : 403
    return { status, body: { error: decision.reason } }
  }
  await deps.db.upsertWorkspace({
    workspace_id: input.guildId, guild_name: input.guildName ?? '', has_leader_key: true
  })
  await deps.db.insertSecret({
    workspace_id: input.guildId, leader_key_enc: await deps.encrypt(input.apiKey, deps.keySecret)
  })
  await deps.db.insertMember({
    workspace_id: input.guildId, user_id: input.userId, discord_id: input.discordId, role: 'owner'
  })
  return { status: 200, body: { workspaceId: input.guildId, role: 'owner' } }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- supabase/functions/claim-guild/handler.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the Deno wiring handler**

```ts
// supabase/functions/claim-guild/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyLeaderKey } from '../_shared/gw2.ts'
import { encryptKey } from '../_shared/crypto.ts'
import { handleClaim } from './handler.ts'

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? ''
  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const keySecret = Deno.env.get('LEADER_KEY_SECRET')!
  // Identify the caller from their JWT.
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } }
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })

  const { apiKey, guildId, guildName } = await req.json()
  const db = createClient(url, service)
  const deps = {
    keySecret, verify: verifyLeaderKey, encrypt: encryptKey,
    db: {
      countOwners: async (ws: string) =>
        (await db.from('workspace_members').select('*', { count: 'exact', head: true })
          .eq('workspace_id', ws).eq('role', 'owner')).count ?? 0,
      upsertWorkspace: async (row: any) => { await db.from('workspaces').upsert(row) },
      insertSecret: async (row: any) => { await db.from('workspace_secrets').upsert(row) },
      insertMember: async (row: any) => { await db.from('workspace_members').upsert(row) }
    }
  }
  const r = await handleClaim(deps as any, {
    userId: user.id,
    discordId: (user.user_metadata?.provider_id as string) ?? null,
    apiKey, guildId, guildName
  })
  return new Response(JSON.stringify(r.body), {
    status: r.status, headers: { 'Content-Type': 'application/json' }
  })
})
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/claim-guild/
git commit -m "feat: claim-guild edge function"
```

---

## Task 7: `refresh-roster` Edge Function

**Files:**
- Create: `supabase/functions/refresh-roster/handler.ts`, `index.ts`
- Test: `supabase/functions/refresh-roster/handler.test.ts`

**Interfaces:**
- Produces: `handleRefresh(deps, input): Promise<{ status; body }>` where
  `input = { userId; guildId }`, `deps = { db: { isMember(ws,uid), getSecret(ws), upsertMembers(ws, rows) }, decrypt, keySecret, fetchMembers }`.
  `fetchMembers(apiKey, guildId)` returns `GuildMember[]`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/refresh-roster/handler.test.ts
import { test, expect, vi } from 'vitest'
import { handleRefresh } from './handler'

function deps(member: boolean) {
  return {
    keySecret: 's', decrypt: vi.fn(async () => 'leaderkey'),
    fetchMembers: vi.fn(async () => [{ name: 'A.1', rank: 'Member', joined: null }]),
    db: {
      isMember: vi.fn(async () => member),
      getSecret: vi.fn(async () => 'enc'),
      upsertMembers: vi.fn(async () => {})
    }
  }
}

test('non-member => 403', async () => {
  const r = await handleRefresh(deps(false) as any, { userId: 'u', guildId: 'g' })
  expect(r.status).toBe(403)
})

test('member refresh upserts members', async () => {
  const d = deps(true)
  const r = await handleRefresh(d as any, { userId: 'u', guildId: 'g' })
  expect(r.status).toBe(200)
  expect(d.db.upsertMembers).toHaveBeenCalledWith('g', expect.arrayContaining([
    expect.objectContaining({ member_id: 'A.1' })
  ]))
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- supabase/functions/refresh-roster/handler.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement core**

```ts
// supabase/functions/refresh-roster/handler.ts
import { decryptKey } from '../_shared/crypto.ts'
import type { GuildMember } from '../_shared/gw2.ts'

export interface RefreshDeps {
  keySecret: string
  decrypt: typeof decryptKey
  fetchMembers: (apiKey: string, guildId: string) => Promise<GuildMember[]>
  db: {
    isMember(ws: string, uid: string): Promise<boolean>
    getSecret(ws: string): Promise<string | null>
    upsertMembers(ws: string, rows: Record<string, unknown>[]): Promise<void>
  }
}

export async function handleRefresh(deps: RefreshDeps, input: { userId: string; guildId: string }) {
  if (!(await deps.db.isMember(input.guildId, input.userId)))
    return { status: 403, body: { error: 'not_member' } }
  const enc = await deps.db.getSecret(input.guildId)
  if (!enc) return { status: 409, body: { error: 'no_key' } }
  const apiKey = await deps.decrypt(enc, deps.keySecret)
  const members = await deps.fetchMembers(apiKey, input.guildId)
  const rows = members.map((m) => ({
    workspace_id: input.guildId, member_id: m.name, payload: m
  }))
  await deps.db.upsertMembers(input.guildId, rows)
  return { status: 200, body: { count: rows.length } }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- supabase/functions/refresh-roster/handler.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the Deno wiring**

```ts
// supabase/functions/refresh-roster/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptKey } from '../_shared/crypto.ts'
import { verifyLeaderKey } from '../_shared/gw2.ts'
import { handleRefresh } from './handler.ts'

Deno.serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const keySecret = Deno.env.get('LEADER_KEY_SECRET')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  const { guildId } = await req.json()
  const db = createClient(url, service)
  const deps = {
    keySecret, decrypt: decryptKey,
    fetchMembers: async (apiKey: string, gid: string) =>
      (await verifyLeaderKey(fetch, apiKey, gid)).members,
    db: {
      isMember: async (ws: string, uid: string) =>
        !!(await db.from('workspace_members').select('user_id').eq('workspace_id', ws).eq('user_id', uid).maybeSingle()).data,
      getSecret: async (ws: string) =>
        (await db.from('workspace_secrets').select('leader_key_enc').eq('workspace_id', ws).maybeSingle()).data?.leader_key_enc ?? null,
      upsertMembers: async (_ws: string, rows: any[]) => { await db.from('roster_members').upsert(rows) }
    }
  }
  const r = await handleRefresh(deps as any, { userId: user.id, guildId })
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
})
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/refresh-roster/
git commit -m "feat: refresh-roster edge function"
```

---

## Task 8: `redeem-invite` Edge Function

**Files:**
- Create: `supabase/functions/_shared/invite.ts`, `supabase/functions/redeem-invite/handler.ts`, `index.ts`
- Test: `supabase/functions/_shared/invite.test.ts`, `supabase/functions/redeem-invite/handler.test.ts`

**Interfaces:**
- Produces: `matchInvite(invites, { discordId, code }): Invite | null` (code match first, else unredeemed discordId match).
- Produces: `handleRedeem(deps, input): Promise<{ status; body }>`,
  `input = { userId; discordId; code? }`, `deps = { db: { listOpenInvites(...), markRedeemed(id, uid), insertMember(row) } }`.

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/_shared/invite.test.ts
import { test, expect } from 'vitest'
import { matchInvite } from './invite'
const base = { id: 'i', workspace_id: 'g', role: 'write', redeemed_by: null }
test('matches by code', () =>
  expect(matchInvite([{ ...base, code: 'ABC', discord_id: null }], { discordId: 'x', code: 'ABC' })?.id).toBe('i'))
test('matches by discord id when no code', () =>
  expect(matchInvite([{ ...base, code: null, discord_id: 'd1' }], { discordId: 'd1' })?.id).toBe('i'))
test('no match returns null', () =>
  expect(matchInvite([{ ...base, code: 'ABC', discord_id: null }], { discordId: 'd1' })).toBeNull())
```

```ts
// supabase/functions/redeem-invite/handler.test.ts
import { test, expect, vi } from 'vitest'
import { handleRedeem } from './handler'
function deps(invite: any) {
  return { db: {
    listOpenInvites: vi.fn(async () => invite ? [invite] : []),
    markRedeemed: vi.fn(async () => {}),
    insertMember: vi.fn(async () => {})
  } }
}
test('valid invite grants membership at its role', async () => {
  const d = deps({ id: 'i', workspace_id: 'g', role: 'write', code: null, discord_id: 'd1', redeemed_by: null })
  const r = await handleRedeem(d as any, { userId: 'u', discordId: 'd1' })
  expect(r.status).toBe(200)
  expect(d.db.insertMember).toHaveBeenCalledWith(expect.objectContaining({ role: 'write', user_id: 'u' }))
})
test('no invite => 404', async () => {
  const r = await handleRedeem(deps(null) as any, { userId: 'u', discordId: 'd1' })
  expect(r.status).toBe(404)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- supabase/functions/_shared/invite.test.ts supabase/functions/redeem-invite/handler.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// supabase/functions/_shared/invite.ts
export interface Invite {
  id: string; workspace_id: string; role: 'write' | 'read'
  code: string | null; discord_id: string | null; redeemed_by: string | null
}
export function matchInvite(
  invites: Invite[], q: { discordId: string | null; code?: string }
): Invite | null {
  if (q.code) return invites.find((i) => i.code === q.code && !i.redeemed_by) ?? null
  return invites.find((i) => i.discord_id && i.discord_id === q.discordId && !i.redeemed_by) ?? null
}
```

```ts
// supabase/functions/redeem-invite/handler.ts
import { matchInvite, type Invite } from '../_shared/invite.ts'
export interface RedeemDeps {
  db: {
    listOpenInvites(q: { discordId: string | null; code?: string }): Promise<Invite[]>
    markRedeemed(id: string, uid: string): Promise<void>
    insertMember(row: Record<string, unknown>): Promise<void>
  }
}
export async function handleRedeem(
  deps: RedeemDeps, input: { userId: string; discordId: string | null; code?: string }
) {
  const invites = await deps.db.listOpenInvites({ discordId: input.discordId, code: input.code })
  const invite = matchInvite(invites, { discordId: input.discordId, code: input.code })
  if (!invite) return { status: 404, body: { error: 'no_invite' } }
  await deps.db.insertMember({
    workspace_id: invite.workspace_id, user_id: input.userId,
    discord_id: input.discordId, role: invite.role
  })
  await deps.db.markRedeemed(invite.id, input.userId)
  return { status: 200, body: { workspaceId: invite.workspace_id, role: invite.role } }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- supabase/functions/_shared/invite.test.ts supabase/functions/redeem-invite/handler.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write Deno wiring**

```ts
// supabase/functions/redeem-invite/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleRedeem } from './handler.ts'

Deno.serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  const { code } = await req.json().catch(() => ({}))
  const discordId = (user.user_metadata?.provider_id as string) ?? null
  const db = createClient(url, service)
  const deps = { db: {
    listOpenInvites: async (q: { discordId: string | null; code?: string }) => {
      let query = db.from('workspace_invites').select('*').is('redeemed_by', null)
      query = q.code ? query.eq('code', q.code) : query.eq('discord_id', q.discordId)
      return (await query).data ?? []
    },
    markRedeemed: async (id: string, uid: string) => {
      await db.from('workspace_invites').update({ redeemed_by: uid, redeemed_at: new Date().toISOString() }).eq('id', id)
    },
    insertMember: async (row: any) => { await db.from('workspace_members').upsert(row) }
  } }
  const r = await handleRedeem(deps as any, { userId: user.id, discordId, code })
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
})
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/invite.ts supabase/functions/_shared/invite.test.ts supabase/functions/redeem-invite/
git commit -m "feat: redeem-invite edge function"
```

---

## Task 9: Discord OAuth (PKCE URL + callback) in main process

**Files:**
- Create: `src/main/auth/discordAuth.ts`, `src/main/auth/discordAuth.test.ts`
- Modify: `src/main/secrets.ts`

**Interfaces:**
- Consumes: `SettingsStore` (secret `discordSession`).
- Produces: `buildAuthUrl(supabaseUrl, redirectUri): { url: string; verifier: string }` (PKCE),
  `exchangeCode(supabaseClient, code, verifier): Promise<Session>`,
  and a `DiscordAuth` class with `signIn()`, `restoreSession()`, `signOut()`, `currentSession()`.

- [ ] **Step 1: Update `secrets.ts` key sets**

Replace the sync-related `SettingKey` union members. In `src/main/secrets.ts`:

```ts
export type SecretKey = 'guilds' | 'syncToken' | 'discordSession'

export type SettingKey =
  | 'activeGuildId'
  | 'syncEnabled'
  | 'claimedGuildId'
  | 'syncRole'
  | 'windowBounds'
```

(Removes `syncUrl`, `syncAnonKey`, `syncWorkspaceId`; adds `claimedGuildId` and the `discordSession` secret.)

- [ ] **Step 2: Write the failing test**

```ts
// src/main/auth/discordAuth.test.ts
import { test, expect } from 'vitest'
import { buildAuthUrl } from './discordAuth'

test('buildAuthUrl targets Discord provider with PKCE + redirect', () => {
  const { url, verifier } = buildAuthUrl('https://proj.supabase.co', 'axiroster://auth-callback')
  expect(url).toContain('/auth/v1/authorize')
  expect(url).toContain('provider=discord')
  expect(url).toContain('code_challenge=')
  expect(url).toContain('code_challenge_method=S256')
  expect(url).toContain(encodeURIComponent('axiroster://auth-callback'))
  expect(verifier.length).toBeGreaterThanOrEqual(43)
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- src/main/auth/discordAuth.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement**

```ts
// src/main/auth/discordAuth.ts
import { createHash, randomBytes } from 'crypto'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import type { SettingsStore } from '../secrets'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function buildAuthUrl(
  supabaseUrl: string, redirectUri: string
): { url: string; verifier: string } {
  const verifier = base64url(randomBytes(48))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const params = new URLSearchParams({
    provider: 'discord',
    redirect_to: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  })
  return { url: `${supabaseUrl}/auth/v1/authorize?${params.toString()}`, verifier }
}

export async function exchangeCode(
  client: SupabaseClient, code: string, verifier: string
): Promise<Session> {
  const { data, error } = await client.auth.exchangeCodeForSession(code)
  if (error || !data.session) throw new Error(error?.message ?? 'no session')
  void verifier
  return data.session
}

export class DiscordAuth {
  private client: SupabaseClient
  constructor(
    private readonly supabaseUrl: string,
    private readonly anonKey: string,
    private readonly store: SettingsStore,
    private readonly redirectUri = 'axiroster://auth-callback'
  ) {
    this.client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, flowType: 'pkce' }
    })
  }

  /** Returns the URL to open in the system browser + the verifier to keep. */
  startSignIn(): { url: string; verifier: string } {
    return buildAuthUrl(this.supabaseUrl, this.redirectUri)
  }

  /** Called when the axiroster://auth-callback?code=... deep link fires. */
  async completeSignIn(code: string, verifier: string): Promise<Session> {
    const session = await exchangeCode(this.client, code, verifier)
    this.store.setSecret('discordSession', JSON.stringify(session))
    return session
  }

  async restoreSession(): Promise<Session | null> {
    const raw = this.store.getSecret('discordSession')
    if (!raw) return null
    const session = JSON.parse(raw) as Session
    const { data } = await this.client.auth.setSession({
      access_token: session.access_token, refresh_token: session.refresh_token
    })
    if (data.session) this.store.setSecret('discordSession', JSON.stringify(data.session))
    return data.session ?? null
  }

  signOut(): void {
    this.store.setSecret('discordSession', '')
  }

  authedClient(): SupabaseClient {
    return this.client
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- src/main/auth/discordAuth.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/auth/discordAuth.ts src/main/auth/discordAuth.test.ts src/main/secrets.ts
git commit -m "feat: discord PKCE auth module + session storage"
```

---

## Task 10: `SyncProvider` config + events become session/role aware

**Files:**
- Modify: `src/main/sync/syncProvider.ts`
- Test: `src/main/sync/syncProvider.test.ts`

**Interfaces:**
- Produces: `SupabaseSyncConfig = { url; anonKey; workspaceId; accessToken; refreshToken }`.
- Produces: two new `SyncEvent` variants: `{ kind: 'member:upsert'; record: RosterMember }` and `{ kind: 'member:remove'; memberId: string }`, with `RosterMember = { memberId: string; payload: Record<string, unknown> }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/sync/syncProvider.test.ts
import { test, expect } from 'vitest'
import { LocalSyncProvider } from './syncProvider'
import type { SyncEvent } from './syncProvider'

test('member:upsert is a valid SyncEvent shape', () => {
  const e: SyncEvent = { kind: 'member:upsert', record: { memberId: 'A.1', payload: {} } }
  expect(e.kind).toBe('member:upsert')
})

test('LocalSyncProvider stays a no-op', async () => {
  const p = new LocalSyncProvider()
  await p.start()
  expect(p.status).toBe('disabled')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/main/sync/syncProvider.test.ts`
Expected: FAIL (type error: `member:upsert` not assignable / `RosterMember` missing). Run `npm run typecheck` to see it too.

- [ ] **Step 3: Implement the changes**

In `src/main/sync/syncProvider.ts`:

```ts
export interface RosterMember {
  memberId: string
  payload: Record<string, unknown>
}

export type SyncEvent =
  | { kind: 'annotation:upsert'; record: RosterAnnotation }
  | { kind: 'annotation:remove'; memberId: string }
  | { kind: 'link:set'; record: RosterLink }
  | { kind: 'link:remove'; accountName: string }
  | { kind: 'member:upsert'; record: RosterMember }
  | { kind: 'member:remove'; memberId: string }
```

Replace `SupabaseSyncConfig`:

```ts
export interface SupabaseSyncConfig {
  url: string
  anonKey: string
  /** GW2 guild id; rows are scoped to this. */
  workspaceId: string
  /** Discord-auth session so RLS sees auth.uid(). */
  accessToken: string
  refreshToken: string
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/main/sync/syncProvider.test.ts && npm run typecheck`
Expected: tests PASS. Typecheck will now flag `supabaseSync.ts` (fixed in Task 11) — that is expected; note it and continue.

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/syncProvider.ts src/main/sync/syncProvider.test.ts
git commit -m "feat: session-based sync config + member sync events"
```

---

## Task 11: `supabaseSync.ts` — auth session + roster_members sync

**Files:**
- Modify: `src/main/sync/supabaseSync.ts`
- Test: `src/main/sync/supabaseSync.test.ts`

**Interfaces:**
- Consumes: `SupabaseSyncConfig` (Task 10), Supabase Edge Functions.
- Produces: `SupabaseSyncProvider` that authenticates the client with the session, backfills + streams `roster_members` (read-only) in addition to annotations/links, and exposes `refreshRoster(): Promise<number>` (invokes the `refresh-roster` function).

- [ ] **Step 1: Write the failing test (row mapping)**

Extract the row→event mapping so it is unit-testable. Add a test:

```ts
// src/main/sync/supabaseSync.test.ts
import { test, expect } from 'vitest'
import { rowToMember } from './supabaseSync'

test('rowToMember maps payload + member_id', () => {
  const m = rowToMember({ member_id: 'A.1', payload: { rank: 'Member' } })
  expect(m).toEqual({ memberId: 'A.1', payload: { rank: 'Member' } })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/main/sync/supabaseSync.test.ts`
Expected: FAIL (`rowToMember` not exported).

- [ ] **Step 3: Implement**

In `src/main/sync/supabaseSync.ts`: add the `MEMBER_TABLE` constant and exported mapper, authenticate the client with the session, backfill/subscribe `roster_members`, and add `refreshRoster`.

```ts
const MEMBER_TABLE = 'roster_members'

export function rowToMember(r: Record<string, unknown>): RosterMember {
  return {
    memberId: String(r.member_id),
    payload: (r.payload ?? {}) as Record<string, unknown>
  }
}
```

Add `import type { RosterMember } from './syncProvider'` to the existing type import. In the constructor, set the session so RLS applies:

```ts
this.client = createClient(config.url, config.anonKey, { auth: { persistSession: false } })
void this.client.auth.setSession({
  access_token: config.accessToken, refresh_token: config.refreshToken
})
```

In `backfill()`, add the members pull:

```ts
const { data: members } = await this.client.from(MEMBER_TABLE).select('*').eq('workspace_id', ws)
for (const r of members ?? []) this.onEvent({ kind: 'member:upsert', record: rowToMember(r) })
```

In `subscribe()`, add a third `.on('postgres_changes', ...)` for `MEMBER_TABLE`:

```ts
.on('postgres_changes',
  { event: '*', schema: 'public', table: MEMBER_TABLE, filter: `workspace_id=eq.${ws}` },
  (payload) => {
    if (payload.eventType === 'DELETE') {
      this.onEvent({ kind: 'member:remove', memberId: String((payload.old as any).member_id) })
    } else {
      this.onEvent({ kind: 'member:upsert', record: rowToMember(payload.new as any) })
    }
  })
```

Add the method:

```ts
async refreshRoster(): Promise<number> {
  const { data, error } = await this.client.functions.invoke('refresh-roster', {
    body: { guildId: this.config.workspaceId }
  })
  if (error) throw error
  return (data as { count?: number })?.count ?? 0
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/main/sync/supabaseSync.test.ts && npm run typecheck`
Expected: test PASS, typecheck clean for this file.

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/supabaseSync.ts src/main/sync/supabaseSync.test.ts
git commit -m "feat: auth-session sync + roster_members streaming"
```

---

## Task 12: IPC + preload surface for auth/claim/invite/members

**Files:**
- Modify: `src/main/index.ts`, `src/preload/index.ts` (+ its `.d.ts`)
- Test: `src/main/auth/authFlows.test.ts`

**Interfaces:**
- Consumes: `DiscordAuth`, `SupabaseSyncProvider`, Edge Functions.
- Produces IPC channels (exposed on `window.axiroster`):
  - `auth:signIn()` → opens browser, resolves to `{ accountName, role, workspaceId } | null`
  - `auth:signOut()`, `auth:status()` → `{ signedIn: boolean; role?: Role; workspaceId?: string }`
  - `guild:claim({ apiKey, guildId, guildName })` → `{ ok: boolean; error?: string }`
  - `members:list()` → `{ userId; discordId; role }[]`
  - `members:setRole({ userId, role })`, `members:revoke({ userId })`
  - `invite:create({ discordId?, code?, role })` → `{ code?: string }`
  - `roster:refresh()` → `{ count: number }`

- [ ] **Step 1: Register the custom protocol (deep link)**

In `src/main/index.ts`, before `app.whenReady()`:

```ts
app.setAsDefaultProtocolClient('axiroster')
```

Add a single-instance handler that captures the callback URL and resolves the pending sign-in (store the `verifier` from `startSignIn()` in a module variable):

```ts
let pendingVerifier: string | null = null
let resolveAuth: ((code: string) => void) | null = null

app.on('open-url', (_e, url) => handleAuthCallback(url))           // macOS
app.on('second-instance', (_e, argv) => {
  const url = argv.find((a) => a.startsWith('axiroster://'))
  if (url) handleAuthCallback(url)
})
function handleAuthCallback(url: string): void {
  const code = new URL(url).searchParams.get('code')
  if (code && resolveAuth) resolveAuth(code)
}
```

- [ ] **Step 2: Write the failing test (callback parse)**

Factor the URL→code parse into a tiny pure function so it is testable:

```ts
// src/main/auth/authFlows.test.ts
import { test, expect } from 'vitest'
import { codeFromCallback } from './authFlows'
test('extracts code from callback url', () =>
  expect(codeFromCallback('axiroster://auth-callback?code=abc123')).toBe('abc123'))
test('null when no code', () =>
  expect(codeFromCallback('axiroster://auth-callback')).toBeNull())
```

- [ ] **Step 3: Implement `codeFromCallback` + run**

```ts
// src/main/auth/authFlows.ts
export function codeFromCallback(url: string): string | null {
  try { return new URL(url).searchParams.get('code') } catch { return null }
}
```

Use it inside `handleAuthCallback`. Run: `npm test -- src/main/auth/authFlows.test.ts` → PASS.

- [ ] **Step 4: Wire the IPC handlers**

In `src/main/index.ts`, add `ipcMain.handle` for each channel above. `auth:signIn` opens the browser via `shell.openExternal(url)`, awaits a promise resolved by `handleAuthCallback`, calls `discordAuth.completeSignIn(code, pendingVerifier)`, then calls `guild:claim` *or* `redeem-invite` as appropriate, and finally constructs the `SupabaseSyncProvider` with the session tokens. `members:*` and `invite:create` call the authed Supabase client / Edge Functions. `roster:refresh` calls `provider.refreshRoster()`.

```ts
ipcMain.handle('auth:signIn', async () => {
  const { url, verifier } = discordAuth.startSignIn()
  pendingVerifier = verifier
  const code = await new Promise<string>((res) => { resolveAuth = res; void shell.openExternal(url) })
  const session = await discordAuth.completeSignIn(code, verifier)
  return startSyncForSession(session)   // builds SupabaseSyncProvider, returns {accountName, role, workspaceId}
})
```

(Implement `startSyncForSession` next to the existing sync wiring; it reads `claimedGuildId`/`syncRole` from settings, builds `SupabaseSyncConfig`, and starts the provider.)

- [ ] **Step 5: Extend preload surface**

In `src/preload/index.ts` add the channels to the `window.axiroster` object and mirror the types in the preload `.d.ts`. Match existing patterns in that file exactly.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add src/main/index.ts src/main/auth/authFlows.ts src/main/auth/authFlows.test.ts src/preload/
git commit -m "feat: auth/claim/members/invite IPC + deep-link callback"
```

---

## Task 13: Role-aware Settings — guild section

**Files:**
- Modify: `src/renderer/src/components/SettingsView.tsx`
- Create: `src/renderer/src/components/MemberAccessPanel.tsx`, `InvitePanel.tsx`

**Interfaces:**
- Consumes: `window.axiroster` auth/members/invite channels (Task 12).
- Produces: a guild section that renders the **owner** view (editable key/guild, member list, invites) vs the **child** view (read-only, key shown as "configured ✓", no management).

- [ ] **Step 1: Remove self-host inputs**

In `SettingsView.tsx`, delete the URL / anon key / workspace-id fields and the enable-sync-with-manual-config block. Replace with a **Sign in with Discord** button (calls `window.axiroster.auth.signIn()`), showing signed-in account + role once connected.

- [ ] **Step 2: Owner vs child gate**

```tsx
const isOwner = status.role === 'owner'
// ...
{isOwner ? (
  <>
    <LeaderKeyField editable />
    <DiscordGuildField editable />
    <MemberAccessPanel />
    <InvitePanel />
  </>
) : (
  <>
    <div className="text-sm text-emerald-300">Leader key: configured ✓</div>
    <DiscordGuildField editable={false} />
    <div className="text-sm">Your role: {status.role}</div>
  </>
)}
```

The child branch NEVER calls any channel that returns the key value (none exists) and shows only the existence flag from `auth:status`.

- [ ] **Step 3: `MemberAccessPanel.tsx`**

Lists `members:list()`, each row with a read/write toggle (`members:setRole`) and a Revoke button (`members:revoke`). Disable the row for the owner's own entry.

```tsx
import { useEffect, useState } from 'react'
type Member = { userId: string; discordId: string | null; role: 'owner' | 'write' | 'read' }
export function MemberAccessPanel(): JSX.Element {
  const [members, setMembers] = useState<Member[]>([])
  const load = (): void => { void window.axiroster.members.list().then(setMembers) }
  useEffect(load, [])
  return (
    <div className="space-y-1">
      {members.map((m) => (
        <div key={m.userId} className="flex items-center gap-2">
          <span className="flex-1 text-sm">{m.discordId ?? m.userId}</span>
          {m.role === 'owner' ? <span className="text-xs">owner</span> : (
            <>
              <select value={m.role}
                onChange={async (e) => { await window.axiroster.members.setRole({ userId: m.userId, role: e.target.value as 'write' | 'read' }); load() }}>
                <option value="read">read</option>
                <option value="write">write</option>
              </select>
              <button onClick={async () => { await window.axiroster.members.revoke({ userId: m.userId }); load() }}>Revoke</button>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: `InvitePanel.tsx`**

Two actions: pick from the loaded Discord roster (passes `discordId` + role) and generate a code (passes `code: undefined` → server returns a generated code to copy). Match existing Tailwind/emerald styling.

- [ ] **Step 5: Render + visually verify in-app**

Run the app (`npm run dev`), open Settings as owner and as a `read` user (use a second test account). Confirm the child view hides management and shows "configured ✓".

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`

```bash
git add src/renderer/src/components/SettingsView.tsx src/renderer/src/components/MemberAccessPanel.tsx src/renderer/src/components/InvitePanel.tsx
git commit -m "feat: role-aware settings + member/invite panels"
```

---

## Task 14: Officers consume the synced roster

**Files:**
- Modify: `src/main/index.ts` (roster orchestration), `src/main/rosterReconcile.ts` if needed
- Test: `src/main/rosterFromSync.test.ts`

**Interfaces:**
- Consumes: `member:upsert`/`member:remove` events landing in a local synced-members store.
- Produces: when the local app has no leader key, the roster is built from `roster_members` (synced) instead of a live GW2 pull; a leader's app still pulls live and the result is pushed via `refresh-roster`.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/rosterFromSync.test.ts
import { test, expect } from 'vitest'
import { rosterSourceFor } from './index'  // pure helper exported for test

test('uses synced members when no leader key present', () => {
  expect(rosterSourceFor({ hasLeaderKey: false })).toBe('synced')
})
test('uses live pull when leader key present', () => {
  expect(rosterSourceFor({ hasLeaderKey: true })).toBe('live')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/main/rosterFromSync.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `rosterSourceFor` + wire the synced-members store**

```ts
export function rosterSourceFor(ctx: { hasLeaderKey: boolean }): 'live' | 'synced' {
  return ctx.hasLeaderKey ? 'live' : 'synced'
}
```

Maintain an in-memory `Map<memberId, payload>` updated on `member:*` events; when `rosterSourceFor` returns `'synced'`, feed that map into the existing reconcile pipeline in place of `gw2Client.guildMembers()`.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/main/rosterFromSync.test.ts && npm run typecheck`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/main/rosterFromSync.test.ts
git commit -m "feat: officers build roster from synced members"
```

---

## Task 15: Docs + deploy notes

**Files:**
- Modify: `docs/SUPABASE.md`, `README.md`
- Create: `docs/DEPLOY.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Rewrite `docs/SUPABASE.md`**

Replace the self-host setup with the new flow: sign in with Discord; a guild *leader* claims the guild (their key is verified + stored encrypted); owners invite officers by Discord pick or code; roles are read/write. Remove the old "create your own project / paste URL+anon key+workspace id" instructions.

- [ ] **Step 2: Write `docs/DEPLOY.md` (maintainer)**

Document the one-time maintainer setup: create the Supabase project; run `supabase db push`; set Edge Function secrets (`supabase secrets set LEADER_KEY_SECRET=<base64-32-bytes>`); `supabase functions deploy claim-guild refresh-roster redeem-invite`; enable the Discord auth provider with the OAuth client id/secret + redirect `axiroster://auth-callback`; set the bundled `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

- [ ] **Step 3: Update `README.md` "Shared sync" bullet**

Change the "Supabase-backed, each guild sets up their own" wording to "sign in with Discord; leaders claim, owners invite."

- [ ] **Step 4: Commit**

```bash
git add docs/SUPABASE.md docs/DEPLOY.md README.md
git commit -m "docs: shared-instance onboarding + maintainer deploy"
```

---

## Self-Review Notes (author)

- **Spec coverage:** one Supabase instance (Task 15 deploy + Task 11 bundled config), workspace=guild id (Global Constraints + Task 6), Discord identity + GW2 authorization (Tasks 9/6), leader-only claim (Task 4/6), encrypted key never to client (Tasks 5/3 RLS deny + Global Constraints), invites pick+code (Task 8/13), roles read/write/owner (Task 3 RLS + Task 13 UI), owner-only management (Task 3/13), synced roster for officers (Tasks 11/14), self-host removed (Tasks 9/13), free-tier (no special task — config only). All spec sections map to a task.
- **Placeholder scan:** every code step carries complete code; no TBD/TODO.
- **Type consistency:** `RosterMember`, `SupabaseSyncConfig`, role union `'owner'|'write'|'read'`, and `rowToMember`/`refreshRoster` names are used identically across Tasks 10/11/13/14.
- **Known integration caveats (not gaps):** the Deno `index.ts` wiring files are verified manually via `supabase functions serve` (not Vitest, since they need the Deno runtime); their business logic is fully unit-tested via the `_shared`/`handler` modules.
