// supabase/functions/claim-guild/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyLeaderKey } from '../_shared/gw2.ts'
import { encryptKey } from '../_shared/crypto.ts'
import { handleClaim } from './handler.ts'

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? ''
  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const keySecret = Deno.env.get('LEADER_KEY_SECRET')!
  // Identify the caller from their JWT.
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } }
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })

  const { apiKey, guildId, guildName } = await req.json()
  const db = createClient(url, service)
  const deps = {
    keySecret, verify: verifyLeaderKey, encrypt: encryptKey,
    db: {
      countOwners: async (ws: string) =>
        (await db.from('workspace_members').select('*', { count: 'exact', head: true })
          .eq('workspace_id', ws).eq('role', 'owner')).count ?? 0,
      upsertWorkspace: async (row: any) => { await db.from('workspaces').upsert(row) },
      insertSecret: async (row: any) => { await db.from('workspace_secrets').upsert(row) },
      insertMember: async (row: any) => { await db.from('workspace_members').upsert(row) }
    }
  }
  const r = await handleClaim(deps as any, {
    userId: user.id,
    discordId: (user.user_metadata?.provider_id as string) ?? null,
    apiKey, guildId, guildName
  })
  return new Response(JSON.stringify(r.body), {
    status: r.status, headers: { 'Content-Type': 'application/json' }
  })
})
