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
