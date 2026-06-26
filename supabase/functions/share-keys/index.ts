import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encryptKey } from '../_shared/crypto.ts'

// Owner-only: turn key sharing on/off for a workspace. When on, the GW2 +
// AxiTools keys are stored encrypted (workspace_secrets) and the guild metadata
// + keys_shared flag are set on workspaces, so members can adopt them.
Deno.serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const keySecret = Deno.env.get('LEADER_KEY_SECRET')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
  })
  const {
    data: { user }
  } = await userClient.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await req.json().catch(() => ({}))) as {
    guildId?: string
    share?: boolean
    apiKey?: string
    axitoolsKey?: string
    gw2GuildName?: string
    discordGuildId?: string
    discordGuildName?: string
    memberRoleId?: string
    bridgeRepos?: unknown
  }
  if (!body.guildId) return json({ error: 'guildId required' }, 400)

  const db = createClient(url, service)
  const { data: m } = await db
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', body.guildId)
    .eq('user_id', user.id)
    .maybeSingle()
  if ((m as { role?: string } | null)?.role !== 'owner') return json({ error: 'not_owner' }, 403)

  if (body.share) {
    if (!body.apiKey) return json({ error: 'apiKey required' }, 400)
    const secretRow: Record<string, unknown> = {
      workspace_id: body.guildId,
      leader_key_enc: await encryptKey(body.apiKey, keySecret),
      axitools_key_enc: body.axitoolsKey ? await encryptKey(body.axitoolsKey, keySecret) : null
    }
    const { error: e1 } = await db.from('workspace_secrets').upsert(secretRow)
    if (e1) return json({ error: e1.message }, 500)
    const wsUpdate: Record<string, unknown> = { keys_shared: true, has_leader_key: true }
    if (body.gw2GuildName != null) wsUpdate.guild_name = body.gw2GuildName
    if (body.discordGuildId != null) wsUpdate.discord_guild_id = body.discordGuildId
    if (body.discordGuildName != null) wsUpdate.discord_guild_name = body.discordGuildName
    if (body.memberRoleId != null) wsUpdate.member_role_id = body.memberRoleId
    if (Array.isArray(body.bridgeRepos)) wsUpdate.bridge_repos = body.bridgeRepos
    const { error: e2 } = await db.from('workspaces').update(wsUpdate).eq('workspace_id', body.guildId)
    if (e2) return json({ error: e2.message }, 500)
    return json({ ok: true, shared: true })
  }

  await db.from('workspace_secrets').update({ axitools_key_enc: null }).eq('workspace_id', body.guildId)
  await db.from('workspaces').update({ keys_shared: false }).eq('workspace_id', body.guildId)
  return json({ ok: true, shared: false })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
