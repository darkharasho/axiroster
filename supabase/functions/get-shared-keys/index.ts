import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptKey } from '../_shared/crypto.ts'
import { rlsMember } from '../_shared/policy.ts'
import { handleGetSharedKeys } from './handler.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'

// Member-only: if the workspace shares its keys, return the decrypted GW2 +
// AxiTools keys and guild metadata so the member's app can adopt a guild profile.
Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const keySecret = Deno.env.get('LEADER_KEY_SECRET')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
  })
  const {
    data: { user }
  } = await userClient.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await req.json().catch(() => ({}))) as { guildId?: string }
  const db = createClient(url, service)
  const r = await handleGetSharedKeys({
    keySecret,
    decrypt: decryptKey,
    allowed: rlsMember(userClient),
    db: {
      isMember: async (ws, uid) => {
        const { data: m } = await db
          .from('workspace_members')
          .select('user_id')
          .eq('workspace_id', ws)
          .eq('user_id', uid)
          .maybeSingle()
        return !!m
      },
      getWorkspace: async (ws) => {
        const { data } = await db
          .from('workspaces')
          .select('guild_name, discord_guild_id, discord_guild_name, member_role_id, bridge_repos, retention_enabled, pipeline_enabled')
          .eq('workspace_id', ws)
          .maybeSingle()
        return data
      },
      getSecrets: async (ws) => {
        const { data } = await db
          .from('workspace_secrets')
          .select('leader_key_enc, axitools_key_enc')
          .eq('workspace_id', ws)
          .maybeSingle()
        return data
      }
    }
  }, { userId: user.id, guildId: body.guildId })
  return json(r.body, r.status)
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
