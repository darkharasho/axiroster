// supabase/functions/refresh-roster/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptKey } from '../_shared/crypto.ts'
import { verifyLeaderKey } from '../_shared/gw2.ts'
import { handleRefresh } from './handler.ts'
import { rlsMember } from '../_shared/policy.ts'
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
    allowed: rlsMember(userClient),
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
      },
      listMemberIds: async (ws: string) => {
        const { data, error } = await db.from('roster_members').select('member_id').eq('workspace_id', ws)
        if (error) throw new Error(error.message)
        return (data ?? []).map((r: any) => String(r.member_id))
      },
      listDepartures: async (ws: string) => {
        // PostgREST caps a select at 1000 rows; page through all departure docs.
        const out: { key: string; notes: string }[] = []
        for (let from = 0; ; from += 1000) {
          const { data, error } = await db.from('roster_annotations').select('member_id, notes')
            .eq('workspace_id', ws).like('member_id', 'departure:%')
            .order('member_id', { ascending: true }).range(from, from + 999)
          if (error) throw new Error(error.message)
          for (const r of data ?? []) out.push({ key: String(r.member_id), notes: typeof r.notes === 'string' ? r.notes : '' })
          if (!data || data.length < 1000) break
        }
        return out
      },
      listGw2Events: async (ws: string) => {
        // PostgREST caps a select at 1000 rows; page through the whole log.
        const out: any[] = []
        for (let from = 0; ; from += 1000) {
          const { data, error } = await db.from('audit_events').select('uid, source, type, actor, target, ts')
            .eq('workspace_id', ws).eq('source', 'gw2').in('type', ['kick', 'joined'])
            .order('ts', { ascending: true }).order('uid', { ascending: true }).range(from, from + 999)
          if (error) throw new Error(error.message)
          for (const r of data ?? []) {
            out.push({ uid: r.uid, source: r.source, type: r.type, time: r.ts, actor: r.actor || undefined, target: r.target || undefined })
          }
          if (!data || data.length < 1000) break
        }
        return out
      },
      listLinks: async (ws: string) => {
        const out: { accountName: string; memberId: string }[] = []
        for (let from = 0; ; from += 1000) {
          const { data, error } = await db.from('roster_links').select('account_name, member_id')
            .eq('workspace_id', ws).order('account_name', { ascending: true }).range(from, from + 999)
          if (error) throw new Error(error.message)
          for (const r of data ?? []) out.push({ accountName: String(r.account_name), memberId: String(r.member_id) })
          if (!data || data.length < 1000) break
        }
        return out
      },
      upsertDepartures: async (ws: string, rows: { key: string; notes: string }[]) => {
        const at = new Date().toISOString()
        const { error } = await db.from('roster_annotations').upsert(
          rows.map((r) => ({ workspace_id: ws, member_id: r.key, notes: r.notes, updated_at: at })),
          { onConflict: 'workspace_id,member_id' }
        )
        if (error) throw new Error(error.message)
      },
      deleteMembers: async (ws: string, ids: string[]) => {
        // Chunked: a mass drop can delete hundreds, and `.in()` puts every id in the URL.
        const CHUNK = 100
        for (let i = 0; i < ids.length; i += CHUNK) {
          const { error } = await db
            .from('roster_members')
            .delete()
            .eq('workspace_id', ws)
            .in('member_id', ids.slice(i, i + CHUNK))
          if (error) throw new Error(error.message)
        }
      }
    }
  }
  const r = await handleRefresh(deps as any, { userId: user.id, guildId })
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
