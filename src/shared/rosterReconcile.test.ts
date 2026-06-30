import { test, expect } from 'vitest'
import { isReservedAnnotationKey } from './rosterReconcile'

test('comment: keys are reserved (excluded from member list)', () => {
  expect(isReservedAnnotationKey('comment:abc')).toBe(true)
  expect(isReservedAnnotationKey('123456789')).toBe(false)
})
