import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { discordIdFromUser } from '../_shared/identity.ts'
import { canRespond, type Invite } from '../_shared/invite.ts'
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
  const discordId = discordIdFromUser(user)

  const body = (await req.json().catch(() => ({}))) as { inviteId?: string; action?: string }
  if (!body.inviteId || (body.action !== 'accept' && body.action !== 'reject')) {
    return json({ error: 'inviteId and action (accept|reject) required' }, 400)
  }

  const db = createClient(url, service)
  const { data: invite } = await db
    .from('workspace_invites')
    .select('*')
    .eq('id', body.inviteId)
    .maybeSingle()
  if (!canRespond(invite as Invite | null, discordId)) {
    return json({ error: 'invite not available' }, 404)
  }
  const inv = invite as Invite

  if (body.action === 'accept') {
    const { error: mErr } = await db.from('workspace_members').upsert({
      workspace_id: inv.workspace_id,
      user_id: user.id,
      discord_id: discordId,
      role: inv.role
    })
    if (mErr) return json({ error: mErr.message }, 500)
    await db
      .from('workspace_invites')
      .update({ redeemed_by: user.id, redeemed_at: new Date().toISOString() })
      .eq('id', inv.id)
    return json({ ok: true, workspaceId: inv.workspace_id, role: inv.role })
  }

  // reject: drop the pending invite
  await db.from('workspace_invites').delete().eq('id', inv.id)
  return json({ ok: true, rejected: true })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}
