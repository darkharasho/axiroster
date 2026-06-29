import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, preflight } from '../_shared/cors.ts'

// Owner-only, destructive: permanently delete a workspace. Every child table FKs
// workspaces(workspace_id) ON DELETE CASCADE, so deleting the workspaces row wipes
// all roster/member/invite/secret/audit/retention data. Cascade runs privileged
// (child RLS bypassed). Service-role is required because there is no ws_delete RLS.
Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
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
    .select('role')
    .eq('workspace_id', body.guildId)
    .eq('user_id', user.id)
    .maybeSingle()
  if ((m as { role?: string } | null)?.role !== 'owner') return json({ error: 'not_owner' }, 403)

  const { error } = await db.from('workspaces').delete().eq('workspace_id', body.guildId)
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true }, 200)
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}
