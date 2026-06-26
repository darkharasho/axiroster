import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { discordIdFromUser, discordNamesFromUser } from '../_shared/identity.ts'

// Stamps Discord username + display name onto workspace_members rows so the
// member-management panel shows real names instead of raw Discord ids (which
// happened when the AxiTools bot roster couldn't resolve them).
//
// The caller's own row is always stamped from their token. If a guildId is
// given and the caller belongs to it, EVERY member of that workspace is
// backfilled by reading their trustworthy auth.identities via the admin API —
// so the owner opening the app once repopulates names for everyone.
Deno.serve(async (req) => {
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

  // Always stamp the caller's own membership rows from their own identity.
  const self = discordNamesFromUser(user)
  await db
    .from('workspace_members')
    .update({ discord_username: self.username, discord_global_name: self.globalName })
    .eq('user_id', user.id)

  let stamped = 1
  if (body.guildId) {
    // Confirm the caller actually belongs to the workspace before reading peers.
    const { data: me } = await db
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', body.guildId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (me) {
      const { data: members } = await db
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', body.guildId)
      for (const m of members ?? []) {
        const uid = String((m as { user_id: string }).user_id)
        if (uid === user.id) continue
        const { data: got } = await db.auth.admin.getUserById(uid)
        const u = got?.user
        if (!u) continue
        const names = discordNamesFromUser(u as never)
        const discordId = discordIdFromUser(u as never)
        await db
          .from('workspace_members')
          .update({
            discord_id: discordId,
            discord_username: names.username,
            discord_global_name: names.globalName
          })
          .eq('workspace_id', body.guildId)
          .eq('user_id', uid)
        stamped++
      }
    }
  }

  return json({ stamped })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
