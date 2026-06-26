# Shared sync setup (Supabase)

AxiRoster's roster annotations (tags, notes, nicknames), manual Discord↔GW2
links, and synced roster data are shared live across a guild's leadership via
a single maintainer-owned Supabase project. You do **not** need to create your
own Supabase project — the app ships with the connection already bundled.

One **workspace** = one guild (keyed on the GW2 guild id).

---

## How it works

### Identity: sign in with Discord

Click **Sign in with Discord** in the app. AxiRoster uses Discord OAuth (via
Supabase Auth, PKCE flow). Your Discord account becomes your identity — no
separate username or password is required.

### Authorization: GW2 guild leader claims the guild

The first time someone wants to use shared sync for a guild, a guild **leader**
must claim it. Only a leader's GW2 API key can read `/v2/guild/:id/members`.
AxiRoster verifies this server-side:

1. Sign in with Discord.
2. In **Settings → Shared sync**, click **Claim this guild**.
3. AxiRoster calls the `claim-guild` edge function with your GW2 leader key.
4. The function verifies the key has leader access to that guild, then stores
   it **encrypted** (AES-GCM) in the backend. The raw key is never returned to
   any client.

The claiming leader becomes the guild's **owner**.

### Roles

| Role | What they can do |
|------|-----------------|
| `owner` | Everything — manage members, rotate the leader key, edit guild config |
| `write` | Edit annotations and links (tags, notes, nicknames, Discord↔GW2 links) |
| `read` | View the roster and annotations; no edits |

Roles are enforced by Row Level Security on the Supabase side — the anon key
alone does not bypass them.

### Inviting officers (owner only)

Owners can grant access to other officers in two ways:

- **Pick from Discord roster** — choose a person who is already in your
  Discord server (matched on Discord id) and assign them a role.
- **Generate an invite code** — send the code to your officer; they enter it
  in the app after signing in with Discord.

Either way, when the person redeems the invite their workspace membership is
created at the role the owner chose.

### Roster sync

- **Leaders** (owner or anyone with a live leader GW2 key) can pull
  `/v2/guild/:id/members` directly and push it to the shared roster.
- **Officers** (write/read roles, no leader key) see the last synced roster
  automatically — the `refresh-roster` edge function decrypts the stored
  leader key and upserts the roster on their behalf.
- Annotations and links sync last-write-wins on `updated_at`. Realtime
  subscriptions push remote changes to all connected clients immediately.

---

## Conflict handling

Writes are last-write-wins on `updated_at`. For tags/notes edited by a
handful of officers this is sufficient. If two people edit the *same* member's
notes at the same second, the later write wins — there is no field-level
merge.

---

## Security model

- The anon key and project URL ship in the app binary — this is intentional.
  The anon key is public by Supabase design; **RLS policies are the security
  boundary**, not key secrecy.
- The leader GW2 key is stored server-side only, encrypted with a secret that
  exists only in the edge function environment. No client ever receives it.
- Discord OAuth (not a shared secret) establishes who you are; your
  `workspace_members` row determines what you can do.

---

## Database tables

| Table | Purpose |
|-------|---------|
| `workspaces` | One row per guild (workspace_id = GW2 guild id) |
| `workspace_secrets` | Encrypted leader key (edge-function read only) |
| `workspace_members` | Discord user → role mapping per workspace |
| `workspace_invites` | Pending invite codes / Discord-pick invites |
| `roster_members` | Synced GW2 guild member list |
| `roster_annotations` | Tags, notes, nicknames, main account per member |
| `roster_links` | Manual Discord↔GW2 account links |

Migrations live in `supabase/migrations/` and are applied by the maintainer
(see [docs/DEPLOY.md](DEPLOY.md)).
