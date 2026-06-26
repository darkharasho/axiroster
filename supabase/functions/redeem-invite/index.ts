import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleRedeem } from './handler.ts'

Deno.serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError) throw authError
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  const body = await req.json().catch(() => ({}))
  const code: string | undefined = body.code
  const discordId = (user.user_metadata?.provider_id as string) ?? null
  const db = createClient(url, service)
  const deps = { db: {
    listOpenInvites: async (q: { discordId: string | null; code?: string }) => {
      let query = db.from('workspace_invites').select('*').is('redeemed_by', null)
      query = q.code ? query.eq('code', q.code) : query.eq('discord_id', q.discordId)
      const { data, error } = await query
      if (error) throw error
      return data ?? []
    },
    markRedeemed: async (id: string, uid: string) => {
      const { error } = await db
        .from('workspace_invites')
        .update({ redeemed_by: uid, redeemed_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    insertMember: async (row: Record<string, unknown>) => {
      const { error } = await db.from('workspace_members').upsert(row)
      if (error) throw error
    }
  } }
  const r = await handleRedeem(deps as any, { userId: user.id, discordId, code })
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
})
