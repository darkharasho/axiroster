// src/main/auditSync.ts
//
// The guild-log poller. While the app runs it pulls both sources on an interval
// (plus on-demand via refresh()): GW2 directly from the GW2 API and Discord from
// the AxiTools bot, each incrementally via the store's cursors. Sources are
// independent — one failing surfaces a non-blocking error and the other still
// updates. Everything lands in the local AuditStore; nothing is synced remotely.

import type { Gw2Client } from './gw2Client'
import type { AxitoolsClient } from './axitoolsClient'
import type { AuditStore } from './auditStore'
import { normalizeGw2, normalizeDiscord } from './auditNormalize'

export const POLL_MS = 5 * 60 * 1000

export interface AuditSyncDeps {
  store: AuditStore
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
}

export class AuditSync {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: AuditSyncDeps) {}

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

  /** One sync pass over both sources. Returns the number of new events added. */
  async refresh(): Promise<number> {
    const cursors = this.deps.store.getCursors()
    let added = 0
    added += await this.pullGw2(cursors.gw2LastLogId)
    added += await this.pullDiscord(cursors.discordLastId)
    if (added > 0) this.deps.onUpdated()
    return added
  }

  private async pullGw2(since?: number): Promise<number> {
    const gid = this.deps.gw2GuildId()
    if (!gid) return 0
    try {
      const entries = await this.deps.gw2().guildLog(gid, since)
      if (entries.length === 0) return 0
      const added = this.deps.store.merge(entries.map(normalizeGw2))
      const maxId = entries.reduce((m, e) => (e.id > m ? e.id : m), since ?? 0)
      this.deps.store.setCursors({ gw2LastLogId: maxId })
      return added
    } catch (e) {
      this.deps.onError?.((e as Error).message)
      return 0
    }
  }

  private async pullDiscord(since?: string): Promise<number> {
    const gid = this.deps.discordGuildId()
    if (!gid) return 0
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
      return added
    } catch (e) {
      this.deps.onError?.((e as Error).message)
      return added
    }
  }
}
