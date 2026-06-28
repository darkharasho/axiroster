import { describe, it, expect } from 'vitest'
import {
  DEFAULT_STAGES, parsePipelineDoc, parseVoteRow, tallyVotes, groupBoard,
  mergeAnnotationData, rekeyVotes, type PipelineSubject, type VoteValue
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
