// src/main/audit/supabaseAuditRepo.ts
//
// Cache-backed audit store: Supabase is the source of truth, but the public
// methods stay synchronous (auditSync + IPC call them in tight loops). Hydrate
// the cache on start(), keep it fresh via realtime, serve reads from memory,
// and upsert writes best-effort. Mirrors SupabaseSyncProvider.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AuditEvent } from '../auditNormalize'
import type { AuditRepo, AuditCursors, AuditFilter } from './auditRepo'
import { mergeAuditEvents, filterAuditEvents, countsBySource, MAX_AUDIT_EVENTS } from './auditCore'
import { eventToRow, rowToEvent, cursorsToRow, rowToCursors } from './auditRows'

const EVENTS_TABLE = 'audit_events'
const CURSORS_TABLE = 'audit_cursors'

export interface SupabaseAuditConfig {
  url: string
  anonKey: string
  workspaceId: string
  accessToken?: string
  refreshToken?: string
}

export class SupabaseAuditRepo implements AuditRepo {
  private readonly client: SupabaseClient
  private events: AuditEvent[] = []
  private cursors: AuditCursors = {}
  private updatedAt = ''
  private changeCbs: (() => void)[] = []
  private channel: ReturnType<SupabaseClient['channel']> | null = null
  private readonly sessionReady: Promise<void>

  constructor(private readonly config: SupabaseAuditConfig, injected?: SupabaseClient) {
    this.client = injected ?? createClient(config.url, config.anonKey, { auth: { persistSession: false } })
    this.sessionReady =
      config.accessToken && config.refreshToken
        ? this.client.auth
            .setSession({ access_token: config.accessToken, refresh_token: config.refreshToken })
            .then(() => { if (config.accessToken) this.client.realtime.setAuth(config.accessToken) })
            .catch(() => undefined)
        : Promise.resolve()
  }

  async start(): Promise<void> {
    await this.sessionReady
    await this.backfill()
    this.subscribe()
  }

  async stop(): Promise<void> {
    if (this.channel) { await this.client.removeChannel(this.channel).catch(() => {}); this.channel = null }
  }

  onChange(cb: () => void): () => void {
    this.changeCbs.push(cb)
    return () => { this.changeCbs = this.changeCbs.filter((c) => c !== cb) }
  }

  merge(events: AuditEvent[]): number {
    const added = this.applyLocal(events)
    if (added > 0) {
      void this.client.from(EVENTS_TABLE)
        .upsert(events.map((e) => eventToRow(this.config.workspaceId, e)), { onConflict: 'workspace_id,uid' })
        .then(() => undefined, () => undefined)
    }
    return added
  }

  /** In-memory dedupe+sort+cap via the shared helper, stamping updatedAt. */
  private applyLocal(events: AuditEvent[]): number {
    const added = mergeAuditEvents(this.events, events)
    if (added > 0) this.updatedAt = new Date().toISOString()
    return added
  }

  list(filter: AuditFilter = {}): AuditEvent[] {
    return filterAuditEvents(this.events, filter)
  }

  getCursors(): AuditCursors { return { ...this.cursors } }

  setCursors(patch: AuditCursors): void {
    this.cursors = { ...this.cursors, ...patch }
    void this.client.from(CURSORS_TABLE)
      .upsert(cursorsToRow(this.config.workspaceId, this.cursors), { onConflict: 'workspace_id' })
      .then(() => undefined, () => undefined)
  }

  lastUpdated(): string { return this.updatedAt }

  counts(): { gw2: number; discord: number } { return countsBySource(this.events) }

  private async backfill(): Promise<void> {
    const { data: evRows } = await this.client.from(EVENTS_TABLE)
      .select('*').eq('workspace_id', this.config.workspaceId)
      .order('ts', { ascending: false }).limit(MAX_AUDIT_EVENTS)
    if (Array.isArray(evRows)) this.applyLocal(evRows.map(rowToEvent))
    const { data: curRow } = await this.client.from(CURSORS_TABLE)
      .select('*').eq('workspace_id', this.config.workspaceId).maybeSingle()
    if (curRow) this.cursors = rowToCursors(curRow as Record<string, unknown>)
  }

  private subscribe(): void {
    this.channel = this.client
      .channel(`audit:${this.config.workspaceId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: EVENTS_TABLE, filter: `workspace_id=eq.${this.config.workspaceId}` },
        (payload) => {
          const added = this.applyLocal([rowToEvent(payload.new as Record<string, unknown>)])
          if (added > 0) this.changeCbs.forEach((cb) => cb())
        })
      .subscribe()
  }
}
