// src/main/retentionHistory.ts
//
// Local-only log of per-member retention scores over time. Seeds a future trained
// churn model (paired with Guild Log departures). De-duped to one row per member
// per calendar day. Atomic tmp+rename writes, capped, corrupt-file safe.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

export interface RetentionSnapshot {
  date: string // YYYY-MM-DD
  memberKey: string
  score: number
  tier: string
}

const MAX_ROWS = 20000

export class RetentionHistory {
  private rows: RetentionSnapshot[]
  constructor(private readonly path: string) {
    this.rows = this.read()
  }
  private read(): RetentionSnapshot[] {
    if (!existsSync(this.path)) return []
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'))
      return Array.isArray(parsed?.rows) ? (parsed.rows as RetentionSnapshot[]) : []
    } catch {
      return []
    }
  }
  list(): RetentionSnapshot[] {
    return [...this.rows]
  }
  append(snapshots: RetentionSnapshot[]): void {
    const key = (s: RetentionSnapshot): string => `${s.date}|${s.memberKey}`
    const byKey = new Map(this.rows.map((r) => [key(r), r]))
    for (const s of snapshots) byKey.set(key(s), s)
    let rows = [...byKey.values()]
    if (rows.length > MAX_ROWS) rows = rows.slice(rows.length - MAX_ROWS)
    this.rows = rows
    this.flush()
  }
  private flush(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, rows: this.rows }, null, 2), { mode: 0o600 })
    renameSync(tmp, this.path)
  }
}
