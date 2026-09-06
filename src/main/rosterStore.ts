// src/main/rosterStore.ts
//
// Owns userData/rosterAnnotations.json — leadership-maintained annotations that
// layer on top of the live Discord + GW2 roster. Keyed by an annotation key
// (Discord member_id when linked, else `acct:<gw2 account>`); holds a preferred
// nickname, aliases, freeform notes, and quick tags. Atomic tmp+rename writes,
// debounced, path-injected, corrupt-file safe (never throws).
//
// In a synced workspace this store is the local mirror; the SyncProvider pushes
// upserts/removes to the shared backend and applies remote changes back in.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { isReservedAnnotationKey } from '../shared/rosterReconcile'

export interface RosterAnnotation {
  /** Discord member_id, or `acct:<gw2 account>` for unlinked accounts. */
  memberId: string
  /** Preferred canonical short name for this person ('' = unset). */
  nickname: string
  /** Other ways people refer to them (IGN shorthands, old names). */
  aliases: string[]
  /** Freeform context (role, playstyle, timezone, anything). */
  notes: string
  /** Quick labels (e.g. "commander", "core", "trial"). */
  tags: string[]
  /** GW2 account chosen as this identity's "main" ('' = auto-pick). */
  mainAccount: string
  createdAt: string
  updatedAt: string
}

export type RosterAnnotationPatch = Partial<
  Pick<RosterAnnotation, 'nickname' | 'aliases' | 'notes' | 'tags' | 'mainAccount'>
>

interface FileShape {
  /** Person-scoped annotations. Shared across every guild profile BY DESIGN —
   *  a note about a player follows them between guilds. */
  annotations: RosterAnnotation[]
  /** Reserved rows (meta:*, prospect:*, vote:*, comment:*) bucketed by guild
   *  profile id. These are workspace state, not person state: the cloud keys
   *  them per workspace_id, so the local mirror must be scoped too or one
   *  guild's recruitment pipeline bleeds into another's. */
  scoped: Record<string, RosterAnnotation[]>
}

const DEBOUNCE_MS = 300

function isEmpty(a: RosterAnnotation): boolean {
  return (
    !a.nickname.trim() &&
    a.aliases.length === 0 &&
    !a.notes.trim() &&
    a.tags.length === 0 &&
    !a.mainAccount.trim()
  )
}

function cleanList(xs: unknown): string[] {
  if (!Array.isArray(xs)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs) {
    const s = String(x).trim()
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase())
      out.push(s)
    }
  }
  return out
}

function sanitizeList(xs: unknown): RosterAnnotation[] {
  if (!Array.isArray(xs)) return []
  return (xs as Partial<RosterAnnotation>[])
    .filter((a): a is RosterAnnotation => Boolean(a && typeof a.memberId === 'string'))
    .map((a) => ({
      memberId: a.memberId,
      nickname: typeof a.nickname === 'string' ? a.nickname : '',
      aliases: cleanList(a.aliases),
      notes: typeof a.notes === 'string' ? a.notes : '',
      tags: cleanList(a.tags),
      mainAccount: typeof a.mainAccount === 'string' ? a.mainAccount : '',
      createdAt: a.createdAt ?? new Date().toISOString(),
      updatedAt: a.updatedAt ?? new Date().toISOString()
    }))
}

export class RosterStore {
  private state: FileShape
  private timer: ReturnType<typeof setTimeout> | null = null
  /** Active guild profile id; scopes reserved rows. '' until setScope() runs. */
  private scope = ''

  constructor(private readonly path: string) {
    this.state = this.read()
  }

  private read(): FileShape {
    if (!existsSync(this.path)) return { annotations: [], scoped: {} }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>
      const all = sanitizeList(parsed.annotations)
      const scoped: Record<string, RosterAnnotation[]> = {}
      const rawScoped = parsed.scoped && typeof parsed.scoped === 'object' ? parsed.scoped : {}
      for (const [k, v] of Object.entries(rawScoped)) scoped[k] = sanitizeList(v)
      // Pre-scoping files kept reserved rows in the flat list, where every guild
      // could see them. We cannot tell which guild each belonged to, and guessing
      // would keep the leak alive, so quarantine them: synced guilds re-pull their
      // own rows on the next backfill, and nothing is silently destroyed.
      const legacyReserved = all.filter((a) => isReservedAnnotationKey(a.memberId))
      if (legacyReserved.length) this.quarantine(legacyReserved)
      return { annotations: all.filter((a) => !isReservedAnnotationKey(a.memberId)), scoped }
    } catch {
      return { annotations: [], scoped: {} }
    }
  }

  /** Park pre-scoping reserved rows next to the store so they are recoverable. */
  private quarantine(rows: RosterAnnotation[]): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(`${this.path}.legacy-reserved.json`, JSON.stringify({ annotations: rows }, null, 2), {
        mode: 0o600
      })
    } catch {
      /* best effort: the leak is still closed even if the backup cannot be written */
    }
    this.scheduleWrite()
  }

  /** Point reserved-row reads/writes at a guild profile. Must be called whenever
   *  the active guild changes, before anything reads pipeline state. */
  setScope(scopeId: string | null): void {
    this.scope = String(scopeId || '')
  }

  /** The bucket a key lives in: the active guild's for reserved rows, the shared
   *  person-scoped list otherwise. */
  private bucket(memberId: string): RosterAnnotation[] {
    if (!isReservedAnnotationKey(memberId)) return this.state.annotations
    const key = this.scope
    if (!this.state.scoped[key]) this.state.scoped[key] = []
    return this.state.scoped[key]
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

  /** Shared annotations plus the ACTIVE guild's reserved rows — never another
   *  guild's. */
  list(): RosterAnnotation[] {
    return [...this.state.annotations, ...(this.state.scoped[this.scope] ?? [])].map((a) => ({
      ...a,
      aliases: [...a.aliases],
      tags: [...a.tags]
    }))
  }

  /** Wipe all local annotations (e.g. after losing access to a workspace). */
  clear(): void {
    this.state = { annotations: [], scoped: {} }
    this.flush()
  }

  get(memberId: string): RosterAnnotation | null {
    const a = this.bucket(memberId).find((x) => x.memberId === memberId)
    return a ? { ...a, aliases: [...a.aliases], tags: [...a.tags] } : null
  }

  upsert(memberId: string, patch: RosterAnnotationPatch): RosterAnnotation | null {
    const now = new Date().toISOString()
    const bucket = this.bucket(memberId)
    let rec = bucket.find((x) => x.memberId === memberId)
    if (!rec) {
      rec = {
        memberId,
        nickname: '',
        aliases: [],
        notes: '',
        tags: [],
        mainAccount: '',
        createdAt: now,
        updatedAt: now
      }
      bucket.push(rec)
    }
    if (patch.nickname !== undefined) rec.nickname = patch.nickname.trim()
    if (patch.aliases !== undefined) rec.aliases = cleanList(patch.aliases)
    if (patch.notes !== undefined) rec.notes = patch.notes
    if (patch.tags !== undefined) rec.tags = cleanList(patch.tags)
    if (patch.mainAccount !== undefined) rec.mainAccount = patch.mainAccount.trim()
    rec.updatedAt = now

    if (isEmpty(rec)) {
      this.remove(memberId)
      return null
    }
    this.scheduleWrite()
    return { ...rec, aliases: [...rec.aliases], tags: [...rec.tags] }
  }

  /** Apply a full annotation record verbatim (used when a SyncProvider pulls a
   *  remote change). Skips the empty-record pruning so remote state wins. */
  applyRemote(rec: RosterAnnotation): void {
    const bucket = this.bucket(rec.memberId)
    const idx = bucket.findIndex((x) => x.memberId === rec.memberId)
    if (idx >= 0) bucket[idx] = rec
    else bucket.push(rec)
    this.scheduleWrite()
  }

  remove(memberId: string): void {
    if (isReservedAnnotationKey(memberId)) {
      const key = this.scope
      this.state.scoped[key] = (this.state.scoped[key] ?? []).filter((x) => x.memberId !== memberId)
    } else {
      this.state.annotations = this.state.annotations.filter((x) => x.memberId !== memberId)
    }
    this.scheduleWrite()
  }
}
