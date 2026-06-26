// src/main/sync/supabaseSync.ts
//
// Supabase-backed multi-user sync. Two tables, both scoped by workspace_id so
// one guild's leadership share a workspace:
//
//   roster_annotations(workspace_id, member_id, nickname, aliases jsonb,
//                      notes, tags jsonb, main_account, created_at, updated_at,
//                      PRIMARY KEY (workspace_id, member_id))
//   roster_links(workspace_id, account_name, member_id, created_at,
//                PRIMARY KEY (workspace_id, account_name))
//
// Conflict policy is last-write-wins on updated_at (good enough for a handful of
// officers editing notes/tags). Realtime postgres_changes streams remote edits
// back into the local stores via onEvent. See docs for the SQL + RLS policy.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { RosterAnnotation } from '../rosterStore'
import type { RosterLink } from '../linkStore'
import type { RosterMember, SyncEvent, SyncProvider, SyncStatus, SupabaseSyncConfig } from './syncProvider'

const ANN_TABLE = 'roster_annotations'
const LINK_TABLE = 'roster_links'
const MEMBER_TABLE = 'roster_members'

export function rowToMember(r: Record<string, unknown>): RosterMember {
  return {
    memberId: String(r.member_id),
    payload: (r.payload ?? {}) as Record<string, unknown>
  }
}

function annToRow(workspaceId: string, a: RosterAnnotation): Record<string, unknown> {
  return {
    workspace_id: workspaceId,
    member_id: a.memberId,
    nickname: a.nickname,
    aliases: a.aliases,
    notes: a.notes,
    tags: a.tags,
    main_account: a.mainAccount,
    created_at: a.createdAt,
    updated_at: a.updatedAt
  }
}

function rowToAnn(r: Record<string, unknown>): RosterAnnotation {
  return {
    memberId: String(r.member_id),
    nickname: typeof r.nickname === 'string' ? r.nickname : '',
    aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [],
    notes: typeof r.notes === 'string' ? r.notes : '',
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    mainAccount: typeof r.main_account === 'string' ? r.main_account : '',
    createdAt: typeof r.created_at === 'string' ? r.created_at : new Date().toISOString(),
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : new Date().toISOString()
  }
}

function rowToLink(r: Record<string, unknown>): RosterLink {
  return {
    accountName: String(r.account_name),
    memberId: String(r.member_id),
    createdAt: typeof r.created_at === 'string' ? r.created_at : new Date().toISOString()
  }
}

export class SupabaseSyncProvider implements SyncProvider {
  private client: SupabaseClient
  private _status: SyncStatus = 'disabled'

  constructor(
    private readonly config: SupabaseSyncConfig,
    private readonly onEvent: (e: SyncEvent) => void
  ) {
    this.client = createClient(config.url, config.anonKey, {
      auth: { persistSession: false }
    })
    if (config.accessToken && config.refreshToken) {
      void this.client.auth.setSession({
        access_token: config.accessToken,
        refresh_token: config.refreshToken
      })
    }
  }

  get status(): SyncStatus {
    return this._status
  }

  async start(): Promise<void> {
    this._status = 'connecting'
    try {
      await this.backfill()
      this.subscribe()
      this._status = 'connected'
    } catch {
      this._status = 'error'
    }
  }

  private async backfill(): Promise<void> {
    const ws = this.config.workspaceId
    const [{ data: anns }, { data: links }, { data: members }] = await Promise.all([
      this.client.from(ANN_TABLE).select('*').eq('workspace_id', ws),
      this.client.from(LINK_TABLE).select('*').eq('workspace_id', ws),
      this.client.from(MEMBER_TABLE).select('*').eq('workspace_id', ws)
    ])
    for (const r of anns ?? []) this.onEvent({ kind: 'annotation:upsert', record: rowToAnn(r) })
    for (const r of links ?? []) this.onEvent({ kind: 'link:set', record: rowToLink(r) })
    for (const r of members ?? []) this.onEvent({ kind: 'member:upsert', record: rowToMember(r) })
  }

  private subscribe(): void {
    const ws = this.config.workspaceId
    this.client
      .channel(`axiroster:${ws}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: ANN_TABLE, filter: `workspace_id=eq.${ws}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as Record<string, unknown>
            this.onEvent({ kind: 'annotation:remove', memberId: String(old.member_id) })
          } else {
            this.onEvent({
              kind: 'annotation:upsert',
              record: rowToAnn(payload.new as Record<string, unknown>)
            })
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: LINK_TABLE, filter: `workspace_id=eq.${ws}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as Record<string, unknown>
            this.onEvent({ kind: 'link:remove', accountName: String(old.account_name) })
          } else {
            this.onEvent({
              kind: 'link:set',
              record: rowToLink(payload.new as Record<string, unknown>)
            })
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: MEMBER_TABLE, filter: `workspace_id=eq.${ws}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            this.onEvent({ kind: 'member:remove', memberId: String((payload.old as any).member_id) })
          } else {
            this.onEvent({ kind: 'member:upsert', record: rowToMember(payload.new as any) })
          }
        }
      )
      .subscribe()
  }

  async stop(): Promise<void> {
    await this.client.removeAllChannels()
    this._status = 'disabled'
  }

  async pushAnnotation(record: RosterAnnotation): Promise<void> {
    await this.client
      .from(ANN_TABLE)
      .upsert(annToRow(this.config.workspaceId, record), { onConflict: 'workspace_id,member_id' })
  }

  async removeAnnotation(memberId: string): Promise<void> {
    await this.client
      .from(ANN_TABLE)
      .delete()
      .eq('workspace_id', this.config.workspaceId)
      .eq('member_id', memberId)
  }

  async pushLink(record: RosterLink): Promise<void> {
    await this.client.from(LINK_TABLE).upsert(
      {
        workspace_id: this.config.workspaceId,
        account_name: record.accountName,
        member_id: record.memberId,
        created_at: record.createdAt
      },
      { onConflict: 'workspace_id,account_name' }
    )
  }

  async removeLink(accountName: string): Promise<void> {
    await this.client
      .from(LINK_TABLE)
      .delete()
      .eq('workspace_id', this.config.workspaceId)
      .eq('account_name', accountName)
  }

  async refreshRoster(): Promise<number> {
    const { data, error } = await this.client.functions.invoke('refresh-roster', {
      body: { guildId: this.config.workspaceId }
    })
    if (error) throw error
    return (data as { count?: number })?.count ?? 0
  }
}
