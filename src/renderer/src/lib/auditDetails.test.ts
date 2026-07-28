import { describe, it, expect } from 'vitest'
import { parseDetails, detailBlocks, detailPreview } from './auditDetails'

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

  it('does not flag a fenced body that merely starts with the sentinel text', () => {
    const m = parseDetails('Content: ```\nUnavailable (brb walking the dog) — save my spot\n```')
    expect(m.fields[0].unavailable).toBe(false)
    expect(m.fields[0].fenced).toBe(true)
  })

  it('keeps a boilerplate sentence under a non-Details key', () => {
    expect(parseDetails('Reason: Member was kicked.').fields).toEqual([
      { key: 'Reason', value: 'Member was kicked.', fenced: false, unavailable: false }
    ])
  })
})

describe('detailBlocks', () => {
  it('pairs Before + After into a diff block ahead of everything else', () => {
    const m = parseDetails('Before: ```\na\n```\nAfter: ```\nb\n```\nEmbeds: 0 -> 1')
    const blocks = detailBlocks(m)
    expect(blocks[0]).toMatchObject({ kind: 'diff' })
    expect(blocks[1]).toEqual({ kind: 'arrow', key: 'Embeds', from: '0', to: '1' })
  })

  it('renders Added/Removed as ± tags even when fenced (emoji lists)', () => {
    const m = parseDetails('Added: ```\naxi_hype, axi_gg\n```\nRemoved: ```\nold_logo\n```')
    expect(detailBlocks(m)).toEqual([
      {
        kind: 'tags',
        op: 'add',
        items: [
          { label: 'axi_hype', unresolved: false },
          { label: 'axi_gg', unresolved: false }
        ]
      },
      { kind: 'tags', op: 'remove', items: [{ label: 'old_logo', unresolved: false }] }
    ])
  })

  it('marks role mentions as unresolved dimmed items', () => {
    const m = parseDetails('Added: <@&1067285089387>, <@&99>')
    expect(detailBlocks(m)[0]).toEqual({
      kind: 'tags',
      op: 'add',
      items: [
        { label: '@1067285089387', unresolved: true },
        { label: '@99', unresolved: true }
      ]
    })
  })

  it('maps unavailable sentinels before the generic content block', () => {
    const m = parseDetails('Content: Unavailable (message content intent missing).')
    expect(detailBlocks(m)[0].kind).toBe('unavailable')
  })

  it('maps fenced or multi-line values to content blocks', () => {
    const m = parseDetails('Reason: ```\nspamming invite links\n```')
    expect(detailBlocks(m)).toEqual([
      {
        kind: 'block',
        field: { key: 'Reason', value: 'spamming invite links', fenced: true, unavailable: false }
      }
    ])
  })

  it('maps "a -> b" values to arrows and the rest to kv rows', () => {
    const m = parseDetails('Name: EWW -> Engaging Without Warning\nRole: Raider')
    expect(detailBlocks(m)).toEqual([
      { kind: 'arrow', key: 'Name', from: 'EWW', to: 'Engaging Without Warning' },
      { kind: 'kv', key: 'Role', value: 'Raider' }
    ])
  })
})

describe('detailPreview', () => {
  it('is empty for an empty model', () => {
    expect(detailPreview(parseDetails(undefined))).toEqual([])
  })

  it('previews a diff as quoted first lines', () => {
    const m = parseDetails('Before: ```\ntest\nmore\n```\nAfter: ```\ntest 2\n```')
    expect(detailPreview(m)).toEqual([{ t: '“test” → “test 2”' }])
  })

  it('previews ± tags with first entries of each sign', () => {
    const m = parseDetails('Added: Raider, Officer\nRemoved: Trial')
    expect(detailPreview(m)).toEqual([{ t: '+ Raider · − Trial' }])
  })

  it('previews unavailable content as a note', () => {
    const m = parseDetails('Content: Unavailable (not cached).')
    expect(detailPreview(m)).toEqual([{ t: 'content unavailable' }])
  })

  it('previews a content block as its quoted first line', () => {
    const m = parseDetails('Reason: ```\nspamming invite links\nsecond line\n```')
    expect(detailPreview(m)).toEqual([{ t: '“spamming invite links”' }])
  })

  it('previews arrows and kv rows as key: value text', () => {
    expect(detailPreview(parseDetails('AFK Timeout: 300s -> 900s'))).toEqual([
      { t: 'AFK Timeout: 300s → 900s' }
    ])
    expect(detailPreview(parseDetails('Attachments: 1'))).toEqual([{ t: 'Attachments: 1' }])
  })
})
