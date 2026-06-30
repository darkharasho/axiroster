import { describe, it, expect } from 'vitest'
import {
  DEFAULT_STAGES, parsePipelineDoc, parseVoteRow, tallyVotes, groupBoard,
  mergeAnnotationData, rekeyVotes, parseCommentRow, sortComments, COMMENT_PREFIX, type PipelineSubject, type VoteValue, type PipelineComment
} from './pipeline'

describe('parsePipelineDoc', () => {
  it('returns defaults for empty/corrupt', () => {
    expect(parsePipelineDoc('')).toEqual({ stages: DEFAULT_STAGES, placement: {} })
    expect(parsePipelineDoc('nope{')).toEqual({ stages: DEFAULT_STAGES, placement: {} })
  })
  it('reads stages + placement and sanitizes stage types', () => {
    const doc = JSON.stringify({
      stages: [{ id: 'a', label: 'A', type: 'weird' }, { id: 'done', label: 'Done', type: 'accepted' }],
      placement: { 'm1': 'a', 'm2': 'done' }
    })
    const out = parsePipelineDoc(doc)
    expect(out.stages[0]).toEqual({ id: 'a', label: 'A', color: 'slate', type: 'active' }) // bad type → active
    expect(out.stages[1].type).toBe('accepted')
    expect(out.placement).toEqual({ m1: 'a', m2: 'done' })
  })
})

describe('parseVoteRow', () => {
  it('keeps only valid vote values', () => {
    expect(parseVoteRow(JSON.stringify({ m1: 'yes', m2: 'maybe', m3: 'no' }))).toEqual({ m1: 'yes', m3: 'no' })
    expect(parseVoteRow('')).toEqual({})
    expect(parseVoteRow('[]')).toEqual({})
  })
})

describe('tallyVotes', () => {
  it('aggregates a subject across officer rows, ignoring others', () => {
    const rows: Record<string, VoteValue>[] = [{ m1: 'yes' }, { m1: 'yes', m2: 'no' }, { m1: 'abstain' }]
    expect(tallyVotes(rows, 'm1')).toEqual({ yes: 2, no: 0, abstain: 1 })
    expect(tallyVotes(rows, 'm2')).toEqual({ yes: 0, no: 1, abstain: 0 })
  })
})

describe('groupBoard', () => {
  const subs: PipelineSubject[] = [
    { key: 'm1', name: 'One', accountName: 'One.1', isProspect: false, tags: [] },
    { key: 'prospect:x', name: 'Pro', accountName: null, isProspect: true, tags: [] },
    { key: 'm2', name: 'Two', accountName: 'Two.2', isProspect: false, tags: [] }
  ]
  it('buckets only placed subjects and falls unknown stages back to first active', () => {
    const board = groupBoard(subs, { m1: 'trialing', 'prospect:x': 'ghoststage' /* unknown */ }, DEFAULT_STAGES)
    expect(board.trialing.map((s) => s.key)).toEqual(['m1'])
    expect(board.applied.map((s) => s.key)).toEqual(['prospect:x']) // unknown → first active (applied)
    expect(Object.values(board).flat().some((s) => s.key === 'm2')).toBe(false) // m2 not placed
  })
})

describe('mergeAnnotationData', () => {
  it('unions tags+aliases case-insensitively and keeps target notes unless empty', () => {
    const out = mergeAnnotationData(
      { nickname: 'Mem', aliases: ['Old'], notes: '', tags: ['core'] },
      { nickname: 'Pro', aliases: ['pro.1'], notes: 'trial notes', tags: ['Core', 'trial'] }
    )
    expect(out.tags).toEqual(['core', 'trial'])
    expect(out.aliases).toEqual(['Old', 'Pro', 'pro.1'])
    expect(out.notes).toBe('trial notes') // target empty → take source
  })
})

describe('rekeyVotes', () => {
  it('moves a subject key, leaving others', () => {
    expect(rekeyVotes({ a: 'yes', b: 'no' }, 'a', 'z')).toEqual({ z: 'yes', b: 'no' })
    expect(rekeyVotes({ b: 'no' }, 'a', 'z')).toEqual({ b: 'no' }) // absent → unchanged
  })
})

describe('parseCommentRow', () => {
  it('parses a valid comment row', () => {
    const rec = {
      memberId: 'comment:abc',
      notes: JSON.stringify({ subjectKey: 'prospect:1', authorId: 'u1', authorName: 'Dark', body: 'hi' }),
      createdAt: '2026-06-29T00:00:00.000Z'
    }
    expect(parseCommentRow(rec)).toEqual({
      id: 'comment:abc',
      subjectKey: 'prospect:1',
      authorId: 'u1',
      authorName: 'Dark',
      body: 'hi',
      createdAt: '2026-06-29T00:00:00.000Z',
      editedAt: undefined
    })
  })

  it('carries editedAt when present', () => {
    const rec = {
      memberId: 'comment:abc',
      notes: JSON.stringify({ subjectKey: 's', authorId: 'u', authorName: 'N', body: 'b', editedAt: '2026-06-29T01:00:00.000Z' }),
      createdAt: '2026-06-29T00:00:00.000Z'
    }
    expect(parseCommentRow(rec)?.editedAt).toBe('2026-06-29T01:00:00.000Z')
  })

  it('returns null for malformed or non-comment rows', () => {
    expect(parseCommentRow({ memberId: 'comment:x', notes: 'not json', createdAt: 't' })).toBeNull()
    expect(parseCommentRow({ memberId: 'prospect:x', notes: '{}', createdAt: 't' })).toBeNull()
    expect(parseCommentRow({ memberId: 'comment:x', notes: JSON.stringify({ authorId: 'u' }), createdAt: 't' })).toBeNull()
  })
})

describe('sortComments', () => {
  it('orders ascending by createdAt then id', () => {
    const a = { id: 'comment:b', subjectKey: 's', authorId: 'u', authorName: 'N', body: '2', createdAt: '2026-06-29T00:00:02.000Z' }
    const b = { id: 'comment:a', subjectKey: 's', authorId: 'u', authorName: 'N', body: '1', createdAt: '2026-06-29T00:00:01.000Z' }
    expect(sortComments([a, b]).map((c) => c.body)).toEqual(['1', '2'])
  })
})

describe('COMMENT_PREFIX', () => {
  it('is comment:', () => {
    expect(COMMENT_PREFIX).toBe('comment:')
  })
})
