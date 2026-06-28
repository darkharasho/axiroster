// src/main/audit/localAuditStore.ts
//
// Owns userData/auditLog/<guildId>.json — the local, per-guild unified audit
// log. Pulled live from the GW2 API + AxiTools and merged here; NEVER synced to
// Supabase. Same durability idioms as rosterStore.ts: atomic tmp+rename writes,
// debounced, path-injected, corrupt/missing-file safe (never throws). Dedupes by
// uid, keeps newest-first, and caps at MAX_AUDIT_EVENTS so a busy guild can't grow the
// file without bound.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import type { AuditEvent } from '../auditNormalize'
import type { AuditRepo, AuditCursors, AuditFilter } from './auditRepo'
import { mergeAuditEvents, filterAuditEvents, countsBySource, MAX_AUDIT_EVENTS } from './auditCore'

const DEBOUNCE_MS = 300

interface AuditFile {
  events: AuditEvent[]
  cursors: AuditCursors
  updatedAt: string
}

export class LocalAuditStore implements AuditRepo {
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
        ? parsed.events
            .filter(
              (e): e is AuditEvent => Boolean(e) && typeof (e as AuditEvent).uid === 'string'
            )
            // Defend the cap even if the file was edited/grown out of band.
            .slice(0, MAX_AUDIT_EVENTS)
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

  merge(events: AuditEvent[]): number {
    const added = mergeAuditEvents(this.state.events, events)
    if (added > 0) {
      this.state.updatedAt = new Date().toISOString()
      this.scheduleWrite()
    }
    return added
  }

  list(filter: AuditFilter = {}): AuditEvent[] {
    return filterAuditEvents(this.state.events, filter)
  }

  getCursors(): AuditCursors { return { ...this.state.cursors } }

  setCursors(patch: AuditCursors): void {
    this.state.cursors = { ...this.state.cursors, ...patch }
    this.scheduleWrite()
  }

  lastUpdated(): string { return this.state.updatedAt }

  counts(): { gw2: number; discord: number } { return countsBySource(this.state.events) }

  clear(): void {
    this.state = { events: [], cursors: {}, updatedAt: '' }
    this.flush()
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}
