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
  annotations: RosterAnnotation[]
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

export class RosterStore {
  private state: FileShape
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly path: string) {
    this.state = this.read()
  }

  private read(): FileShape {
    if (!existsSync(this.path)) return { annotations: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>
      const annotations = Array.isArray(parsed.annotations) ? parsed.annotations : []
      return {
        annotations: annotations
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
    } catch {
      return { annotations: [] }
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

  list(): RosterAnnotation[] {
    return this.state.annotations.map((a) => ({ ...a, aliases: [...a.aliases], tags: [...a.tags] }))
  }

  get(memberId: string): RosterAnnotation | null {
    const a = this.state.annotations.find((x) => x.memberId === memberId)
    return a ? { ...a, aliases: [...a.aliases], tags: [...a.tags] } : null
  }

  upsert(memberId: string, patch: RosterAnnotationPatch): RosterAnnotation | null {
    const now = new Date().toISOString()
    let rec = this.state.annotations.find((x) => x.memberId === memberId)
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
      this.state.annotations.push(rec)
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
    const idx = this.state.annotations.findIndex((x) => x.memberId === rec.memberId)
    if (idx >= 0) this.state.annotations[idx] = rec
    else this.state.annotations.push(rec)
    this.scheduleWrite()
  }

  remove(memberId: string): void {
    this.state.annotations = this.state.annotations.filter((x) => x.memberId !== memberId)
    this.scheduleWrite()
  }
}
