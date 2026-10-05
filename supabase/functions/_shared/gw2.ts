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
