// src/main/departureSnapshotStore.ts
//
// userData/departureSnapshots/<guildId>.json — the account names seen at the
// last successful live GW2 roster pull, per guild. The roster diff in
// detectDepartures runs against it. Atomic tmp+rename writes; a missing or
// corrupt file reads as null (= no snapshot, so no diff), never throws on read.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

export class DepartureSnapshotStore {
  constructor(private readonly dir: string) {}

  private path(guildId: string): string {
    return join(this.dir, `${guildId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`)
  }

  read(guildId: string): string[] | null {
    const p = this.path(guildId)
    if (!existsSync(p)) return null
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as { accounts?: unknown }
      return Array.isArray(parsed.accounts)
        ? parsed.accounts.filter((a): a is string => typeof a === 'string')
        : null
    } catch {
      return null
    }
  }

  write(guildId: string, accounts: string[]): void {
    mkdirSync(this.dir, { recursive: true })
    const p = this.path(guildId)
    const tmp = `${p}.tmp`
    writeFileSync(tmp, JSON.stringify({ accounts, at: new Date().toISOString() }), { mode: 0o600 })
    renameSync(tmp, p)
  }
}
