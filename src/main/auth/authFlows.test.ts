import { test, expect } from 'vitest'
import { codeFromCallback } from './authFlows'

test('extracts code from callback url', () =>
  expect(codeFromCallback('axiroster://auth-callback?code=abc123')).toBe('abc123'))

test('null when no code', () =>
  expect(codeFromCallback('axiroster://auth-callback')).toBeNull())
