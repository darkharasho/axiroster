// src/main/auditStore.ts
//
// Owns userData/auditLog/<guildId>.json — the local, per-guild unified audit
// log. Pulled live from the GW2 API + AxiTools and merged here; NEVER synced to
// Supabase. Same durability idioms as rosterStore.ts: atomic tmp+rename writes,
// debounced, path-injected, corrupt/missing-file safe (never throws). Dedupes by
// uid, keeps newest-first, and caps at MAX_EVENTS so a busy guild can't grow the
// file without bound.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import type { AuditEvent } from './auditNormalize'

export const MAX_EVENTS = 50000
const DEBOUNCE_MS = 300

export interface AuditCursors {
  /** Highest GW2 guild-log id pulled so far (the `since` for the next pull). */
  gw2LastLogId?: number
  /** Highest AxiTools audit id pulled so far. */
  discordLastId?: string
}

export interface AuditFilter {
  source?: 'gw2' | 'discord'
  type?: string
  /** Case-insensitive substring over actor + target + summary. */
  search?: string
  /** Max rows returned (default 1000). */
  limit?: number
}

interface AuditFile {
  events: AuditEvent[]
  cursors: AuditCursors
  updatedAt: string
}

export class AuditStore {
  private state: AuditFile
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly path: string) {
    this.state = this.read()
  }

  private read(): AuditFile {
    if (!existsSync(this.path)) return { events: [], cursors: {}, updatedAt: '' }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<AuditFile>
      const events = Array.isArray(parsed.events)
        ? parsed.events.filter(
            (e): e is AuditEvent => Boolean(e) && typeof (e as AuditEvent).uid === 'string'
          )
        : []
      const cursors =
        parsed.cursors && typeof parsed.cursors === 'object' ? (parsed.cursors as AuditCursors) : {}
      return {
        events,
        cursors,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : ''
      }
    } catch {
      return { events: [], cursors: {}, updatedAt: '' }
    }
  }

  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 })
    renameSync(tmp, this.path)
  }

  /** Insert new events (deduped by uid), keep newest-first, enforce the cap.
   *  Returns how many were actually added. */
  merge(events: AuditEvent[]): number {
    if (events.length === 0) return 0
    const have = new Set(this.state.events.map((e) => e.uid))
    let added = 0
    for (const e of events) {
      if (have.has(e.uid)) continue
      have.add(e.uid)
      this.state.events.push(e)
      added++
    }
    if (added > 0) {
      this.state.events.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0))
      if (this.state.events.length > MAX_EVENTS) this.state.events.length = MAX_EVENTS
      this.state.updatedAt = new Date().toISOString()
      this.scheduleWrite()
    }
    return added
  }

  list(filter: AuditFilter = {}): AuditEvent[] {
    const limit = filter.limit ?? 1000
    const q = filter.search?.trim().toLowerCase()
    const out: AuditEvent[] = []
    for (const e of this.state.events) {
      if (filter.source && e.source !== filter.source) continue
      if (filter.type && e.type !== filter.type) continue
      if (q && !`${e.actor ?? ''} ${e.target ?? ''} ${e.summary}`.toLowerCase().includes(q)) continue
      out.push(e)
      if (out.length >= limit) break
    }
    return out
  }

  getCursors(): AuditCursors {
    return { ...this.state.cursors }
  }

  setCursors(patch: AuditCursors): void {
    this.state.cursors = { ...this.state.cursors, ...patch }
    this.scheduleWrite()
  }

  lastUpdated(): string {
    return this.state.updatedAt
  }

  clear(): void {
    this.state = { events: [], cursors: {}, updatedAt: '' }
    this.flush()
  }
}
