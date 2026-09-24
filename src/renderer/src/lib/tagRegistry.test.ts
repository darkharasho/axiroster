import { describe, it, expect } from 'vitest'
import {
  PALETTE, defaultColorFor, resolveColorId, tagStyle, dotColor,
  parseRegistry, serializeRegistry, setTagColor
} from './tagRegistry'

describe('defaultColorFor', () => {
  it('is deterministic and case-insensitive', () => {
    expect(defaultColorFor('Commander')).toBe(defaultColorFor('commander'))
  })
  it('returns a palette id', () => {
    const ids = PALETTE.map((p) => p.id)
    expect(ids).toContain(defaultColorFor('healer'))
  })
})

describe('resolveColorId', () => {
  it('prefers the registry (case-insensitive) over the default', () => {
    expect(resolveColorId('Commander', { commander: 'rose' })).toBe('rose')
  })
  it('falls back to the name-derived default', () => {
    expect(resolveColorId('zzz', {})).toBe(defaultColorFor('zzz'))
  })
})

describe('parseRegistry', () => {
  it('returns {} for corrupt or non-object input', () => {
    expect(parseRegistry('not json')).toEqual({})
    expect(parseRegistry('42')).toEqual({})
    expect(parseRegistry('')).toEqual({})
  })
  it('keeps known color ids and lowercases keys, drops unknown', () => {
    expect(parseRegistry(JSON.stringify({ Core: 'blue', x: 'neon' }))).toEqual({ core: 'blue' })
  })
})

describe('setTagColor / serialize', () => {
  it('sets a lowercased key immutably and round-trips', () => {
    const reg = setTagColor({}, 'Trial', 'amber')
    expect(reg).toEqual({ trial: 'amber' })
    expect(parseRegistry(serializeRegistry(reg))).toEqual({ trial: 'amber' })
  })
})

describe('style helpers', () => {
  it('hand a known id to the language as --axi-series', () => {
    expect(tagStyle('emerald')).toEqual({ '--axi-series': dotColor('emerald') })
  })
  it('falls back to the slate swatch for an unknown id', () => {
    expect(dotColor('nope' as never)).toBe(dotColor('slate'))
  })
})
