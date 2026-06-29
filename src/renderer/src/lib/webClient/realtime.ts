// src/renderer/src/lib/webClient/realtime.ts
// Web realtime: one Supabase channel per active workspace, fanning postgres_changes
// out to the renderer's existing onSyncChanged/onWorkspaceChanged/onAuditUpdated
// callbacks (the web client has no local stores — consumers just re-fetch). Mirrors
// the desktop SupabaseSyncProvider table set. setAuth(token) MUST precede subscribe
// or the realtime socket connects as anon and RLS drops every row.
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import type { SyncStatus } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { activeWorkspaceId } from './discordGw2'

type Cb = () => void
type StatusCb = (s: SyncStatus) => void

const SYNC_TABLES = ['roster_annotations', 'roster_links', 'roster_members']
const META_TABLES = ['workspace_members', 'workspace_invites', 'workspaces']

export interface WebRealtime {
  onSync(cb: Cb): () => void
  onWorkspace(cb: Cb): () => void
  onAudit(cb: Cb): () => void
  onStatus(cb: StatusCb): () => void
  status(): SyncStatus
  resync(): void
  stop(): void
}

export function createWebRealtime(sb: SupabaseClient, settings: WebSettings): WebRealtime {
  const sync = new Set<Cb>()
  const workspace = new Set<Cb>()
  const audit = new Set<Cb>()
  const statusCbs = new Set<StatusCb>()
  let channel: RealtimeChannel | null = null
  let currentWs: string | null = null
  let _status: SyncStatus = 'disabled'
  let pending: Promise<void> = Promise.resolve()

  const setStatus = (s: SyncStatus): void => {
    _status = s
    for (const cb of statusCbs) cb(s)
  }
  const fan = (set: Set<Cb>): void => {
    for (const cb of set) cb()
  }

  const teardown = async (): Promise<void> => {
    if (!channel) return
    const c = channel
    channel = null
    currentWs = null
    try {
      await sb.removeChannel(c)
    } catch {
      /* ignore */
    }
  }

  async function ensureOnce(): Promise<void> {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) {
      await teardown()
      setStatus('disabled')
      return
    }
    if (channel && currentWs === ws) return
    await teardown()
    currentWs = ws
    setStatus('connecting')
    const {
      data: { session }
    } = await sb.auth.getSession()
    if (session?.access_token) sb.realtime.setAuth(session.access_token)
    let ch = sb.channel(`axiroster-web:${ws}`)
    const opts = (table: string): Record<string, unknown> => ({
      event: '*',
      schema: 'public',
      table,
      filter: `workspace_id=eq.${ws}`
    })
    for (const t of SYNC_TABLES) ch = ch.on('postgres_changes', opts(t) as never, () => fan(sync))
    for (const t of META_TABLES) ch = ch.on('postgres_changes', opts(t) as never, () => fan(workspace))
    ch = ch.on('postgres_changes', opts('audit_events') as never, () => fan(audit))
    channel = ch
    ch.subscribe((st: string) => {
      if (st === 'SUBSCRIBED') setStatus('connected')
      else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') setStatus('error')
    })
  }

  const ensure = (): Promise<void> => {
    pending = pending.then(ensureOnce).catch(() => {})
    return pending
  }

  // Re-auth on token refresh (the live socket re-auths existing channels); (re)subscribe
  // on sign-in; tear down on sign-out.
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      pending = pending
        .then(async () => {
          await teardown()
          setStatus('disabled')
        })
        .catch(() => {})
    } else if (event === 'TOKEN_REFRESHED') {
      if (session?.access_token) sb.realtime.setAuth(session.access_token)
    } else if (event === 'SIGNED_IN') {
      if (session?.access_token) sb.realtime.setAuth(session.access_token)
      void ensure()
    }
  })

  const sub = (set: Set<Cb>, cb: Cb): (() => void) => {
    set.add(cb)
    void ensure()
    return () => {
      set.delete(cb)
    }
  }

  return {
    onSync: (cb) => sub(sync, cb),
    onWorkspace: (cb) => sub(workspace, cb),
    onAudit: (cb) => sub(audit, cb),
    onStatus: (cb) => {
      statusCbs.add(cb)
      cb(_status)
      return () => {
        statusCbs.delete(cb)
      }
    },
    status: () => _status,
    resync: () => {
      void ensure()
    },
    stop: () => {
      pending = pending
        .then(async () => {
          await teardown()
          setStatus('disabled')
        })
        .catch(() => {})
    }
  }
}
