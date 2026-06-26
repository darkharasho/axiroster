import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptKey } from '../_shared/crypto.ts'

// Member-only: if the workspace shares its keys, return the decrypted GW2 +
// AxiTools keys and guild metadata so the member's app can adopt a guild profile.
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

  const body = (await req.json().catch(() => ({}))) as { guildId?: string }
  if (!body.guildId) return json({ error: 'guildId required' }, 400)

  const db = createClient(url, service)
  const { data: m } = await db
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', body.guildId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!m) return json({ error: 'not_member' }, 403)

  const { data: ws } = await db
    .from('workspaces')
    .select('keys_shared, guild_name, discord_guild_id, discord_guild_name')
    .eq('workspace_id', body.guildId)
    .maybeSingle()
  if (!ws?.keys_shared) return json({ shared: false })

  const { data: sec } = await db
    .from('workspace_secrets')
    .select('leader_key_enc, axitools_key_enc')
    .eq('workspace_id', body.guildId)
    .maybeSingle()

  return json({
    shared: true,
    apiKey: sec?.leader_key_enc ? await decryptKey(sec.leader_key_enc, keySecret) : null,
    axitoolsKey: sec?.axitools_key_enc ? await decryptKey(sec.axitools_key_enc, keySecret) : null,
    gw2GuildId: body.guildId,
    gw2GuildName: ws.guild_name ?? '',
    discordGuildId: ws.discord_guild_id ?? '',
    discordGuildName: ws.discord_guild_name ?? ''
  })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
