// src/main/retention/supabaseRetentionRepo.ts
// Write-mostly retention log backed by Supabase. append() upserts best-effort
// and keeps an in-memory copy (deduped one row per member per day).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { RetentionRepo, RetentionSnapshot } from './retentionRepo'
import { snapshotToRow } from './retentionRows'

const TABLE = 'retention_snapshots'

export interface SupabaseRetentionConfig {
  url: string
  anonKey: string
  workspaceId: string
  accessToken?: string
  refreshToken?: string
}

export class SupabaseRetentionRepo implements RetentionRepo {
  private readonly client: SupabaseClient
  private rows: RetentionSnapshot[] = []
  private readonly sessionReady: Promise<void>

  constructor(private readonly config: SupabaseRetentionConfig, injected?: SupabaseClient) {
    this.client = injected ?? createClient(config.url, config.anonKey, { auth: { persistSession: false } })
    this.sessionReady =
      config.accessToken && config.refreshToken
        ? this.client.auth
            .setSession({ access_token: config.accessToken, refresh_token: config.refreshToken })
            .then(() => undefined, () => undefined)
        : Promise.resolve()
  }

  async start(): Promise<void> { await this.sessionReady }
  async stop(): Promise<void> {}

  append(snapshots: RetentionSnapshot[]): void {
    if (snapshots.length === 0) return
    const key = (s: RetentionSnapshot): string => `${s.date}|${s.memberKey}`
    const byKey = new Map(this.rows.map((r) => [key(r), r]))
    for (const s of snapshots) byKey.set(key(s), s)
    this.rows = [...byKey.values()]
    void this.client.from(TABLE)
      .upsert(snapshots.map((s) => snapshotToRow(this.config.workspaceId, s)), { onConflict: 'workspace_id,date,member_key' })
      .then(() => undefined, () => undefined)
  }

  list(): RetentionSnapshot[] { return [...this.rows] }
}
