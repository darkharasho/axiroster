# Axi access policy (Supabase) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the Axi access denylist in the axiroster Supabase backend. Blocked Discord users, GW2 accounts, GW2 guilds and Discord servers are refused by `claim-guild`, `redeem-invite`, `stamp-identity` and `share-keys`. Blocked users and blocked workspaces immediately lose read and write access to workspace data through RLS.

**Architecture:**
- Migration `0012_access_policy.sql` adds a service-role-only `policy_blocks` table. The axi-config Worker fills it through the RPC `replace_policy_blocks(p_hashes, p_version)`, which ignores pushes older than the last applied version.
- The same migration adds `policy_hash(kind, value)` (SQL port of the identity hash), `is_blocked(hashes)` and `caller_blocked(ws)`. It redefines the three RLS predicates `is_member`, `can_write` and `is_owner` to also require `not caller_blocked(ws)`. That covers every policy except `wm_self_leave`, so a blocked user can still leave.
- The edge functions use `_shared/policy.ts`, a TypeScript port of the identity hash verified against the shared vectors. It looks hashes up in `policy_blocks` with the service client.

**Tech Stack:** Supabase Postgres 17, Deno 2 edge functions (`esm.sh` imports), Vitest unit tests (`npm test`), Vitest integration tests against a local Supabase stack (`npm run test:integration`).

**Spec:** `darkharasho/axi-config` → `docs/superpowers/specs/2026-10-05-axi-config-design.md`, section "Server-side enforcement → axiroster (Supabase)". The spec repo is private; its rules are copied into Global Constraints below.

## Spec deltas (decided here)

- **Edge functions read `policy_blocks` instead of fetching the manifest.** The spec has `_shared/policy.ts` fetch the manifest with a 5-minute cache. The axi-config Worker already pushes the exact same hash set into `policy_blocks` on every change, retrying every 10 minutes if a push fails. Reading that table:
  - needs no outbound call or per-isolate cache;
  - makes the edge functions and RLS agree at every moment;
  - takes effect as soon as the push lands.
- **GW2 account check uses one extra `/v2/account` call, and only where a key is supplied.** The caller's GW2 account name is not stored server-side. `claim-guild` and `share-keys` (when `share` is on) receive a GW2 API key, so they look up `/v2/account` `name`. `redeem-invite` and `stamp-identity` receive no key. They check the Discord user, plus the GW2 guild and Discord server where known. The desktop client covers the account there.
- **Refusal body.** HTTP 403 `{ "error": "unavailable", "message": "Access unavailable for this account." }`. This keeps the existing `{ error: <code> }` convention and carries the spec's neutral text.
- **Caller's Discord ID in RLS.** `caller_blocked` checks both `auth.identities` (provider `discord`, the trustworthy source that `discordIdFromUser` uses) and the member row's `discord_id`. Either match blocks.

## Global Constraints

- Normalization runs NFC → trim → lowercase → NFC, then a per-kind pattern. A value that fails its pattern is invalid and never matches.

  | Kind | Pattern |
  |---|---|
  | `gw2_account` | `^.+\.\d{4}$` |
  | `gw2_guild` | lowercase UUID |
  | `discord_user`, `discord_server` | `^\d{17,20}$` |
  | `github_user` | `^[1-9]\d{0,19}$` |

  The hash is `sha256_hex(kind + ":" + normalized)`. The TS port and the SQL `policy_hash` must both reproduce `supabase/functions/_shared/policy.vectors.json`, a verbatim copy of axi-config `test-vectors/hashing.json` at 7fccf7d.
- Push contract, called by the axi-config Worker:
  - Endpoint: `POST {SUPABASE_URL}/rest/v1/rpc/replace_policy_blocks` with JSON `{p_hashes: string[], p_version: number}`.
  - Auth: the service key in `apikey`, plus `Authorization: Bearer` when it is a JWT.
  - Response: 2xx means applied or ignored as stale.
  - A `p_version` lower than the stored version is ignored and changes nothing. An equal version is re-applied, which is idempotent.
- `policy_blocks` and `policy_state` are readable and writable only by the service role. `replace_policy_blocks` is executable only by `service_role`.
- Refusals are neutral and never say which identifier matched. There is no telemetry and nothing logs a match.
- The edge-function check fails open: a lookup error is logged with `console.error` and nobody is refused there. RLS still enforces.
- `policy_blocks` empty (the dormant state) must cost the RLS predicates no hashing (`CASE` short-circuit).
- Never run `supabase db push`, `supabase functions deploy`, `supabase link`, or any command with `--linked`/`--project-ref` during implementation. Local stack only (`npx supabase start`, `npx supabase db reset`).
- Work on branch `feat/access-policy` from `main`. Do **not** merge into `main` without the user's explicit go-ahead: the repo's docs say the Supabase GitHub integration may auto-apply migrations to production on push to `main`.
- Unit tests: `npm test`, already limited to 2 forks. Integration: `npm run test:integration -- --pool=forks --poolOptions.forks.maxForks=2`.
- Commits use Conventional Commits with scope `access` and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Members whose `discord_id` is NULL and who have no Discord identity: `policy_hash` returns NULL and `= any(array[..., NULL])` must simply not match. They must keep access.
2. The dormant state (empty `policy_blocks`) must leave every existing RLS test passing unchanged. `tests/integration/rls.test.ts` must still pass.
3. A blocked user can still delete their own membership (`wm_self_leave` is untouched), and service-role functions (`refresh-roster`, `axitools`) keep working.
4. Out-of-order pushes: version 5 applied, then a delayed version 4 arrives. The contents must stay at version 5. Version 6 then replaces them.
5. Workspace ids stored in uppercase or with surrounding spaces must still hash like the normalized UUID (`lower(btrim(...))` inside `policy_hash`).

## File Structure

- Create `supabase/migrations/0012_access_policy.sql`: tables, hash/predicate functions, RPC, redefined membership predicates.
- Create `supabase/functions/_shared/policy.vectors.json`: shared vectors.
- Create `tests/integration/policy.test.ts`: SQL hash parity, push RPC, RLS denial.
- Create `supabase/functions/_shared/policy.ts` and `supabase/functions/_shared/policy.test.ts`.
- Modify `supabase/functions/_shared/gw2.ts`: add `fetchAccountName`, with tests in `_shared/gw2.test.ts`.
- Modify `claim-guild/handler.ts`, `claim-guild/index.ts` and `claim-guild/handler.test.ts`.
- Modify `redeem-invite/handler.ts`, `redeem-invite/index.ts` and `redeem-invite/handler.test.ts`.
- Modify `stamp-identity/index.ts` and `share-keys/index.ts`.
- Modify `docs/DEPLOY.md`.

---

### Task 1: Migration, push RPC and RLS enforcement

**Files:**
- Create: `supabase/migrations/0012_access_policy.sql`
- Create: `supabase/functions/_shared/policy.vectors.json`
- Test: `tests/integration/policy.test.ts`

**Interfaces:**
- Produces (SQL, schema `public`):
  - `policy_blocks(hash text primary key)`
  - `policy_state(id boolean primary key, version bigint)`
  - `policy_hash(kind text, value text) returns text`: NULL for a NULL or blank value.
  - `is_blocked(hashes text[]) returns boolean`
  - `caller_blocked(ws text) returns boolean`
  - `replace_policy_blocks(p_hashes text[], p_version bigint) returns boolean`: false when ignored as stale.
  - `is_member`, `can_write` and `is_owner`, which now also require `not caller_blocked(ws)`.
  - Policy `wm_select_self` on `workspace_members`: a user can always read their own membership rows, so leaving still works while blocked.
- Produces (file): `supabase/functions/_shared/policy.vectors.json`, consumed by Task 2.

- [ ] **Step 1: Create the vectors file**

Create `supabase/functions/_shared/policy.vectors.json` with exactly this content. It is a copy of axi-config `test-vectors/hashing.json` at 7fccf7d. Keep the `\u` escapes literal; `grep -c 'u0303' supabase/functions/_shared/policy.vectors.json` must print `1`.

```json
{
    "valid": [
        { "kind": "gw2_account", "input": "Name.1234", "normalized": "name.1234", "hash": "57618b5eb6509d74c9625c25e02225cd901544920541936c5d31539679547509" },
        { "kind": "gw2_account", "input": "  Test Account.0001 ", "normalized": "test account.0001", "hash": "ed0473b6f47426585d104930984e9db32e9af8c8f9bbabd66919e9a3ca0fbf3e" },
        { "kind": "gw2_account", "input": "Ñoño.4321", "normalized": "ñoño.4321", "hash": "bd29e2f0e5ad9840fa6b33af7ced10475e5b49098da660ae3496dc4f69ad587e" },
        { "kind": "gw2_guild", "input": "4BBB52AA-D768-4FC6-8EDE-C299F2822F0F", "normalized": "4bbb52aa-d768-4fc6-8ede-c299f2822f0f", "hash": "8370f0eea5044c9f489b3da126719d673ed5f3f83135027c0aa0e4f68a0cea75" },
        { "kind": "discord_user", "input": "123456789012345678", "normalized": "123456789012345678", "hash": "40a1a7f30577de59d0c1475d5c1a3c22d1fcea99a07e321b31476fe8cc158d97" },
        { "kind": "discord_user", "input": " 98765432109876543 ", "normalized": "98765432109876543", "hash": "10ac4980cafe2f25d59e193debda1a573c954ca6e3e0bf46f9c19ac33780f433" },
        { "kind": "discord_server", "input": "1100000000000000001", "normalized": "1100000000000000001", "hash": "d4b7ba484cc768e7100cc3782813da1fe4c68910d08ac878a6f94f250c68503c" },
        { "kind": "github_user", "input": "1234567", "normalized": "1234567", "hash": "ba52ca31dec642ad640ce0bbbf8382b6f89493a8ac7d965d2e69659c654a6b2f" },
        { "kind": "gw2_account", "input": "T̈est.1234", "normalized": "ẗest.1234", "hash": "bb3b9cf9e29c0cd17444f1d352057fcc16b770d584330b5c1cdb12bd3b666400" }
    ],
    "invalid": [
        { "kind": "gw2_account", "input": "NoNumber" },
        { "kind": "gw2_account", "input": "Name.12" },
        { "kind": "gw2_account", "input": "   " },
        { "kind": "gw2_guild", "input": "not-a-uuid" },
        { "kind": "gw2_guild", "input": "4bbb52aa-d768-4fc6-8ede-c299f2822f0" },
        { "kind": "discord_user", "input": "12345" },
        { "kind": "discord_user", "input": "abc123456789012345678" },
        { "kind": "discord_server", "input": "" },
        { "kind": "github_user", "input": "octocat" },
        { "kind": "github_user", "input": "0123" },
        { "kind": "steam_user", "input": "1" }
    ]
}
```

- [ ] **Step 2: Start the local stack**

```bash
# This machine runs podman; point the Supabase CLI at its Docker-compatible socket.
systemctl --user start podman.socket
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock
npx supabase start
npx supabase status -o env > /tmp/axiroster-supabase.env
```

Expected: the stack is up and `/tmp/axiroster-supabase.env` contains `API_URL`, `ANON_KEY` and `SERVICE_ROLE_KEY`.

If `supabase start` cannot run here (no container runtime, image pull blocked), stop and report `BLOCKED` with the exact error. Do not skip the integration tests silently.

- [ ] **Step 3: Write the failing integration tests**

Create `tests/integration/policy.test.ts`:

```ts
import { test, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const anon = process.env.SUPABASE_ANON_KEY!
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(url, service, { auth: { persistSession: false } })
const WS = '00000000-aaaa-bbbb-cccc-000000000020'
const READER_DISCORD = '123456789012345678'
const SERVER = '1100000000000000001'
const VECTORS = JSON.parse(
  readFileSync(new URL('../../supabase/functions/_shared/policy.vectors.json', import.meta.url), 'utf8')
) as { valid: { kind: string; input: string; hash: string }[] }

const sha = (kind: string, normalized: string) =>
  createHash('sha256').update(`${kind}:${normalized}`, 'utf8').digest('hex')

// The stored version persists across runs of the local stack; keep it monotonic.
let version = Date.now()
async function push(hashes: string[]) {
  version += 1
  const { data, error } = await admin.rpc('replace_policy_blocks', { p_hashes: hashes, p_version: version })
  expect(error).toBeNull()
  return data as boolean
}
async function blocks() {
  const { data, error } = await admin.from('policy_blocks').select('hash').order('hash')
  expect(error).toBeNull()
  return (data ?? []).map((r: { hash: string }) => r.hash)
}

async function userClient(email: string) {
  const c = createClient(url, anon, { auth: { persistSession: false } })
  await admin.auth.admin.createUser({ email, password: 'pw123456', email_confirm: true }).catch(() => {})
  await c.auth.signInWithPassword({ email, password: 'pw123456' })
  const { data } = await c.auth.getUser()
  return { c, uid: data.user!.id }
}

let owner: Awaited<ReturnType<typeof userClient>>
let reader: Awaited<ReturnType<typeof userClient>>

async function visibleWorkspaces(who: typeof owner) {
  const { data, error } = await who.c.from('workspaces').select('workspace_id').eq('workspace_id', WS)
  expect(error).toBeNull()
  return (data ?? []).length
}

beforeAll(async () => {
  owner = await userClient('policy-owner@test.dev')
  reader = await userClient('policy-reader@test.dev')
  await admin.from('workspace_members').delete().eq('workspace_id', WS)
  await admin.from('workspaces').delete().eq('workspace_id', WS)
  await admin.from('workspaces').insert({ workspace_id: WS, guild_name: 'Policy', discord_guild_id: '' })
  await admin.from('workspace_members').insert([
    { workspace_id: WS, user_id: owner.uid, role: 'owner' },
    { workspace_id: WS, user_id: reader.uid, role: 'read', discord_id: READER_DISCORD }
  ])
  await push([])
})

afterAll(async () => {
  await push([])
})

test('policy_hash reproduces every shared vector', async () => {
  for (const v of VECTORS.valid) {
    const { data, error } = await admin.rpc('policy_hash', { kind: v.kind, value: v.input })
    expect(error).toBeNull()
    expect(data, `${v.kind} ${JSON.stringify(v.input)}`).toBe(v.hash)
  }
})

test('policy_hash is NULL for a NULL or blank value', async () => {
  expect((await admin.rpc('policy_hash', { kind: 'discord_user', value: null })).data).toBeNull()
  expect((await admin.rpc('policy_hash', { kind: 'discord_user', value: '  ' })).data).toBeNull()
})

test('replace_policy_blocks replaces the set and ignores stale versions', async () => {
  const a = sha('discord_user', '111111111111111111')
  const b = sha('discord_user', '222222222222222222')
  expect(await push([a, b, a, 'not-a-hash'])).toBe(true)
  expect(await blocks()).toEqual([a, b].sort())

  const stale = await admin.rpc('replace_policy_blocks', { p_hashes: [], p_version: version - 1 })
  expect(stale.error).toBeNull()
  expect(stale.data).toBe(false)
  expect(await blocks()).toEqual([a, b].sort())

  const same = await admin.rpc('replace_policy_blocks', { p_hashes: [a], p_version: version })
  expect(same.data).toBe(true)
  expect(await blocks()).toEqual([a])

  expect(await push([])).toBe(true)
  expect(await blocks()).toEqual([])
})

test('clients can neither push nor read the list', async () => {
  const r = await reader.c.rpc('replace_policy_blocks', { p_hashes: [], p_version: version + 1000 })
  expect(r.error).not.toBeNull()
  const sel = await reader.c.from('policy_blocks').select('hash')
  expect(sel.data ?? []).toHaveLength(0)
  const state = await reader.c.from('policy_state').select('version')
  expect(state.data ?? []).toHaveLength(0)
})

test('dormant: an empty list leaves both members their access', async () => {
  await push([])
  expect(await visibleWorkspaces(owner)).toBe(1)
  expect(await visibleWorkspaces(reader)).toBe(1)
})

test('a revoked member loses read access; others keep theirs; unban restores it', async () => {
  await push([sha('discord_user', READER_DISCORD)])
  expect(await visibleWorkspaces(reader)).toBe(0)
  expect(await visibleWorkspaces(owner)).toBe(1)
  await push([])
  expect(await visibleWorkspaces(reader)).toBe(1)
})

test('a revoked GW2 guild hides its workspace from every member', async () => {
  await push([sha('gw2_guild', WS)])
  expect(await visibleWorkspaces(owner)).toBe(0)
  expect(await visibleWorkspaces(reader)).toBe(0)
  const write = await owner.c.from('roster_annotations').upsert({ workspace_id: WS, member_id: 'm1', notes: 'x' })
  expect(write.error).not.toBeNull()
  await push([])
  expect(await visibleWorkspaces(owner)).toBe(1)
})

test('a revoked Discord server hides the workspace linked to it', async () => {
  await admin.from('workspaces').update({ discord_guild_id: SERVER }).eq('workspace_id', WS)
  await push([sha('discord_server', SERVER)])
  expect(await visibleWorkspaces(owner)).toBe(0)
  await push([])
  await admin.from('workspaces').update({ discord_guild_id: '' }).eq('workspace_id', WS)
  expect(await visibleWorkspaces(owner)).toBe(1)
})

test('a revoked member can still leave the workspace', async () => {
  await push([sha('discord_user', READER_DISCORD)])
  const left = await reader.c.from('workspace_members').delete().eq('workspace_id', WS).eq('user_id', reader.uid)
  expect(left.error).toBeNull()
  const still = await admin.from('workspace_members').select('user_id').eq('workspace_id', WS).eq('user_id', reader.uid)
  expect(still.data ?? []).toHaveLength(0)
  await push([])
  await admin.from('workspace_members').upsert({ workspace_id: WS, user_id: reader.uid, role: 'read', discord_id: READER_DISCORD })
})
```

- [ ] **Step 4: Run them to verify they fail**

```bash
set -a; . /tmp/axiroster-supabase.env; set +a
export SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
npm run test:integration -- tests/integration/policy.test.ts --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL. `policy_hash` and `replace_policy_blocks` are missing (`Could not find the function`).

- [ ] **Step 5: Write the migration**

Create `supabase/migrations/0012_access_policy.sql`:

```sql
-- supabase/migrations/0012_access_policy.sql
-- Axi access policy. Access to the Axi apps can be revoked for people, GW2
-- guilds and Discord servers that violate their terms of use. The axi-config
-- Worker (config.axi.link) pushes the active list here as SHA-256 hashes of
-- "kind:normalized" identifiers via replace_policy_blocks(); nothing here
-- names anyone. The membership predicates used by every RLS policy now also
-- require that neither the caller nor the workspace is on the list, so a
-- revocation takes effect on existing data immediately. wm_self_leave does not
-- use them, so a blocked user can still leave a workspace.

create table if not exists policy_blocks (
  hash text primary key check (hash ~ '^[0-9a-f]{64}$')
);

create table if not exists policy_state (
  id      boolean primary key default true check (id),
  version bigint  not null default 0
);
insert into policy_state (id, version) values (true, 0) on conflict (id) do nothing;

-- Service role only: RLS on with no policies, and no table privileges.
alter table policy_blocks enable row level security;
alter table policy_state  enable row level security;
revoke all on policy_blocks, policy_state from anon, authenticated;

-- SQL port of the axi-config identity hash for the stored identifiers used
-- below (snowflakes and guild UUIDs): NFC, trim, lowercase, NFC, then
-- sha256_hex(kind || ':' || normalized). NULL for a NULL or blank value.
create or replace function policy_hash(kind text, value text) returns text
  language sql immutable set search_path = public as $$
  select case
    when value is null or btrim(value) = '' then null
    else encode(sha256(convert_to(
      kind || ':' || normalize(lower(btrim(normalize(value, nfc))), nfc), 'UTF8')), 'hex')
  end;
$$;

create or replace function is_blocked(hashes text[]) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from policy_blocks b where b.hash = any (hashes));
$$;

-- True when the calling user, or the workspace itself, is on the list: the
-- workspace's GW2 guild (its id) and linked Discord server, and the caller's
-- Discord id from their auth identity or their member row. With an empty list
-- (the dormant state) no hash is computed at all.
create or replace function caller_blocked(ws text) returns boolean
  language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from policy_blocks) then false
    else is_blocked(array[
      policy_hash('gw2_guild', ws),
      (select policy_hash('discord_server', w.discord_guild_id)
         from workspaces w where w.workspace_id = ws),
      (select policy_hash('discord_user', i.provider_id)
         from auth.identities i
        where i.user_id = auth.uid() and i.provider = 'discord'
        limit 1),
      (select policy_hash('discord_user', m.discord_id)
         from workspace_members m
        where m.workspace_id = ws and m.user_id = auth.uid())
    ])
  end;
$$;

create or replace function is_member(ws text) returns boolean
  language sql security definer set search_path = public stable as $$
  select exists (select 1 from workspace_members m
                 where m.workspace_id = ws and m.user_id = auth.uid())
     and not caller_blocked(ws);
$$;

create or replace function can_write(ws text) returns boolean
  language sql security definer set search_path = public stable as $$
  select exists (select 1 from workspace_members m
                 where m.workspace_id = ws and m.user_id = auth.uid()
                   and m.role in ('owner','write'))
     and not caller_blocked(ws);
$$;

create or replace function is_owner(ws text) returns boolean
  language sql security definer set search_path = public stable as $$
  select exists (select 1 from workspace_members m
                 where m.workspace_id = ws and m.user_id = auth.uid()
                   and m.role = 'owner')
     and not caller_blocked(ws);
$$;

-- Called by the axi-config Worker with the service key after every list
-- change (and by its 10-minute retry). Pushes can arrive out of order; one
-- older than the last applied version is ignored. Returns false when ignored.
create or replace function replace_policy_blocks(p_hashes text[], p_version bigint) returns boolean
  language plpgsql security definer set search_path = public as $$
declare
  current_version bigint;
begin
  select version into current_version from policy_state where id for update;
  if p_version < current_version then
    return false;
  end if;
  delete from policy_blocks where true;
  insert into policy_blocks (hash)
    select distinct h from unnest(coalesce(p_hashes, '{}'::text[])) as h
     where h ~ '^[0-9a-f]{64}$';
  update policy_state set version = p_version where id;
  return true;
end;
$$;

revoke execute on function replace_policy_blocks(text[], bigint) from public, anon, authenticated;
grant execute on function replace_policy_blocks(text[], bigint) to service_role;

-- A DELETE that filters on columns must also pass a SELECT policy, so without
-- this a blocked member could not see (and therefore not delete) their own
-- membership row, and wm_self_leave would silently do nothing. It exposes only
-- the caller's own rows.
drop policy if exists wm_select_self on workspace_members;
create policy wm_select_self on workspace_members for select using (user_id = auth.uid());
```

- [ ] **Step 6: Apply locally and run the tests**

```bash
npx supabase db reset            # local stack only: re-applies every migration
npm run test:integration -- --pool=forks --poolOptions.forks.maxForks=2
```

Expected: PASS for `tests/integration/policy.test.ts`. The existing `rls.test.ts` and `schema.test.ts` must also stay green; that covers the dormant state.

- [ ] **Step 7: Stop the stack and commit**

```bash
npx supabase stop
git add supabase/migrations/0012_access_policy.sql supabase/functions/_shared/policy.vectors.json tests/integration/policy.test.ts
git commit -m "feat(access): policy_blocks, push RPC and RLS enforcement

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared policy helper and GW2 account lookup

**Files:**
- Create: `supabase/functions/_shared/policy.ts`
- Test: `supabase/functions/_shared/policy.test.ts`
- Modify: `supabase/functions/_shared/gw2.ts`, `supabase/functions/_shared/gw2.test.ts`

**Interfaces:**
- Consumes: the `policy_blocks` table from Task 1, and the vectors file.
- Produces (from `_shared/policy.ts`):
  - `type IdentityKind`
  - `interface PolicyIdentity { kind: IdentityKind; value: string | null | undefined }`
  - `normalizeIdentity(kind, value): string | null`
  - `hashIdentity(kind, value): Promise<string | null>`
  - `policyHashes(ids): Promise<string[]>`
  - `type BlockLookup = (hashes: string[]) => Promise<string[]>`
  - `policyLookup(db: { from(table: string): any }): BlockLookup`
  - `isBlocked(lookup: BlockLookup, ids: PolicyIdentity[]): Promise<boolean>`
  - `UNAVAILABLE`
  - `unavailableResponse(headers: Record<string, string>): Response`
- Produces (from `_shared/gw2.ts`): `fetchAccountName(fetchFn: typeof fetch, apiKey: string): Promise<string | null>`.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/policy.test.ts`:

```ts
import { test, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { webcrypto, createHash } from 'node:crypto'
import {
  hashIdentity, isBlocked, normalizeIdentity, policyHashes, policyLookup, unavailableResponse, UNAVAILABLE
} from './policy'
// @ts-expect-error expose WebCrypto for the module under test in Node
globalThis.crypto ??= webcrypto

const VECTORS = JSON.parse(readFileSync(new URL('./policy.vectors.json', import.meta.url), 'utf8')) as {
  valid: { kind: any; input: string; normalized: string; hash: string }[]
  invalid: { kind: any; input: string }[]
}
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

test('reproduces every valid vector', async () => {
  for (const v of VECTORS.valid) {
    expect(normalizeIdentity(v.kind, v.input)).toBe(v.normalized)
    expect(await hashIdentity(v.kind, v.input)).toBe(v.hash)
    expect(normalizeIdentity(v.kind, v.normalized)).toBe(v.normalized)
  }
})

test('invalid vectors normalize to null', async () => {
  for (const v of VECTORS.invalid) {
    expect(normalizeIdentity(v.kind, v.input)).toBeNull()
    expect(await hashIdentity(v.kind, v.input)).toBeNull()
  }
})

test('policyHashes skips missing and invalid values and de-duplicates', async () => {
  const hashes = await policyHashes([
    { kind: 'discord_user', value: '123456789012345678' },
    { kind: 'discord_user', value: ' 123456789012345678 ' },
    { kind: 'discord_user', value: null },
    { kind: 'gw2_guild', value: undefined },
    { kind: 'gw2_account', value: 'no number' }
  ])
  expect(hashes).toEqual([sha('discord_user:123456789012345678')])
})

test('isBlocked asks the lookup only when there is something to look up', async () => {
  const lookup = vi.fn(async () => [])
  expect(await isBlocked(lookup, [{ kind: 'discord_user', value: null }])).toBe(false)
  expect(lookup).not.toHaveBeenCalled()
})

test('isBlocked is true when any hash is listed', async () => {
  const listed = sha('gw2_guild:4bbb52aa-d768-4fc6-8ede-c299f2822f0f')
  const lookup = vi.fn(async (hashes: string[]) => hashes.filter((h) => h === listed))
  expect(await isBlocked(lookup, [
    { kind: 'discord_user', value: '123456789012345678' },
    { kind: 'gw2_guild', value: '4BBB52AA-D768-4FC6-8EDE-C299F2822F0F' }
  ])).toBe(true)
  expect(await isBlocked(lookup, [{ kind: 'discord_user', value: '123456789012345678' }])).toBe(false)
})

test('isBlocked fails open on a lookup error and logs it', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await isBlocked(async () => { throw new Error('db down') }, [{ kind: 'discord_user', value: '123456789012345678' }])).toBe(false)
  expect(err).toHaveBeenCalled()
  err.mockRestore()
})

test('policyLookup queries policy_blocks with the hashes', async () => {
  const inFn = vi.fn(async () => ({ data: [{ hash: 'h1' }], error: null }))
  const select = vi.fn(() => ({ in: inFn }))
  const from = vi.fn(() => ({ select }))
  expect(await policyLookup({ from })(['h1', 'h2'])).toEqual(['h1'])
  expect(from).toHaveBeenCalledWith('policy_blocks')
  expect(select).toHaveBeenCalledWith('hash')
  expect(inFn).toHaveBeenCalledWith('hash', ['h1', 'h2'])
})

test('policyLookup surfaces query errors to isBlocked', async () => {
  const from = () => ({ select: () => ({ in: async () => ({ data: null, error: new Error('nope') }) }) })
  await expect(policyLookup({ from })(['h'])).rejects.toThrow('nope')
})

test('unavailableResponse is a neutral 403 with the caller CORS headers', async () => {
  const r = unavailableResponse({ 'Access-Control-Allow-Origin': '*' })
  expect(r.status).toBe(403)
  expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*')
  expect(r.headers.get('Content-Type')).toBe('application/json')
  expect(await r.json()).toEqual(UNAVAILABLE)
  expect(UNAVAILABLE).toEqual({ error: 'unavailable', message: 'Access unavailable for this account.' })
})
```

Append to `supabase/functions/_shared/gw2.test.ts`. Add `fetchAccountName` to that file's existing import from `./gw2`, and add `vi` to its `vitest` import if it is missing:

```ts
test('fetchAccountName returns /v2/account name with the key as Bearer', async () => {
  const fetchFn = vi.fn(async () => new Response(JSON.stringify({ name: 'Name.1234', guilds: [] }), { status: 200 }))
  expect(await fetchAccountName(fetchFn as any, 'KEY')).toBe('Name.1234')
  expect(fetchFn).toHaveBeenCalledWith('https://api.guildwars2.com/v2/account', { headers: { Authorization: 'Bearer KEY' } })
})

test('fetchAccountName returns null on errors instead of throwing', async () => {
  expect(await fetchAccountName((async () => new Response('{}', { status: 401 })) as any, 'KEY')).toBeNull()
  expect(await fetchAccountName((async () => { throw new Error('net') }) as any, 'KEY')).toBeNull()
  expect(await fetchAccountName((async () => new Response('[]', { status: 200 })) as any, 'KEY')).toBeNull()
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run supabase/functions/_shared/policy.test.ts supabase/functions/_shared/gw2.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL. `./policy` cannot be resolved and `fetchAccountName` is not exported.

- [ ] **Step 3: Implement `supabase/functions/_shared/policy.ts`**

```ts
// supabase/functions/_shared/policy.ts
// Axi access policy for the edge functions. Access to the Axi apps can be
// revoked for people, GW2 guilds and Discord servers that violate their terms
// of use. The list lives in policy_blocks (pushed by the axi-config Worker, see
// migration 0012) as SHA-256 hashes of "kind:normalized" identifiers.
// Normalization is a port of darkharasho/axi-config and must reproduce
// policy.vectors.json exactly. Lookups fail open: RLS enforces regardless.

export const IDENTITY_KINDS = ['gw2_account', 'gw2_guild', 'discord_user', 'discord_server', 'github_user'] as const
export type IdentityKind = (typeof IDENTITY_KINDS)[number]

export interface PolicyIdentity {
  kind: IdentityKind
  value: string | null | undefined
}

const PATTERNS: Record<IdentityKind, RegExp> = {
  gw2_account: /^.+\.\d{4}$/u,
  gw2_guild: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  discord_user: /^\d{17,20}$/,
  discord_server: /^\d{17,20}$/,
  github_user: /^[1-9]\d{0,19}$/
}

export function normalizeIdentity(kind: IdentityKind, value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !(kind in PATTERNS)) return null
  const normalized = value.normalize('NFC').trim().toLowerCase().normalize('NFC')
  return PATTERNS[kind].test(normalized) ? normalized : null
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function hashIdentity(kind: IdentityKind, value: string | null | undefined): Promise<string | null> {
  const normalized = normalizeIdentity(kind, value)
  return normalized === null ? null : sha256Hex(`${kind}:${normalized}`)
}

export async function policyHashes(ids: PolicyIdentity[]): Promise<string[]> {
  const hashes = await Promise.all(ids.map((id) => hashIdentity(id.kind, id.value)))
  return [...new Set(hashes.filter((h): h is string => h !== null))]
}

export type BlockLookup = (hashes: string[]) => Promise<string[]>

// `db` is a service-role supabase client (policy_blocks is service-only).
export function policyLookup(db: { from(table: string): any }): BlockLookup {
  return async (hashes) => {
    const { data, error } = await db.from('policy_blocks').select('hash').in('hash', hashes)
    if (error) throw error
    return ((data ?? []) as { hash: string }[]).map((r) => r.hash)
  }
}

export async function isBlocked(lookup: BlockLookup, ids: PolicyIdentity[]): Promise<boolean> {
  const hashes = await policyHashes(ids)
  if (hashes.length === 0) return false
  try {
    return (await lookup(hashes)).length > 0
  } catch (err) {
    console.error('[policy] lookup failed; not refusing', err)
    return false
  }
}

export const UNAVAILABLE = { error: 'unavailable', message: 'Access unavailable for this account.' } as const

export function unavailableResponse(headers: Record<string, string>): Response {
  return new Response(JSON.stringify(UNAVAILABLE), {
    status: 403,
    headers: { ...headers, 'Content-Type': 'application/json' }
  })
}
```

- [ ] **Step 4: Add `fetchAccountName` to `supabase/functions/_shared/gw2.ts`**

Append:

```ts
// The account name for a GW2 API key, or null if it cannot be read. Used only
// for the access policy check; never throws.
export async function fetchAccountName(fetchFn: typeof fetch, apiKey: string): Promise<string | null> {
  try {
    const resp = await fetchFn('https://api.guildwars2.com/v2/account', {
      headers: { Authorization: `Bearer ${apiKey}` }
    })
    if (!resp.ok) return null
    const body = (await resp.json()) as { name?: unknown } | null
    return body && typeof body.name === 'string' ? body.name : null
  } catch {
    return null
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run supabase/functions/_shared --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/policy.ts supabase/functions/_shared/policy.test.ts supabase/functions/_shared/gw2.ts supabase/functions/_shared/gw2.test.ts
git commit -m "feat(access): shared policy lookup and GW2 account name helper

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Refuse revoked callers in the four edge functions

**Files:**
- Modify: `supabase/functions/claim-guild/handler.ts`, `claim-guild/index.ts`, `claim-guild/handler.test.ts`
- Modify: `supabase/functions/redeem-invite/handler.ts`, `redeem-invite/index.ts`, `redeem-invite/handler.test.ts`
- Modify: `supabase/functions/stamp-identity/index.ts`, `supabase/functions/share-keys/index.ts`
- Modify: `docs/DEPLOY.md`

**Interfaces:**
- Consumes from Task 2: `PolicyIdentity`, `isBlocked`, `policyLookup`, `UNAVAILABLE`, `unavailableResponse`, `fetchAccountName`.
- Produces:
  - `ClaimDeps` gains `blocked(ids: PolicyIdentity[]): Promise<boolean>` and `accountName(apiKey: string): Promise<string | null>`.
  - `RedeemDeps` gains `blocked(ids: PolicyIdentity[]): Promise<boolean>`.
  - A refusal is `{ status: 403, body: UNAVAILABLE }` from the handlers, or `unavailableResponse(corsHeaders)` from the index files.

- [ ] **Step 1: Write the failing handler tests**

In `supabase/functions/claim-guild/handler.test.ts`, add two entries to the object returned by `deps(owners)`:

```ts
    blocked: vi.fn(async () => false),
    accountName: vi.fn(async () => 'Name.1234'),
```

Then append these tests:

```ts
test('a revoked caller is refused before anything is verified or written', async () => {
  const d = deps(0)
  d.blocked = vi.fn(async () => true)
  const r = await handleClaim(d as any, input)
  expect(r).toEqual({ status: 403, body: { error: 'unavailable', message: 'Access unavailable for this account.' } })
  expect(d.verify).not.toHaveBeenCalled()
  expect(d.db.upsertWorkspace).not.toHaveBeenCalled()
  expect(d.db.insertMember).not.toHaveBeenCalled()
})

test('the check covers the Discord user, GW2 account, GW2 guild and Discord server', async () => {
  const d = deps(0)
  await handleClaim(d as any, { ...input, discordGuildId: '1100000000000000001' })
  expect(d.accountName).toHaveBeenCalledWith('k')
  expect(d.blocked).toHaveBeenCalledWith([
    { kind: 'discord_user', value: 'd1' },
    { kind: 'gw2_account', value: 'Name.1234' },
    { kind: 'gw2_guild', value: 'g' },
    { kind: 'discord_server', value: '1100000000000000001' }
  ])
})
```

In `supabase/functions/redeem-invite/handler.test.ts`, add `blocked: vi.fn(async () => false)` to the object returned by `deps(invite)`, next to `db`:

```ts
  return { blocked: vi.fn(async () => false), db: {
```

Then append:

```ts
test('a revoked caller or workspace is refused and the invite stays open', async () => {
  const d = deps({ id: 'i', workspace_id: 'g', role: 'write', code: null, discord_id: 'd1', redeemed_by: null })
  d.blocked = vi.fn(async () => true)
  const r = await handleRedeem(d as any, { userId: 'u', discordId: 'd1' })
  expect(r).toEqual({ status: 403, body: { error: 'unavailable', message: 'Access unavailable for this account.' } })
  expect(d.blocked).toHaveBeenCalledWith([
    { kind: 'discord_user', value: 'd1' },
    { kind: 'gw2_guild', value: 'g' }
  ])
  expect(d.db.insertMember).not.toHaveBeenCalled()
  expect(d.db.markRedeemed).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run supabase/functions/claim-guild supabase/functions/redeem-invite --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL. The new tests get 200 instead of 403.

- [ ] **Step 3: Implement the handler checks**

`supabase/functions/claim-guild/handler.ts`:

Add the import:

```ts
import { UNAVAILABLE, type PolicyIdentity } from '../_shared/policy.ts'
```

Add to `ClaimDeps`:

```ts
  blocked(ids: PolicyIdentity[]): Promise<boolean>
  accountName(apiKey: string): Promise<string | null>
```

At the top of `handleClaim`, before `deps.verify(...)`, insert:

```ts
  const accountName = await deps.accountName(input.apiKey)
  if (await deps.blocked([
    { kind: 'discord_user', value: input.discordId },
    { kind: 'gw2_account', value: accountName },
    { kind: 'gw2_guild', value: input.guildId },
    { kind: 'discord_server', value: input.discordGuildId }
  ])) {
    return { status: 403, body: UNAVAILABLE }
  }
```

`supabase/functions/redeem-invite/handler.ts`:

Add the import:

```ts
import { UNAVAILABLE, type PolicyIdentity } from '../_shared/policy.ts'
```

Add to `RedeemDeps`:

```ts
  blocked(ids: PolicyIdentity[]): Promise<boolean>
```

Directly after `if (!invite) return { status: 404, body: { error: 'no_invite' } }`, insert:

```ts
  if (await deps.blocked([
    { kind: 'discord_user', value: input.discordId },
    { kind: 'gw2_guild', value: invite.workspace_id }
  ])) {
    return { status: 403, body: UNAVAILABLE }
  }
```

The test files import the handlers without the `.ts` extension, while the handlers import `../_shared/policy.ts` with it. Vitest resolves both, the same as the existing `../_shared/claim.ts` imports.

- [ ] **Step 4: Wire the index files**

`supabase/functions/claim-guild/index.ts`:

Change the gw2 import and add the policy import:

```ts
import { fetchAccountName, verifyLeaderKey } from '../_shared/gw2.ts'
import { isBlocked, policyLookup } from '../_shared/policy.ts'
```

Add two entries to the `deps` object, next to `keySecret`:

```ts
    blocked: (ids: any) => isBlocked(policyLookup(db), ids),
    accountName: (key: string) => fetchAccountName(fetch, key),
```

`supabase/functions/redeem-invite/index.ts`:

Add the import:

```ts
import { isBlocked, policyLookup } from '../_shared/policy.ts'
```

Change `const deps = { db: {` to:

```ts
  const deps = { blocked: (ids: any) => isBlocked(policyLookup(db), ids), db: {
```

`supabase/functions/stamp-identity/index.ts`:

Add the import:

```ts
import { isBlocked, policyLookup, unavailableResponse } from '../_shared/policy.ts'
```

Directly after `const db = createClient(url, service)`, insert:

```ts
  // Axi access policy: a revoked user or workspace is not stamped or backfilled.
  if (await isBlocked(policyLookup(db), [
    { kind: 'discord_user', value: discordIdFromUser(user) },
    { kind: 'gw2_guild', value: body.guildId }
  ])) {
    return unavailableResponse(corsHeaders)
  }
```

`supabase/functions/share-keys/index.ts`:

Add the imports:

```ts
import { fetchAccountName } from '../_shared/gw2.ts'
import { discordIdFromUser } from '../_shared/identity.ts'
import { isBlocked, policyLookup, unavailableResponse } from '../_shared/policy.ts'
```

Directly after the `not_owner` line, insert:

```ts
  // Axi access policy: the owner, their GW2 account (when sharing a key), the
  // workspace's GW2 guild and its Discord server.
  const accountName = body.share && body.apiKey ? await fetchAccountName(fetch, body.apiKey) : null
  if (await isBlocked(policyLookup(db), [
    { kind: 'discord_user', value: discordIdFromUser(user) },
    { kind: 'gw2_account', value: accountName },
    { kind: 'gw2_guild', value: body.guildId },
    { kind: 'discord_server', value: body.discordGuildId }
  ])) {
    return unavailableResponse(corsHeaders)
  }
```

- [ ] **Step 5: Document deployment**

In `docs/DEPLOY.md`, replace the function list in section 4 with the full set:

```bash
supabase functions deploy axitools claim-guild delete-guild get-shared-keys list-invites redeem-invite refresh-roster respond-invite share-keys stamp-identity
```

Append a new section:

```markdown
## Access policy (Axi denylist)

Migration `0012_access_policy.sql` adds `policy_blocks`, which holds SHA-256
hashes of revoked identifiers and nothing else. The axi-config Worker fills it
through the `replace_policy_blocks` RPC. Give that Worker this project's URL and
a service key as its `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` secrets (see the
axi-config README).

Effects of a listed identifier:
- RLS denies listed users and the workspaces of listed GW2 guilds or Discord
  servers.
- `claim-guild`, `redeem-invite`, `stamp-identity` and `share-keys` answer
  403 `{"error":"unavailable"}`.
- A blocked user can still leave a workspace.

With an empty list nothing changes. Apply this migration and redeploy the four
functions together.
```

- [ ] **Step 6: Run the whole unit suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. The typecheck does not cover `supabase/functions`, but it must still pass.

- [ ] **Step 7: Integration smoke test against the local stack**

Start the local stack, then reset it, the same way as in Task 1, Steps 2 and 6:

```bash
systemctl --user start podman.socket
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock
npx supabase start && npx supabase db reset
```

Then run the integration suite with the env exports from Task 1, Step 4:

```bash
npm run test:integration -- --pool=forks --poolOptions.forks.maxForks=2
```

Expected: PASS.

Finally, stop the stack:

```bash
npx supabase stop
```

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/claim-guild supabase/functions/redeem-invite supabase/functions/stamp-identity/index.ts supabase/functions/share-keys/index.ts docs/DEPLOY.md
git commit -m "feat(access): refuse revoked callers in claim, redeem, stamp and share

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Operator follow-up (not part of implementation)

These steps change production and need the user's explicit go-ahead:
1. `supabase db push` (or merge to `main` if the GitHub integration applies migrations).
2. `supabase functions deploy ...` with the four changed functions.
3. In axi-config, set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` on the Worker.

Until axi-config pushes a non-empty list, nothing is refused.
