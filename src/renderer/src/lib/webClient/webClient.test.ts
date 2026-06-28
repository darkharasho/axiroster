import { test, expect, vi } from 'vitest'
import { createWebClient } from './webClient'

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

test('platform() maps the user agent', async () => {
  expect(await createWebClient({ userAgent: 'Mozilla Mac OS X' }).platform()).toBe('darwin')
  expect(await createWebClient({ userAgent: 'Windows NT 10' }).platform()).toBe('win32')
  expect(await createWebClient({ userAgent: 'X11; Linux x86_64' }).platform()).toBe('linux')
})

test('appVersion() uses the injected version or the default', async () => {
  expect(await createWebClient({ appVersion: '1.2.3' }).appVersion()).toBe('1.2.3')
  expect(await createWebClient({ appVersion: undefined }).appVersion()).toBe('0.0.0-web')
})

test('openExternal opens a noopener tab', async () => {
  const open = vi.fn()
  await createWebClient({ open }).openExternal('https://x.test')
  expect(open).toHaveBeenCalledWith('https://x.test', '_blank', 'noopener,noreferrer')
})

test('settings round-trip through the injected storage', async () => {
  const c = createWebClient({ storage: fakeStorage() })
  expect(await c.getSetting('k')).toBeNull()
  await c.setSetting('k', 'v')
  expect(await c.getSetting('k')).toBe('v')
})

test('window/update/sync/audit stubs resolve sensibly', async () => {
  const c = createWebClient({ storage: fakeStorage() })
  await expect(c.windowMaximizeToggle()).resolves.toBe(false)
  await expect(c.windowIsMaximized()).resolves.toBe(false)
  await expect(c.checkForUpdate()).resolves.toEqual({ ok: true })
  await expect(c.syncStatus()).resolves.toBe('disabled')
  await expect(c.reinitSync()).resolves.toBe('disabled')
  await expect(c.auditStatus()).resolves.toBeNull()
  await expect(c.getWhatsNew()).resolves.toMatchObject({ releaseNotes: null })
})

test('event subscriptions return a callable no-op unsubscribe', () => {
  const c = createWebClient({ storage: fakeStorage() })
  const unsub = c.onWorkspaceChanged(() => {})
  expect(typeof unsub).toBe('function')
  expect(() => unsub()).not.toThrow()
})

test('a data method throws not-implemented (sync)', () => {
  expect(() => createWebClient({ storage: fakeStorage() }).buildRoster()).toThrow(
    /not implemented on web/
  )
})
