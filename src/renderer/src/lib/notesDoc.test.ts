import { describe, it, expect } from 'vitest'
import { parseNotes, docToPlainText, isEmptyNotes } from './notesDoc'

describe('parseNotes', () => {
  it('returns undefined for empty / whitespace', () => {
    expect(parseNotes('')).toBeUndefined()
    expect(parseNotes('   ')).toBeUndefined()
  })
  it('wraps legacy plain text into a single paragraph block', () => {
    expect(parseNotes('hello world')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'hello world', styles: {} }] }
    ])
  })
  it('returns a stored block array verbatim', () => {
    const doc = [{ type: 'heading', content: [{ type: 'text', text: 'Hi', styles: {} }] }]
    expect(parseNotes(JSON.stringify(doc))).toEqual(doc)
  })
  it('treats a non-array JSON value as legacy text', () => {
    expect(parseNotes('42')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: '42', styles: {} }] }
    ])
  })
})

describe('docToPlainText', () => {
  it('extracts text across blocks and nested children', () => {
    const doc = JSON.stringify([
      { type: 'heading', content: [{ type: 'text', text: 'Title' }] },
      { type: 'bulletListItem', content: [{ type: 'text', text: 'one' }],
        children: [{ type: 'bulletListItem', content: [{ type: 'text', text: 'nested' }] }] }
    ])
    expect(docToPlainText(doc)).toBe('Title\none\nnested')
  })
  it('returns legacy text unchanged', () => {
    expect(docToPlainText('just notes')).toBe('just notes')
  })
  it('returns empty for empty input', () => {
    expect(docToPlainText('')).toBe('')
  })
})

describe('isEmptyNotes', () => {
  it('is true for empty string and an empty paragraph doc', () => {
    expect(isEmptyNotes('')).toBe(true)
    expect(isEmptyNotes(JSON.stringify([{ type: 'paragraph', content: [] }]))).toBe(true)
  })
  it('is false when there is text', () => {
    expect(isEmptyNotes(JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }]))).toBe(false)
  })
})
