import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encryptKey } from '../_shared/crypto.ts'
import { fetchAccountName } from '../_shared/gw2.ts'
import { discordIdFromUser } from '../_shared/identity.ts'
import { isBlocked, policyLookup, workspaceDiscordServer } from '../_shared/policy.ts'
import { handleShareKeys, type ShareKeysBody } from './handler.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'

// Owner-only: turn key sharing on/off for a workspace (see handler.ts).
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

  const body = (await req.json().catch(() => ({}))) as ShareKeysBody
  const db = createClient(url, service)
  const r = await handleShareKeys({
    keySecret,
    encrypt: encryptKey,
    accountName: (key) => fetchAccountName(fetch, key),
    blocked: (ids) => isBlocked(policyLookup(db), ids),
    serverOf: workspaceDiscordServer(db),
    db: {
      role: async (ws, uid) => {
        const { data: m } = await db
          .from('workspace_members')
          .select('role')
          .eq('workspace_id', ws)
          .eq('user_id', uid)
          .maybeSingle()
        return (m as { role?: string } | null)?.role ?? null
      },
      upsertSecret: async (row) => (await db.from('workspace_secrets').upsert(row)).error?.message ?? null,
      updateSecret: async (ws, patch) =>
        (await db.from('workspace_secrets').update(patch).eq('workspace_id', ws)).error?.message ?? null,
      updateWorkspace: async (ws, patch) =>
        (await db.from('workspaces').update(patch).eq('workspace_id', ws)).error?.message ?? null
    }
  }, { userId: user.id, discordId: discordIdFromUser(user), body })
  return json(r.body, r.status)
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
