import { test, expect } from 'vitest'
import { notImplemented } from './notImplemented'

test('produces a function that throws with the method name', () => {
  expect(() => notImplemented('buildRoster')()).toThrow(/buildRoster: not implemented on web/)
})
