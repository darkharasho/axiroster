//
// Pure helpers for bulk tag operations across selected roster members. Works on a
// narrow { annotationKey, tags } shape (ReconciledMember is assignable) so it stays
// node-testable with no React/preload imports. Each function returns only the
// members that actually change, so callers persist the minimum.

export type Taggable = { annotationKey: string; tags: string[] }
export type TagDiff = { key: string; nextTags: string[] }

function byKey(members: Taggable[]): Map<string, Taggable> {
  const m = new Map<string, Taggable>()
  for (const x of members) m.set(x.annotationKey, x)
  return m
}

export function addTagToMembers(members: Taggable[], keys: Iterable<string>, tag: string): TagDiff[] {
  const name = tag.trim()
  if (!name) return []
  const lc = name.toLowerCase()
  const map = byKey(members)
  const out: TagDiff[] = []
  for (const key of keys) {
    const mem = map.get(key)
    if (!mem) continue
    if (mem.tags.some((t) => t.toLowerCase() === lc)) continue
    out.push({ key, nextTags: [...mem.tags, name] })
  }
  return out
}

export function removeTagFromMembers(members: Taggable[], keys: Iterable<string>, tag: string): TagDiff[] {
  const name = tag.trim()
  if (!name) return []
  const lc = name.toLowerCase()
  const map = byKey(members)
  const out: TagDiff[] = []
  for (const key of keys) {
    const mem = map.get(key)
    if (!mem) continue
    if (!mem.tags.some((t) => t.toLowerCase() === lc)) continue
    out.push({ key, nextTags: mem.tags.filter((t) => t.toLowerCase() !== lc) })
  }
  return out
}

export function tagsInSelection(members: Taggable[], keys: Iterable<string>): string[] {
  const map = byKey(members)
  const seen = new Map<string, string>() // lc -> first display casing
  for (const key of keys) {
    const mem = map.get(key)
    if (!mem) continue
    for (const t of mem.tags) {
      const l = t.toLowerCase()
      if (!seen.has(l)) seen.set(l, t)
    }
  }
  return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
}
