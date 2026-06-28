// src/main/retention/retentionRows.ts
import type { RetentionSnapshot } from './retentionRepo'

export function snapshotToRow(workspaceId: string, s: RetentionSnapshot): Record<string, unknown> {
  return { workspace_id: workspaceId, date: s.date, member_key: s.memberKey, score: s.score, tier: s.tier }
}

export function rowToSnapshot(r: Record<string, unknown>): RetentionSnapshot {
  return {
    date: String(r.date),
    memberKey: String(r.member_key),
    score: typeof r.score === 'number' ? r.score : Number(r.score) || 0,
    tier: typeof r.tier === 'string' ? r.tier : ''
  }
}
