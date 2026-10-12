import { test, expect, vi } from 'vitest'
import { fetchAllPages } from './paging'

test('reads pages until a short one', async () => {
  const pages = [Array.from({ length: 1000 }, (_, i) => ({ i })), [{ i: 1000 }]]
  const page = vi.fn(async (from: number) => ({ data: pages[from / 1000] ?? [], error: null }))
  const r = await fetchAllPages(page)
  expect(r.error).toBeNull()
  expect(r.data).toHaveLength(1001)
  expect(page).toHaveBeenNthCalledWith(1, 0, 999)
  expect(page).toHaveBeenNthCalledWith(2, 1000, 1999)
})

test('stops at the first failing page', async () => {
  const page = vi.fn(async () => ({ data: null, error: { message: 'boom' } }))
  const r = await fetchAllPages(page)
  expect(r.error).toEqual({ message: 'boom' })
  expect(page).toHaveBeenCalledTimes(1)
})
