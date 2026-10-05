import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isBlocked, policyLookup, workspaceDiscordServer } from '../_shared/policy.ts'
import { handleStamp } from './handler.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'

// Stamps Discord names onto the caller's membership rows and, for a workspace
// they belong to, backfills every member's (see handler.ts).
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

  const body = (await req.json().catch(() => ({}))) as { guildId?: string }
  const db = createClient(url, service)
  const r = await handleStamp({
    blocked: (ids) => isBlocked(policyLookup(db), ids),
    serverOf: workspaceDiscordServer(db),
    db: {
      stampSelf: async (uid, names) => {
        await db.from('workspace_members').update(names).eq('user_id', uid)
      },
      isMember: async (ws, uid) => {
        const { data: me } = await db
          .from('workspace_members')
          .select('user_id')
          .eq('workspace_id', ws)
          .eq('user_id', uid)
          .maybeSingle()
        return !!me
      },
      memberIds: async (ws) => {
        const { data: members } = await db.from('workspace_members').select('user_id').eq('workspace_id', ws)
        return (members ?? []).map((m) => String((m as { user_id: string }).user_id))
      },
      getUser: async (uid) => {
        const { data: got } = await db.auth.admin.getUserById(uid)
        return (got?.user ?? null) as never
      },
      stampMember: async (ws, uid, row) => {
        await db.from('workspace_members').update(row).eq('workspace_id', ws).eq('user_id', uid)
      }
    }
  }, { user, guildId: body.guildId })
  return json(r.body, r.status)
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
