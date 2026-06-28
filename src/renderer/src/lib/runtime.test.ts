import { test, expect } from 'vitest'
import { isWeb, setWeb } from './runtime'

test('defaults to false (Electron) and toggles', () => {
  expect(isWeb()).toBe(false)
  setWeb(true)
  expect(isWeb()).toBe(true)
  setWeb(false)
})
