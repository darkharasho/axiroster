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
