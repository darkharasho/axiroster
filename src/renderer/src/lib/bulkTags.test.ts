import { describe, it, expect } from 'vitest'
import { addTagToMembers, removeTagFromMembers, tagsInSelection, type Taggable } from './bulkTags'

const members: Taggable[] = [
  { annotationKey: 'a', tags: ['core', 'commander'] },
  { annotationKey: 'b', tags: ['trial'] },
  { annotationKey: 'c', tags: ['Core'] },
  { annotationKey: 'd', tags: [] }
]

describe('addTagToMembers', () => {
  it('adds the tag only to members that lack it (case-insensitive)', () => {
    const diffs = addTagToMembers(members, ['a', 'b', 'c', 'd'], 'core')
    // a has 'core', c has 'Core' -> skipped; b and d get it
    expect(diffs).toEqual([
      { key: 'b', nextTags: ['trial', 'core'] },
      { key: 'd', nextTags: ['core'] }
    ])
  })
  it('ignores keys not in the member set and trims the tag', () => {
    expect(addTagToMembers(members, ['zzz'], 'x')).toEqual([])
    expect(addTagToMembers(members, ['d'], '  raid ')).toEqual([{ key: 'd', nextTags: ['raid'] }])
  })
  it('returns [] for an empty tag', () => {
    expect(addTagToMembers(members, ['a', 'b'], '   ')).toEqual([])
  })
})

describe('removeTagFromMembers', () => {
  it('removes the tag (case-insensitive) only where present', () => {
    const diffs = removeTagFromMembers(members, ['a', 'b', 'c', 'd'], 'CORE')
    expect(diffs).toEqual([
      { key: 'a', nextTags: ['commander'] },
      { key: 'c', nextTags: [] }
    ])
  })
})

describe('tagsInSelection', () => {
  it('unions tags across the selection, de-duped case-insensitively and sorted', () => {
    expect(tagsInSelection(members, ['a', 'b', 'c'])).toEqual(['commander', 'core', 'trial'])
  })
  it('is empty for an empty selection', () => {
    expect(tagsInSelection(members, [])).toEqual([])
  })
})
