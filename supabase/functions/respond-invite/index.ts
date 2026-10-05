import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { discordIdFromUser } from '../_shared/identity.ts'
import { type Invite } from '../_shared/invite.ts'
import { isBlocked, policyLookup, workspaceDiscordServer } from '../_shared/policy.ts'
import { handleRespond } from './handler.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'

// The invitee accepts or rejects a specific invite. A user may only act on an
// unredeemed invite that targets THEIR immutable Discord id (canRespond).
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

  const body = (await req.json().catch(() => ({}))) as { inviteId?: string; action?: string }
  const db = createClient(url, service)
  const r = await handleRespond({
    blocked: (ids) => isBlocked(policyLookup(db), ids),
    serverOf: workspaceDiscordServer(db),
    db: {
      getInvite: async (id) => {
        const { data } = await db.from('workspace_invites').select('*').eq('id', id).maybeSingle()
        return data as Invite | null
      },
      upsertMember: async (row) => {
        const { error } = await db.from('workspace_members').upsert(row)
        if (error) throw new Error(error.message)
      },
      markRedeemed: async (id, uid) => {
        await db
          .from('workspace_invites')
          .update({ redeemed_by: uid, redeemed_at: new Date().toISOString() })
          .eq('id', id)
      },
      deleteInvite: async (id) => {
        await db.from('workspace_invites').delete().eq('id', id)
      }
    }
  }, { userId: user.id, discordId: discordIdFromUser(user), inviteId: body.inviteId, action: body.action })
  return json(r.body, r.status)
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}
