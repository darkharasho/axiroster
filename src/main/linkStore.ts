// src/main/linkStore.ts
//
// Owns userData/rosterLinks.json — leadership-created Discord<->GW2 links that
// supplement (and override) the AxiTools auto-links. Keyed by GW2 account name
// (case-insensitive), one Discord member per account. Atomic tmp+rename writes,
// debounced, path-injected, corrupt-file safe.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

export interface RosterLink {
  /** GW2 account name, e.g. "harasho.4281" (stored as entered; matched lower-cased). */
  accountName: string
  /** Discord member_id this account is tied to. */
  memberId: string
  createdAt: string
}

interface FileShape {
  links: RosterLink[]
}

const DEBOUNCE_MS = 300
const lc = (s: string): string => s.trim().toLowerCase()

export class LinkStore {
  private state: FileShape
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly path: string) {
    this.state = this.read()
  }

  private read(): FileShape {
    if (!existsSync(this.path)) return { links: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>
      const links = Array.isArray(parsed.links) ? parsed.links : []
      return {
        links: links.filter(
          (l): l is RosterLink =>
            Boolean(l && typeof l.accountName === 'string' && typeof l.memberId === 'string')
        )
      }
    } catch {
      return { links: [] }
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

  list(): RosterLink[] {
    return this.state.links.map((l) => ({ ...l }))
  }

  /** Wipe all local links (e.g. after losing access to a workspace). */
  clear(): void {
    this.state = { links: [] }
    this.flush()
  }

  memberFor(accountName: string): string | null {
    const a = lc(accountName)
    return this.state.links.find((l) => lc(l.accountName) === a)?.memberId ?? null
  }

  set(accountName: string, memberId: string): RosterLink {
    const a = lc(accountName)
    let rec = this.state.links.find((l) => lc(l.accountName) === a)
    if (rec) {
      rec.memberId = memberId
    } else {
      rec = { accountName: accountName.trim(), memberId, createdAt: new Date().toISOString() }
      this.state.links.push(rec)
    }
    this.scheduleWrite()
    return { ...rec }
  }

  remove(accountName: string): void {
    const a = lc(accountName)
    this.state.links = this.state.links.filter((l) => lc(l.accountName) !== a)
    this.scheduleWrite()
  }
}
