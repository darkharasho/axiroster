// src/main/retention/retentionRepo.ts
// The retention-history seam. Write-only today (logRetention -> append); no
// in-app read path, so the interface stays tiny.
export interface RetentionSnapshot {
  date: string // YYYY-MM-DD
  memberKey: string
  score: number
  tier: string
}

export interface RetentionRepo {
  start(): Promise<void>
  stop(): Promise<void>
  append(snapshots: RetentionSnapshot[]): void
  list(): RetentionSnapshot[]
}
