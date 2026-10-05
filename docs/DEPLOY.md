# Maintainer deploy guide

This is a **one-time setup** for whoever owns the shared Supabase project that
all AxiRoster users connect to. End users do not need to do any of this.

---

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed and logged in
  (`supabase login`)
- A Discord application with OAuth2 enabled
- `openssl` (or any tool that can generate 32 random bytes)

---

## 1. Create the Supabase project

1. Go to <https://supabase.com> and create a new project (free tier is fine).
2. Note the **Project URL** and **anon public** key from
   Project Settings → API. You will bundle these into the app build.
3. Link the CLI to your project:
   ```bash
   supabase link --project-ref <your-project-ref>
   ```

---

## 2. Apply database migrations

Push the schema and RLS policies:

```bash
supabase db push
```

This applies all files in `supabase/migrations/`, in order.

> **GitHub integration:** if you connect the Supabase project to this repo via
> the Supabase GitHub integration, migrations are applied automatically on push
> to the main branch — no manual `db push` needed after the first time.

---

## 3. Generate and set the leader key encryption secret

The `axitools`, `claim-guild`, `get-shared-keys`, `refresh-roster` and
`share-keys` edge functions encrypt/decrypt the stored GW2 leader key and
AxiTools key using AES-GCM. They need a 32-byte secret available as
`LEADER_KEY_SECRET`.

Generate the secret:

```bash
openssl rand -base64 32
```

Set it in Supabase:

```bash
supabase secrets set LEADER_KEY_SECRET=<output from above>
```

Keep a copy of this value somewhere safe (e.g. your password manager). If it
is lost, existing encrypted leader keys cannot be decrypted and guild owners
will need to re-claim their guilds.

---

## 4. Deploy edge functions

```bash
supabase functions deploy axitools claim-guild delete-guild get-shared-keys list-invites redeem-invite refresh-roster respond-invite share-keys stamp-identity
```

These functions live under `supabase/functions/`. Re-run this command
whenever the function code changes.

---

## 5. Enable Discord OAuth

1. In your **Discord Developer Portal**, create (or open) an application.
2. Under **OAuth2 → Redirects**, add:
   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
3. Note the **Client ID** and **Client Secret**.
4. In the Supabase dashboard, go to **Authentication → Providers → Discord**:
   - Enable the provider.
   - Paste the Discord Client ID and Client Secret.
   - Set the **Redirect URL** to:
     ```
     axiroster://auth-callback
     ```
   - Save.
5. Back in the Discord Developer Portal, also add `axiroster://auth-callback`
   as a redirect URI (Discord requires the exact URI the app will use).

---

## 6. Bundle the Supabase config into the app build

AxiRoster reads the Supabase URL and anon key from environment variables at
build time:

| Variable | Value |
|----------|-------|
| `VITE_SUPABASE_URL` | Your project URL, e.g. `https://abcdef.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Your anon public key |

Create (or update) a `.env` file in the repo root:

```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

These values are baked into the production bundle by electron-vite. The anon
key is intentionally public — RLS policies, not key secrecy, are the security
boundary.

Then build and package as usual:

```bash
npm run build
npm run dist:mac   # or :win / :linux
```

---

## 7. Integration tests

Integration tests run against a real Supabase instance (local or hosted).

**Local (Docker):**

```bash
supabase start          # starts a local Supabase stack via Docker
npm run test:integration
```

**Hosted project:**

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_ANON_KEY=<anon-key> \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
npm run test:integration
```

The service role key is only needed for integration tests that seed or inspect
data directly (bypassing RLS); it must never appear in the shipped app.

> **Warning:** `tests/integration/policy.test.ts` only runs against a local
> stack (`SUPABASE_URL` on `127.0.0.1` or `localhost`) and is skipped otherwise:
> it replaces the access-policy list, which on a hosted project would wipe the
> real list and make the axi-config Worker's later pushes look stale.

---

## Quick-reference checklist

- [ ] Supabase project created and CLI linked
- [ ] `supabase db push` run (migrations applied)
- [ ] `LEADER_KEY_SECRET` generated and set via `supabase secrets set`
- [ ] Edge functions deployed (`axitools`, `claim-guild`, `delete-guild`,
      `get-shared-keys`, `list-invites`, `redeem-invite`, `refresh-roster`,
      `respond-invite`, `share-keys`, `stamp-identity`)
- [ ] Discord OAuth provider enabled in Supabase; redirect URIs set in both
      Supabase and the Discord Developer Portal
- [ ] `.env` with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in place
- [ ] App built and distributed

## Access policy (Axi denylist)

Migration `0012_access_policy.sql` adds `policy_blocks`, which holds SHA-256
hashes of revoked identifiers and nothing else. The axi-config Worker fills it
through the `replace_policy_blocks` RPC. Give that Worker this project's URL and
a service key as its `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` secrets (see the
axi-config README).

Effects of a listed identifier:
- RLS denies listed users and the workspaces of listed GW2 guilds or Discord
  servers.
- `claim-guild`, `redeem-invite`, `respond-invite` (accepting), `stamp-identity`
  and `share-keys` (turning sharing on) answer 403 `{"error":"unavailable"}`.
  So do `get-shared-keys`, `axitools` (with the stored key) and `refresh-roster`
  for a member that RLS's `is_member` now rejects.
- A blocked user can still leave a workspace, and an owner can still turn key
  sharing off.

With an empty list nothing changes. Redeploy those eight functions with this
migration (the full deploy command in section 4 covers them).

### Rollout order and off switch

Merging to main applies `0012` through the Supabase GitHub integration, while
the functions are deployed by hand, so the two land at different times. Either
order is safe: functions deployed first fail open (they log with
`console.error` and refuse nobody) until the table exists; the migration applied
first enforces through RLS, and the older functions simply don't check. To lift
a revocation, unban in axi-config. A manual `delete from policy_blocks` is
overwritten by the Worker's next push.
