// supabase/functions/axitools/index.ts
// Edge entrypoint for the AxiTools/Discord proxy. Verifies the caller's Supabase
// JWT, builds injected deps (service-role DB reads + key decrypt + a fetch-backed
// AxiTools client), and delegates to the pure handler. Mirrors refresh-roster.
//
// Request body: { op, key?, workspaceId?, guildId?, includeMembers?, action?, params? }
//   - op: listGuilds | guildRoles | discordOverview | membersLinked | discordAction
//   - key present  => validation mode (uses that candidate axt1 key directly)
//   - key absent   => stored mode (decrypts workspace_secrets.axitools_key_enc)
// Response: 200 { data } on success; { error } (+ message on upstream_error) otherwise.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptKey } from '../_shared/crypto.ts'
import { AxitoolsClient } from '../_shared/axitools.ts'
import { handleAxitools } from './handler.ts'

Deno.serve(async (req) => {
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

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const db = createClient(url, service)
  const deps = {
    decrypt: decryptKey,
    keySecret,
    client: (baseUrl: string, token: string) => new AxitoolsClient(fetch, baseUrl, token),
    db: {
      role: async (ws: string, uid: string) => {
        const { data, error } = await db
          .from('workspace_members')
          .select('role')
          .eq('workspace_id', ws)
          .eq('user_id', uid)
          .maybeSingle()
        if (error) throw new Error(error.message)
        return (data as { role?: string } | null)?.role ?? null
      },
      getAxitoolsSecret: async (ws: string) => {
        const { data, error } = await db
          .from('workspace_secrets')
          .select('axitools_key_enc')
          .eq('workspace_id', ws)
          .maybeSingle()
        if (error) throw new Error(error.message)
        return (data as { axitools_key_enc?: string } | null)?.axitools_key_enc ?? null
      }
    }
  }

  const r = await handleAxitools(deps as never, {
    userId: user.id,
    op: body?.op as string | undefined,
    key: body?.key as string | undefined,
    workspaceId: body?.workspaceId as string | undefined,
    guildId: body?.guildId as string | undefined,
    includeMembers: body?.includeMembers as boolean | undefined,
    action: body?.action as string | undefined,
    params: body?.params as Record<string, unknown> | undefined
  })
  return new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: { 'Content-Type': 'application/json' }
  })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
