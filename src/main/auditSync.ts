// src/main/auditSync.ts
//
// The guild-log poller. While the app runs it pulls both sources on an interval
// (plus on-demand via refresh()): GW2 directly from the GW2 API and Discord from
// the AxiTools bot, each incrementally via the store's cursors. Sources are
// independent — one failing surfaces a non-blocking error and the other still
// updates. Everything lands in the active AuditRepo (LocalAuditStore offline, or
// the cache-backed SupabaseAuditRepo when a workspace is connected).
//
// It also tracks a per-source status (idle/syncing/ok/error/skipped + running
// total) so the UI can show live progress and — crucially — make a silent
// Discord gap visible (skipped = no key, ok+0 = nothing logged, error = why).

import type { Gw2Client } from './gw2Client'
import type { AxitoolsClient } from './axitoolsClient'
import type { AuditRepo } from './audit/auditRepo'
import { normalizeGw2, normalizeDiscord } from './auditNormalize'

export const POLL_MS = 5 * 60 * 1000

export type AuditSourceState = 'idle' | 'syncing' | 'ok' | 'error' | 'skipped'

export interface AuditSourceStatus {
  state: AuditSourceState
  /** Running total of this source's events in the store. */
  count: number
  /** Present when state === 'error'. */
  error?: string
  /** ISO timestamp of the last completed (ok/error/skipped) pull. */
  at?: string
}

export interface AuditStatus {
  gw2: AuditSourceStatus
  discord: AuditSourceStatus
  /** True while a refresh pass is in flight. */
  running: boolean
  /** Mirror of store.lastUpdated() — when an event was last added. */
  updatedAt: string
}

export interface AuditSyncDeps {
  store: AuditRepo
  /** Build a GW2 client for the active guild (throws if no key). */
  gw2: () => Gw2Client
  /** Build an AxiTools client for the active guild (throws if no key). */
  axitools: () => AxitoolsClient
  /** GW2 guild id to pull, or null to skip the GW2 source (e.g. no leader key). */
  gw2GuildId: () => string | null
  /** Discord guild id to pull, or null to skip the Discord source. */
  discordGuildId: () => string | null
  /** Called once per pass when new events were added. */
  onUpdated: () => void
  /** Called with a user-facing message when a source fails. */
  onError?: (msg: string) => void
  /** Called whenever the per-source status changes. */
  onStatus?: (status: AuditStatus) => void
}

function nowIso(): string {
  return new Date().toISOString()
}

export class AuditSync {
  private timer: ReturnType<typeof setInterval> | null = null
  private status: AuditStatus = {
    gw2: { state: 'idle', count: 0 },
    discord: { state: 'idle', count: 0 },
    running: false,
    updatedAt: ''
  }

  constructor(private readonly deps: AuditSyncDeps) {
    const c = this.deps.store.counts()
    this.status.gw2.count = c.gw2
    this.status.discord.count = c.discord
    this.status.updatedAt = this.deps.store.lastUpdated()
  }

  start(): void {
    this.stop()
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), POLL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getStatus(): AuditStatus {
    return {
      gw2: { ...this.status.gw2 },
      discord: { ...this.status.discord },
      running: this.status.running,
      updatedAt: this.status.updatedAt
    }
  }

  private emit(): void {
    this.status.updatedAt = this.deps.store.lastUpdated()
    this.deps.onStatus?.(this.getStatus())
  }

  private setSrc(src: 'gw2' | 'discord', patch: Partial<AuditSourceStatus>): void {
    this.status[src] = { ...this.status[src], ...patch }
    this.emit()
  }

  /** One sync pass over both sources. Returns the number of new events added. */
  async refresh(): Promise<number> {
    this.status.running = true
    this.emit()
    let added = 0
    added += await this.pullGw2(this.deps.store.getCursors().gw2LastLogId)
    added += await this.pullDiscord(this.deps.store.getCursors().discordLastId)
    this.status.running = false
    this.emit()
    if (added > 0) this.deps.onUpdated()
    return added
  }

  private async pullGw2(since?: number): Promise<number> {
    const gid = this.deps.gw2GuildId()
    if (!gid) {
      this.setSrc('gw2', { state: 'skipped', at: nowIso() })
      return 0
    }
    this.setSrc('gw2', { state: 'syncing', error: undefined })
    try {
      const entries = await this.deps.gw2().guildLog(gid, since)
      let added = 0
      if (entries.length > 0) {
        added = this.deps.store.merge(entries.map(normalizeGw2))
        const maxId = entries.reduce((m, e) => (e.id > m ? e.id : m), since ?? 0)
        this.deps.store.setCursors({ gw2LastLogId: maxId })
      }
      this.setSrc('gw2', {
        state: 'ok',
        count: this.deps.store.counts().gw2,
        at: nowIso(),
        error: undefined
      })
      return added
    } catch (e) {
      const msg = (e as Error).message
      this.setSrc('gw2', { state: 'error', error: msg, at: nowIso() })
      this.deps.onError?.(msg)
      return 0
    }
  }

  private async pullDiscord(since?: string): Promise<number> {
    const gid = this.deps.discordGuildId()
    if (!gid) {
      this.setSrc('discord', { state: 'skipped', at: nowIso() })
      return 0
    }
    this.setSrc('discord', { state: 'syncing', error: undefined })
    const LIMIT = 200
    const MAX_PAGES = 50
    let cursor = since
    let added = 0
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const rows = await this.deps.axitools().auditDiscord(gid, { sinceId: cursor, limit: LIMIT })
        if (rows.length === 0) break
        added += this.deps.store.merge(rows.map(normalizeDiscord))
        const maxId = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), Number(cursor ?? 0))
        cursor = String(maxId)
        this.deps.store.setCursors({ discordLastId: cursor })
        if (rows.length < LIMIT) break
      }
      this.setSrc('discord', {
        state: 'ok',
        count: this.deps.store.counts().discord,
        at: nowIso(),
        error: undefined
      })
      return added
    } catch (e) {
      const msg = (e as Error).message
      this.setSrc('discord', { state: 'error', error: msg, at: nowIso() })
      this.deps.onError?.(msg)
      return added
    }
  }
}
