// src/renderer/src/lib/client.test.ts
import { test, expect, vi } from 'vitest'

test('getClient throws before any setClient', async () => {
  vi.resetModules()
  const mod = await import('./client')
  expect(() => mod.getClient()).toThrow(/not initialized/i)
})

test('client forwards calls to the installed impl and returns its value', async () => {
  vi.resetModules()
  const mod = await import('./client')
  const fake = { listGuilds: vi.fn(async () => [{ id: 'g' }]) } as never
  mod.setClient(fake)
  await expect((mod.client as { listGuilds(): Promise<unknown> }).listGuilds()).resolves.toEqual([
    { id: 'g' }
  ])
  expect((fake as { listGuilds: ReturnType<typeof vi.fn> }).listGuilds).toHaveBeenCalled()
})

test('setClient swaps the active impl', async () => {
  vi.resetModules()
  const mod = await import('./client')
  const a = { ping: vi.fn(() => 'a') } as never
  const b = { ping: vi.fn(() => 'b') } as never
  mod.setClient(a)
  expect((mod.client as unknown as { ping(): string }).ping()).toBe('a')
  mod.setClient(b)
  expect((mod.client as unknown as { ping(): string }).ping()).toBe('b')
})

test('event-style methods forward and return the unsubscribe fn', async () => {
  vi.resetModules()
  const mod = await import('./client')
  const off = vi.fn()
  const fake = { onWorkspaceChanged: vi.fn(() => off) } as never
  mod.setClient(fake)
  const ret = (mod.client as unknown as { onWorkspaceChanged(cb: () => void): () => void }).onWorkspaceChanged(
    () => {}
  )
  expect(ret).toBe(off)
})
