// src/main/sync/syncProvider.ts
//
// The shared-state seam. AxiRoster's annotations + manual links live in local
// JSON (rosterStore / linkStore) so the app always works offline. A SyncProvider
// mirrors those mutations to a shared backend and streams remote changes back so
// a guild's leadership all see the same roster.
//
// Everything goes through this interface so the backend is swappable: the
// renderer and IPC layer never import Supabase directly. The default is a no-op
// (local-only); SupabaseSyncProvider implements live multi-user sync.

import type { RosterAnnotation } from '../rosterStore'
import type { RosterLink } from '../linkStore'

/** A change pushed from the backend to apply to local stores. */
export type SyncEvent =
  | { kind: 'annotation:upsert'; record: RosterAnnotation }
  | { kind: 'annotation:remove'; memberId: string }
  | { kind: 'link:set'; record: RosterLink }
  | { kind: 'link:remove'; accountName: string }

export type SyncStatus = 'disabled' | 'connecting' | 'connected' | 'error'

export interface SyncProvider {
  readonly status: SyncStatus
  /** Connect + backfill, then start streaming. Resolves once the initial pull
   *  has been applied via the onEvent callback passed to the constructor. */
  start(): Promise<void>
  stop(): Promise<void>
  /** Push a local mutation to the shared backend. Best-effort; failures surface
   *  via status but never block the local write. */
  pushAnnotation(record: RosterAnnotation): Promise<void>
  removeAnnotation(memberId: string): Promise<void>
  pushLink(record: RosterLink): Promise<void>
  removeLink(accountName: string): Promise<void>
}

/** No backend configured: every push is a no-op, nothing streams in. */
export class LocalSyncProvider implements SyncProvider {
  readonly status: SyncStatus = 'disabled'
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async pushAnnotation(): Promise<void> {}
  async removeAnnotation(): Promise<void> {}
  async pushLink(): Promise<void> {}
  async removeLink(): Promise<void> {}
}

export interface SupabaseSyncConfig {
  url: string
  anonKey: string
  /** The guild workspace all leadership share. Rows are scoped to this id. */
  workspaceId: string
}
