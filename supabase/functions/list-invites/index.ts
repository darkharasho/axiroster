import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { discordIdFromUser } from '../_shared/identity.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'

// Returns the caller's pending invites (keyed to their immutable Discord id),
// enriched with the guild name. RLS can't expose invites to the invitee (the
// Discord id isn't a trustworthy JWT claim), so this runs with the service role.
Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
  })
  const {
    data: { user }
  } = await userClient.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401)
  const discordId = discordIdFromUser(user)
  if (!discordId) return json({ invites: [] })

  const db = createClient(url, service)
  const { data: invites, error } = await db
    .from('workspace_invites')
    .select('id, workspace_id, role')
    .eq('discord_id', discordId)
    .is('redeemed_by', null)
  if (error) return json({ error: error.message }, 500)

  const wsIds = [...new Set((invites ?? []).map((i) => i.workspace_id as string))]
  const { data: ws } = wsIds.length
    ? await db.from('workspaces').select('workspace_id, guild_name').in('workspace_id', wsIds)
    : { data: [] as { workspace_id: string; guild_name: string }[] }
  const nameById = new Map((ws ?? []).map((w) => [w.workspace_id, w.guild_name]))

  const result = (invites ?? []).map((i) => ({
    id: i.id,
    workspaceId: i.workspace_id,
    role: i.role,
    guildName: nameById.get(i.workspace_id as string) || (i.workspace_id as string)
  }))
  return json({ invites: result })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}
