import { describe, it, expect } from 'vitest'
import { parseDetails } from './auditDetails'

describe('parseDetails', () => {
  it('returns an empty model for undefined or empty input', () => {
    expect(parseDetails(undefined)).toEqual({ fields: [] })
    expect(parseDetails('')).toEqual({ fields: [] })
  })

  it('parses plain key-value lines in order', () => {
    const m = parseDetails('Attachments: 1\nEmbeds: 0 -> 1')
    expect(m.fields).toEqual([
      { key: 'Attachments', value: '1', fenced: false, unavailable: false },
      { key: 'Embeds', value: '0 -> 1', fenced: false, unavailable: false }
    ])
  })

  it('parses a fenced multi-line value into one field', () => {
    const m = parseDetails('Content: ```\nline one\nline two\n```\nAttachments: 2')
    expect(m.fields).toEqual([
      { key: 'Content', value: 'line one\nline two', fenced: true, unavailable: false },
      { key: 'Attachments', value: '2', fenced: false, unavailable: false }
    ])
  })

  it('parses a Before/After fenced pair (message edit)', () => {
    const m = parseDetails('Channel: <#123>\nBefore: ```\ntest\n```\nAfter: ```\ntest 2\n```')
    expect(m.fields.map((f) => f.key)).toEqual(['Before', 'After'])
    expect(m.fields[0].value).toBe('test')
    expect(m.fields[1].value).toBe('test 2')
  })

  it('drops Channel lines (already rendered as the channel chip)', () => {
    const m = parseDetails('Channel: <#123>\nDetails: something happened')
    expect(m.fields).toEqual([
      { key: 'Details', value: 'something happened', fenced: false, unavailable: false }
    ])
  })

  it('suppresses each boilerplate Details sentence', () => {
    for (const s of [
      'Member joined the server.',
      'Member left the server.',
      'Member was kicked.',
      'Member was banned.',
      'Member was unbanned.',
      'Voice state updated.'
    ]) {
      expect(parseDetails(`Details: ${s}`).fields).toEqual([])
    }
  })

  it('keeps a non-boilerplate Details value', () => {
    expect(parseDetails('Details: Nickname changed').fields).toEqual([
      { key: 'Details', value: 'Nickname changed', fenced: false, unavailable: false }
    ])
  })

  it('flags Unavailable sentinels', () => {
    const m = parseDetails('Content: Unavailable (message content intent missing or not cached).')
    expect(m.fields[0].unavailable).toBe(true)
    expect(m.fields[0].value).toMatch(/^Unavailable/)
  })

  it('consumes an unclosed fence to end of input', () => {
    const m = parseDetails('Before: ```\ntruncated body with no clos')
    expect(m.fields).toEqual([
      { key: 'Before', value: 'truncated body with no clos', fenced: true, unavailable: false }
    ])
  })

  it('starts a Details field for a keyless first line', () => {
    expect(parseDetails('just some text').fields).toEqual([
      { key: 'Details', value: 'just some text', fenced: false, unavailable: false }
    ])
  })

  it('appends keyless continuation lines to the previous field', () => {
    const m = parseDetails('Reason: first\nsecond')
    expect(m.fields).toEqual([
      { key: 'Reason', value: 'first\nsecond', fenced: false, unavailable: false }
    ])
  })

  it('drops fields whose value ends up empty', () => {
    expect(parseDetails('Content: ```\n```').fields).toEqual([])
    expect(parseDetails('Details:').fields).toEqual([])
  })
})
