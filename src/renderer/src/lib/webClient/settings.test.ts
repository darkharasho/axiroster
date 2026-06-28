import { test, expect } from 'vitest'
import { createWebSettings } from './settings'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size
    }
  } as Storage
}

test('round-trips and returns null for a missing key', () => {
  const s = createWebSettings(fakeStorage())
  expect(s.get('activeGuildId')).toBeNull()
  s.set('activeGuildId', 'g1')
  expect(s.get('activeGuildId')).toBe('g1')
})

test('namespaces keys under axiroster:setting:', () => {
  const store = fakeStorage()
  createWebSettings(store).set('k', 'v')
  expect(store.getItem('axiroster:setting:k')).toBe('v')
  expect(store.getItem('k')).toBeNull()
})
