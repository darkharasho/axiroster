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
  if (typeof value !== 'string' || !Object.hasOwn(PATTERNS, kind)) return null
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
  try {
    const hashes = await policyHashes(ids)
    if (hashes.length === 0) return false
    return (await lookup(hashes)).length > 0
  } catch (err) {
    console.error('[policy] lookup failed; not refusing', err)
    return false
  }
}

// For functions that act through the service role on behalf of an existing
// member: ask the RLS predicate is_member(ws) itself, as the caller, so the
// edge check and RLS cannot drift. `userDb` must carry the caller's JWT. Call
// it only once membership is established: for a member, false means revoked.
// Fails open (true) on an RPC error; RLS still enforces.
type RpcClient = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
export function rlsMember(userDb: RpcClient): (ws: string) => Promise<boolean> {
  return async (ws) => {
    try {
      const { data, error } = await userDb.rpc('is_member', { ws })
      if (error) throw error
      return data !== false
    } catch (err) {
      console.error('[policy] is_member check failed; not refusing', err)
      return true
    }
  }
}

// The workspace's STORED Discord server (workspaces.discord_guild_id), so a
// check never depends on a client-supplied value. `db` is a service-role
// client. A read error yields null (the check proceeds without it) and is logged.
export function workspaceDiscordServer(db: { from(table: string): any }): (ws: string) => Promise<string | null> {
  return async (ws) => {
    try {
      const { data, error } = await db.from('workspaces').select('discord_guild_id').eq('workspace_id', ws).maybeSingle()
      if (error) throw error
      return (data as { discord_guild_id?: string | null } | null)?.discord_guild_id ?? null
    } catch (err) {
      console.error('[policy] workspace lookup failed; checking without its Discord server', err)
      return null
    }
  }
}

export const UNAVAILABLE = { error: 'unavailable', message: 'Access unavailable for this account.' } as const

export function unavailableResponse(headers: Record<string, string>): Response {
  return new Response(JSON.stringify(UNAVAILABLE), {
    status: 403,
    headers: { ...headers, 'Content-Type': 'application/json' }
  })
}
