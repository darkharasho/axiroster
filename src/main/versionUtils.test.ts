import { describe, it, expect } from 'vitest'
import { parseVersion, compareVersion, extractReleaseNotesRangeFromFile } from './versionUtils'

describe('parseVersion', () => {
  it('parses a plain semver string', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
  })
  it('strips leading "v"', () => {
    expect(parseVersion('v2.0.0')).toEqual([2, 0, 0])
    expect(parseVersion('V1.2.3')).toEqual([1, 2, 3])
  })
  it('trims whitespace', () => {
    expect(parseVersion('  1.2.3  ')).toEqual([1, 2, 3])
  })
  it('returns null for null / undefined / empty', () => {
    expect(parseVersion(null)).toBeNull()
    expect(parseVersion(undefined)).toBeNull()
    expect(parseVersion('')).toBeNull()
  })
  it('returns null when any part is not a number', () => {
    expect(parseVersion('1.x.3')).toBeNull()
    expect(parseVersion('1.2.a')).toBeNull()
  })
  it('fills missing parts with 0', () => {
    expect(parseVersion('1.2')).toEqual([1, 2, 0])
  })
})

describe('compareVersion', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersion([1, 2, 3], [1, 2, 3])).toBe(0)
  })
  it('orders major, then minor, then patch', () => {
    expect(compareVersion([2, 0, 0], [1, 9, 9])).toBeGreaterThan(0)
    expect(compareVersion([1, 1, 0], [1, 2, 0])).toBeLessThan(0)
    expect(compareVersion([1, 2, 5], [1, 2, 3])).toBeGreaterThan(0)
  })
})

const makeNotes = (...versions: string[]): string =>
  `# Release Notes\n\n${versions.map((v) => `Version v${v}\n\nChanges for ${v}.`).join('\n\n')}`

describe('extractReleaseNotesRangeFromFile', () => {
  it('returns null for empty / unparseable current', () => {
    expect(extractReleaseNotesRangeFromFile('', '1.0.0', null)).toBeNull()
    expect(extractReleaseNotesRangeFromFile(makeNotes('1.0.0'), 'nope', null)).toBeNull()
  })
  it('returns all sections up to current when lastSeen is null', () => {
    const r = extractReleaseNotesRangeFromFile(makeNotes('1.0.0', '1.1.0', '1.2.0'), '1.2.0', null)
    expect(r).toContain('Version v1.2.0')
    expect(r).toContain('Version v1.1.0')
    expect(r).toContain('Version v1.0.0')
  })
  it('excludes sections at or before lastSeen, and newer than current', () => {
    const r = extractReleaseNotesRangeFromFile(
      makeNotes('1.0.0', '1.1.0', '1.2.0', '2.0.0'),
      '1.2.0',
      '1.1.0'
    )
    expect(r).toContain('Version v1.2.0')
    expect(r).not.toContain('Version v1.1.0')
    expect(r).not.toContain('Version v2.0.0')
  })
  it('returns null when nothing is new', () => {
    expect(extractReleaseNotesRangeFromFile(makeNotes('1.1.0'), '1.1.0', '1.1.0')).toBeNull()
  })
  it('sorts newest-first and wraps in a header', () => {
    const r = extractReleaseNotesRangeFromFile(makeNotes('1.0.0', '1.2.0'), '1.2.0', null)!
    expect(r.startsWith('# Release Notes')).toBe(true)
    expect(r.indexOf('v1.2.0')).toBeLessThan(r.indexOf('v1.0.0'))
  })
  it('handles a single-version file (AxiRoster current shape)', () => {
    const r = extractReleaseNotesRangeFromFile('# Release Notes\n\nVersion v0.1.16\n\nStuff.', '0.1.16', '0.1.15')
    expect(r).toContain('Version v0.1.16')
  })
  it('treats unparseable lastSeen as no lastSeen', () => {
    const r = extractReleaseNotesRangeFromFile(makeNotes('1.0.0', '1.1.0'), '1.1.0', 'nope')
    expect(r).toContain('Version v1.1.0')
    expect(r).toContain('Version v1.0.0')
  })
})
