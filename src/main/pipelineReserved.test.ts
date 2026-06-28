// src/main/pipelineReserved.test.ts
import { describe, it, expect } from 'vitest'
import { isReservedAnnotationKey } from '../shared/rosterReconcile'

describe('isReservedAnnotationKey — pipeline keys', () => {
  it('reserves meta:/prospect:/vote:', () => {
    expect(isReservedAnnotationKey('meta:pipeline')).toBe(true)
    expect(isReservedAnnotationKey('prospect:abc-123')).toBe(true)
    expect(isReservedAnnotationKey('vote:user-9')).toBe(true)
  })
  it('does not reserve real member/account keys', () => {
    expect(isReservedAnnotationKey('201537071804973056')).toBe(false)
    expect(isReservedAnnotationKey('acct:Eternal.1234')).toBe(false)
  })
})
