// supabase/functions/refresh-roster/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptKey } from '../_shared/crypto.ts'
import { verifyLeaderKey } from '../_shared/gw2.ts'
import { handleRefresh } from './handler.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const keySecret = Deno.env.get('LEADER_KEY_SECRET')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders } })
  const body = await req.json()
  const guildId: string = body?.guildId
  if (!guildId || typeof guildId !== 'string') {
    return new Response(JSON.stringify({ error: 'guildId required' }), { status: 400, headers: { ...corsHeaders } })
  }
  const db = createClient(url, service)
  const deps = {
    keySecret, decrypt: decryptKey,
    fetchMembers: async (apiKey: string, gid: string) =>
      (await verifyLeaderKey(fetch, apiKey, gid)).members,
    db: {
      isMember: async (ws: string, uid: string) => {
        const { data, error } = await db.from('workspace_members').select('user_id').eq('workspace_id', ws).eq('user_id', uid).maybeSingle()
        if (error) throw new Error(error.message)
        return !!data
      },
      getSecret: async (ws: string) => {
        const { data, error } = await db.from('workspace_secrets').select('leader_key_enc').eq('workspace_id', ws).maybeSingle()
        if (error) throw new Error(error.message)
        return data?.leader_key_enc ?? null
      },
      upsertMembers: async (_ws: string, rows: any[]) => {
        const { error } = await db.from('roster_members').upsert(rows)
        if (error) throw new Error(error.message)
      }
    }
  }
  const r = await handleRefresh(deps as any, { userId: user.id, guildId })
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
