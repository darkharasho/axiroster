// src/main/rosterFromSync.test.ts
import { vi, test, expect } from 'vitest'

// Mock electron so importing index.ts in a Node test environment doesn't crash
const mockWebContents = {
  send: vi.fn(),
  setWindowOpenHandler: vi.fn(),
  on: vi.fn(),
  openDevTools: vi.fn()
}
const mockWindow = {
  on: vi.fn(),
  once: vi.fn(),
  webContents: mockWebContents,
  loadURL: vi.fn(),
  loadFile: vi.fn(),
  show: vi.fn(),
  maximize: vi.fn(),
  isMaximized: vi.fn(() => false),
  setAlwaysOnTop: vi.fn()
}
vi.mock('electron', () => ({
  app: {
    setAsDefaultProtocolClient: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    on: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    quit: vi.fn(),
    getPath: vi.fn(() => '/tmp'),
    isPackaged: false,
    getAllWindows: vi.fn(() => [])
  },
  BrowserWindow: Object.assign(vi.fn(() => mockWindow), {
    getAllWindows: vi.fn(() => [])
  }),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: { openExternal: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  safeStorage: {
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString())
  }
}))

import { rosterSourceFor } from './index'

test('uses synced members when no leader key present', () => {
  expect(rosterSourceFor({ hasLeaderKey: false })).toBe('synced')
})
test('uses live pull when leader key present', () => {
  expect(rosterSourceFor({ hasLeaderKey: true })).toBe('live')
})
