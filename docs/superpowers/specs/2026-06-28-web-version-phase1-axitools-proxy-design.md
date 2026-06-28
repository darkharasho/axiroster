# Web Version — Phase 1: AxiTools/Discord Proxy Edge Function

**Date:** 2026-06-28
**Status:** Approved (design)

## Background & Goal

AxiRoster is an Electron desktop app for Guild Wars 2 WvW guild leadership. The
multi-phase goal is a **web companion sharing one core** with the desktop app,
with **Supabase as the single source of truth** (see the Phase 0 spec).

**Phase 1's job:** give a future web client (Phase 2) a server-side path for the
operations a browser **cannot** perform itself, without standing up new
infrastructure.

### Why this supersedes the original "Node server" framing

The original multi-phase plan described Phase 1 as "wrap `src/main` in a hosted
Node server." That framing is now outdated: the repo **already has a Supabase
Edge Functions backend** (Deno) that does exactly the authenticated,
secret-holding server work Phase 1 was meant to build —
`refresh-roster` (server-side GW2 roster pull with the decrypted key),
`claim-guild`, `share-keys`/`get-shared-keys`, the invite functions,
`stamp-identity` — each with a testable `handler.ts` + injected-deps +
`handler.test.ts` pattern. The desktop app already invokes these.

So Phase 1 **extends the existing Edge Functions backend** rather than adding a
parallel Node server. This was an explicit decision (Approach A): the codebase
already chose Edge Functions, JWT validation and secret handling are already
solved there, and it adds zero new deploy target or operational burden.

### What actually needs a server (and what doesn't)

After Phase 0, the web client can talk to Supabase **directly via RLS** for most
domains (annotations, links, roster_members, pipeline, tags, settings, invites).
A server is only required where a secret key the browser must not hold is
involved, or where there is no CORS path:

- **GW2 roster pull on behalf of a member without their own key** — uses the
  workspace's *shared* GW2 key. Already done: `refresh-roster`.
- **AxiTools/Discord operations** — the AxiTools bot's HTTP API is self-hosted
  with no CORS, and its key is workspace-shared. **This is the gap Phase 1
  fills.**
- **GW2 key validation in the add-guild flow** — the user's *own* key, validated
  in their *own* browser. `api.guildwars2.com` is CORS-enabled
  (`Access-Control-Allow-Origin: *`), so the web client does this
  **browser-direct**. No function needed.

## Scope

**In scope:** one new Edge Function, `axitools`, that proxies the AxiTools
operations the desktop exposes, authenticated by the Supabase JWT, resolving the
AxiTools key either from a caller-supplied candidate (validation) or from the
workspace's stored encrypted key (stored mode).

**Explicitly out of scope / deferred:**

- **Audit polling** (GW2 `guildLog` + AxiTools `auditDiscord`) — a
  scheduling/triggering problem, its own later phase.
- **Attendance / AxiBridge** retention feed.
- A `gw2-account` function — unnecessary; GW2 validation is browser-direct.
- **Any `src/main` or renderer change.** The desktop keeps its existing local
  `axitoolsClient` path; converging the desktop onto these functions is a later,
  separate step (like the Phase 2 renderer seam). Phase 1 is backend-only and
  ships independently.
- The Phase 2 web client itself. Nothing in Phase 1 presupposes it exists.
- **No DB migration / schema change.** Reads existing `workspace_members` and
  `workspace_secrets` only.

## Architecture

**One new Deno Edge Function: `axitools`** (`supabase/functions/axitools/`),
following the exact `refresh-roster` shape — a thin `index.ts` (`Deno.serve`,
JWT check, env, builds injected deps) over a pure, unit-tested `handler.ts`,
plus two new `_shared` units it depends on.

It **multiplexes** the AxiTools operations by an `op` field:
`listGuilds`, `guildRoles`, `discordOverview`, `membersLinked`, `discordAction`.

### Key-resolution modes

Mirrors the desktop's optional-`key?` IPC signatures:

- **Validation mode** — request carries a candidate `axt1.…` key (add-guild
  flow). The function uses *that* key directly; no workspace/secret lookup.
  Authorized for **any signed-in user** (they are validating a key they hold).
- **Stored mode** — request carries a `workspaceId`, no key. The function loads
  `workspace_secrets.axitools_key_enc`, decrypts it with `LEADER_KEY_SECRET`,
  and requires the caller be a **member** of that workspace (and
  **write-capable** for the `discordAction` write).

Presence of `key` in the body selects validation mode; otherwise stored mode.

### Derived shapes stay client-side

The desktop computes some derived shapes locally that the proxy does **not**
replicate: `boundGw2Guilds` (= `parseBoundGw2Guilds(guildRoles(...))`) and the
filtered `discord:members` list (= parse of `discordOverview(..., true)`). The
proxy returns the **raw AxiTools JSON**; Phase 2 reuses those parsers in shared
core. This keeps the proxy a pure pass-through.

## Request / Response Contract

**Request** — `POST`, JSON body, `Authorization: Bearer <supabase-jwt>` header:

```jsonc
{
  "op": "listGuilds" | "guildRoles" | "discordOverview" | "membersLinked" | "discordAction",
  "key": "axt1.…",        // optional — presence selects validation mode
  "workspaceId": "…",      // required in stored mode (key absent)
  "guildId": "…",          // Discord guild id; required for all ops except listGuilds
  "includeMembers": true,  // discordOverview only
  "action": "role_assign", // discordAction only
  "params": { }            // discordAction only
}
```

**Success:** `200` with `{ "data": <raw AxiTools response> }`. The `{ data }`
wrapper keeps a stable envelope even when AxiTools returns a bare array (e.g.
`listGuilds`).

**Error:** `{ "error": "<code>" }` (plus `message` on `upstream_error`).

### Per-op key-mode & authorization

| op | modes | stored-mode auth |
|----|-------|------------------|
| `listGuilds` | validation or stored | member |
| `guildRoles` | validation or stored | member |
| `discordOverview` | validation or stored | member |
| `membersLinked` | validation or stored | member |
| `discordAction` | **stored only** (write) | **write-capable** |

- Validation mode (any op except `discordAction`) needs only a signed-in user.
- `discordAction` is a mutation on the workspace's shared bot: **stored mode
  only**, and the caller's role must be in the **same write-capable set that
  RLS's `can_write()` grants**. The exact role values are pinned from the
  migration in the implementation plan, not guessed in this spec.

### Error mapping

| status | code | when |
|--------|------|------|
| 401 | `unauthorized` | no / invalid JWT (`auth.getUser()` returns no user) |
| 400 | `bad_request` | missing/unknown `op`, missing `guildId`/`workspaceId`, malformed `axt1.` key |
| 403 | `not_member` / `not_authorized` | stored-mode caller isn't a member / lacks write for `discordAction` |
| 409 | `no_key` | stored mode, workspace has no `axitools_key_enc` |
| 502 | `upstream_error` | AxiTools bot unreachable or non-OK; carries the `AxitoolsError` message in `message` |
| 200 | — | success, `{ data }` |

The `502` path reuses the ported client's existing error semantics (timeout →
"bot did not respond"; bot `401`/`403` → "key rejected").

## File Structure

All under `supabase/functions/`:

```
_shared/
  axivaleKey.ts        # port of parseAxitoolsKey: axt1.<b64url(baseUrl)>.<secret> → {baseUrl, token}
                       #   uses atob/TextDecoder (Deno + Node safe), NO Node Buffer
  axivaleKey.test.ts   # valid key, wrong prefix, bad base64, non-http URL, trailing-slash trim
  axitools.ts          # port of AxitoolsClient: injected fetch; listGuilds/guildRoles/
                       #   discordOverview/membersLinked/discordAction; same Bearer + error semantics
  axitools.test.ts     # each method's path/verb/body; 204→undefined; non-OK→AxitoolsError; 401/403 message
axitools/
  handler.ts           # pure handleAxitools(deps, input): key-mode resolution, authz, client call, result→{status,body}
  handler.test.ts      # mode selection, per-op authz (member/write/none), no_key, bad_request, upstream passthrough
  index.ts             # Deno.serve: JWT getUser, env, build deps (db + decrypt + fetch-backed client), call handler
```

### `handler.ts` injected deps

Mirrors `refresh-roster`'s shape, extended for role + the AxiTools secret:

```ts
interface AxitoolsDeps {
  decrypt: (enc: string, secret: string) => Promise<string>
  keySecret: string
  client: (baseUrl: string, token: string) => AxitoolsClientLike  // the _shared/axitools.ts port
  db: {
    role(ws: string, uid: string): Promise<string | null>         // null = not a member
    getAxitoolsSecret(ws: string): Promise<string | null>          // axitools_key_enc or null
  }
}
```

`role()` collapses membership + the write-gate into one lookup
(`workspace_members.role`): `null` → 403 `not_member`; a non-write role on
`discordAction` → 403 `not_authorized`.

## Testing

Unit tests run under the existing `npm test` (vitest,
`--pool=forks --poolOptions.forks.maxForks=2`), exactly like today's
`_shared/*.test.ts` and `*/handler.test.ts`:

- `handler.ts`, `_shared/axitools.ts`, and `_shared/axivaleKey.ts` are all pure /
  dependency-injected (no `esm.sh`, no Deno globals), fully covered with fakes.
- `index.ts` — the only Deno-only file (`Deno.serve` + `esm.sh` `createClient`) —
  has **no unit test**, matching every existing `index.ts`. It is verified at
  deploy time, via the Phase-2 client, and an optional manual `curl`.

TDD throughout (failing test → minimal implementation → pass).

**Coverage targets:**

- `_shared/axivaleKey` — valid `axt1.` key parses to `{baseUrl, token=rawKey}`;
  wrong prefix / wrong part count / empty secret / bad base64 / non-http(s) URL
  all return `null`; trailing slashes trimmed from `baseUrl`.
- `_shared/axitools` — every method hits the correct path + verb (incl.
  `discordOverview` `?include=members`, `discordAction` POST body
  `{action, params}`); `204` → `undefined`; non-OK → `AxitoolsError`; bot
  `401`/`403` surfaces the "key rejected" message.
- `axitools/handler` — validation vs stored mode selection; per-op authz
  (member-only reads, write-gated `discordAction`, validation-mode any user);
  `no_key` (409), `bad_request` (400, unknown op / missing ids / malformed key),
  `not_member` / `not_authorized` (403), success `{ data }` passthrough,
  `upstream_error` (502) carrying the message.

## Deployment

Deploys with the existing toolchain — `supabase functions deploy axitools` (or a
deploy-all). **No new secrets:** reuses the env every function already has
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`LEADER_KEY_SECRET`). No new infrastructure, no new deploy target.

The final implementation task documents the deploy command and a manual `curl`
smoke (a validation-mode `listGuilds` with a real `axt1.` key, and a stored-mode
call) since `index.ts` has no unit test.

## How Phase 2 Will Consume It

(Not built now — confirming the seam.) The web client calls
`supabase.functions.invoke('axitools', { body: { op, … } })` with the session
JWT attached automatically — the same path the desktop already uses for
`refresh-roster`/`claim-guild`. Phase 2 ports the small parsers
(`parseBoundGw2Guilds`, the `discord:members` filter) to shared core and applies
them to the `{ data }` passthrough.

## Out of Scope (Phase 1)

- Audit polling, attendance/AxiBridge.
- A `gw2-account` / GW2 proxy function (GW2 validation is browser-direct).
- Any `src/main` or renderer change; converging the desktop onto these functions.
- The Phase 2 web client, web shell, and web auth.
- Any DB migration or schema change.
