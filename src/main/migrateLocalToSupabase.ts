// src/main/migrateLocalToSupabase.ts
// One-time, idempotent backfill of the local audit/retention JSON into Supabase
// when a workspace first connects. Idempotent twice over: a per-workspace marker
// short-circuits repeats, and the underlying upserts dedupe by primary key.
import type { AuditRepo } from './audit/auditRepo'
import type { RetentionRepo, RetentionSnapshot } from './retention/retentionRepo'
import type { AuditEvent } from './auditNormalize'

interface AuditMigrateDeps {
  workspaceId: string
  target: Pick<AuditRepo, 'merge'>
  local: { list(): AuditEvent[] }
  getSetting(key: string): string | null
  setSetting(key: string, value: string): void
}

export async function migrateAuditToSupabase(deps: AuditMigrateDeps): Promise<number> {
  // v2: v1 ran before the workspace/guild containment guard existed, so it could
  // fire while a DIFFERENT guild was active and push that guild's local file into
  // this workspace (and its marker then blocked the right guild's history from
  // ever migrating). Ignoring v1 markers restarts everyone once under the guard;
  // the (workspace_id, uid) upsert dedupes any legitimate repeats.
  const marker = `migratedAudit2:${deps.workspaceId}`
  if (deps.getSetting(marker)) return 0
  const events = deps.local.list()
  if (events.length > 0) deps.target.merge(events)
  deps.setSetting(marker, new Date().toISOString())
  return events.length
}

interface RetentionMigrateDeps {
  workspaceId: string
  target: Pick<RetentionRepo, 'append'>
  local: { list(): RetentionSnapshot[] }
  getSetting(key: string): string | null
  setSetting(key: string, value: string): void
}

export async function migrateRetentionToSupabase(deps: RetentionMigrateDeps): Promise<number> {
  const marker = `migratedRetention:${deps.workspaceId}`
  if (deps.getSetting(marker)) return 0
  const rows = deps.local.list()
  if (rows.length > 0) deps.target.append(rows)
  deps.setSetting(marker, new Date().toISOString())
  return rows.length
}
