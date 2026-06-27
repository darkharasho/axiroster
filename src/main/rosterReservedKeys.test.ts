// src/main/rosterReservedKeys.test.ts
import { describe, it, expect } from 'vitest'
import { isReservedAnnotationKey } from './rosterReconcile'

describe('isReservedAnnotationKey', () => {
  it('flags meta: keys as reserved', () => {
    expect(isReservedAnnotationKey('meta:tags')).toBe(true)
  })
  it('does not flag member ids or acct keys', () => {
    expect(isReservedAnnotationKey('201537071804973056')).toBe(false)
    expect(isReservedAnnotationKey('acct:Eternal.1234')).toBe(false)
  })
})
