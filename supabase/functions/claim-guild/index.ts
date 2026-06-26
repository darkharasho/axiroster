// supabase/functions/claim-guild/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyLeaderKey } from '../_shared/gw2.ts'
import { encryptKey } from '../_shared/crypto.ts'
import { discordIdFromUser, discordNamesFromUser } from '../_shared/identity.ts'
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

  const body = await req.json().catch(() => ({}))
  const { apiKey, guildId, guildName, discordGuildId, discordGuildName } = body
  if (typeof apiKey !== 'string' || !apiKey || typeof guildId !== 'string' || !guildId) {
    return new Response(JSON.stringify({ error: 'apiKey and guildId are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    })
  }
  const db = createClient(url, service)
  const deps = {
    keySecret, verify: verifyLeaderKey, encrypt: encryptKey,
    db: {
      countOwners: async (ws: string) => {
        const { count, error } = await db.from('workspace_members')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', ws).eq('role', 'owner')
        if (error) throw error
        return count ?? 0
      },
      upsertWorkspace: async (row: any) => {
        const { error } = await db.from('workspaces').upsert(row)
        if (error) throw error
      },
      insertSecret: async (row: any) => {
        const { error } = await db.from('workspace_secrets').upsert(row)
        if (error) throw error
      },
      insertMember: async (row: any) => {
        const { error } = await db.from('workspace_members').upsert(row)
        if (error) throw error
      }
    }
  }
  const names = discordNamesFromUser(user)
  const r = await handleClaim(deps as any, {
    userId: user.id,
    discordId: discordIdFromUser(user),
    apiKey, guildId, guildName, discordGuildId, discordGuildName,
    discordUsername: names.username, discordGlobalName: names.globalName
  })
  return new Response(JSON.stringify(r.body), {
    status: r.status, headers: { 'Content-Type': 'application/json' }
  })
})
