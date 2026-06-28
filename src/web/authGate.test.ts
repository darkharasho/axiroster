import { test, expect } from 'vitest'
import { chooseView } from './authGate'

test('null status (still resolving) -> loading', () => {
  expect(chooseView(null)).toBe('loading')
})

test('signed in -> app', () => {
  expect(chooseView({ signedIn: true, role: 'owner', workspaceId: 'w1', userId: 'u1' })).toBe('app')
})

test('signed out -> landing', () => {
  expect(chooseView({ signedIn: false })).toBe('landing')
})
