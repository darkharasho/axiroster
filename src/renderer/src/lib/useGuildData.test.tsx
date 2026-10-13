// @vitest-environment jsdom
import { StrictMode, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useGuildData } from './useGuildData'
import { subscribeToast, type ToastInput } from './toast'
import { deferred, fakeClient } from '../test/fakeClient'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useGuildData', () => {
  it('is loading until the first load resolves; a reload with data never sets loading again', async () => {
    fakeClient()
    const first = deferred<string>()
    const second = deferred<string>()
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useGuildData(load))
    expect(result.current).toMatchObject({ loading: true, data: null, refreshing: false })

    await act(async () => first.resolve('a'))
    expect(result.current).toMatchObject({ loading: false, data: 'a', error: null })

    act(() => { void result.current.reload() })
    expect(result.current).toMatchObject({ loading: false, refreshing: true, data: 'a' })
    await act(async () => second.resolve('b'))
    expect(result.current).toMatchObject({ loading: false, refreshing: false, data: 'b' })
  })

  it('keeps the data and toasts when a refresh fails', async () => {
    fakeClient()
    const seen: ToastInput[] = []
    const off = subscribeToast((t) => seen.push(t))
    const load = vi.fn().mockResolvedValueOnce('a').mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useGuildData(load))
    await act(async () => {})
    await act(async () => { await result.current.reload() })
    expect(result.current).toMatchObject({ data: 'a', error: null, loading: false })
    expect(seen).toEqual([{ message: "Couldn't refresh: offline", variant: 'error' }])
    off()
  })

  it('sets error with no data when the first load fails, and a retry shows loading again', async () => {
    fakeClient()
    const seen: ToastInput[] = []
    const off = subscribeToast((t) => seen.push(t))
    const retry = deferred<string>()
    const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockReturnValueOnce(retry.promise)
    const { result } = renderHook(() => useGuildData(load))
    await act(async () => {})
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeNull()
    expect((result.current.error as Error).message).toBe('boom')
    expect(seen).toEqual([])

    act(() => { void result.current.reload() })
    expect(result.current).toMatchObject({ loading: true, error: null })
    await act(async () => retry.resolve('ok'))
    expect(result.current).toMatchObject({ loading: false, data: 'ok', error: null })
    off()
  })

  it('discards an older request that settles after a newer one', async () => {
    fakeClient()
    const older = deferred<string>()
    const newer = deferred<string>()
    const load = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const { result } = renderHook(() => useGuildData(load))
    act(() => { void result.current.reload() })
    await act(async () => newer.resolve('new'))
    await act(async () => older.resolve('old'))
    expect(result.current.data).toBe('new')
  })

  it('coalesces five events within 200ms into exactly one reload', async () => {
    vi.useFakeTimers()
    const fc = fakeClient()
    const load = vi.fn(async () => 'x')
    renderHook(() => useGuildData(load, { on: ['sync', 'audit', 'workspace'] }))
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(1)
    act(() => {
      fc.emit('onSyncChanged')
      fc.emit('onAuditUpdated')
      fc.emit('onWorkspaceChanged')
      fc.emit('onSyncChanged')
      fc.emit('onAuditUpdated')
    })
    act(() => { vi.advanceTimersByTime(199) })
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('removes its listeners and timer on unmount, and applies nothing late', async () => {
    vi.useFakeTimers()
    const fc = fakeClient()
    const pending = deferred<string>()
    const load = vi.fn().mockReturnValueOnce(pending.promise)
    const { result, unmount } = renderHook(() => useGuildData(load, { on: ['sync', 'workspace'] }))
    expect(fc.listenerCount('onSyncChanged')).toBe(1)
    fc.emit('onSyncChanged') // arms the debounce
    const before = result.current
    unmount()
    expect(fc.listenerCount('onSyncChanged')).toBe(0)
    expect(fc.listenerCount('onWorkspaceChanged')).toBe(0)
    await act(async () => pending.resolve('late'))
    vi.advanceTimersByTime(500)
    expect(load).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(before)
  })

  it('reloads in the background when deps change, without showing loading', async () => {
    fakeClient()
    const load = vi.fn(async () => 'x')
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useGuildData(load, { deps: [q] }),
      { initialProps: { q: '' } }
    )
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(1)
    rerender({ q: 'abc' })
    expect(result.current.loading).toBe(false)
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not refetch when the caller passes a new load function each render', async () => {
    fakeClient()
    const calls: string[] = []
    const { rerender } = renderHook(({ n }: { n: number }) =>
      useGuildData(async () => { calls.push(`v${n}`); return n }), { initialProps: { n: 1 } })
    await act(async () => {})
    rerender({ n: 2 })
    await act(async () => {})
    expect(calls).toEqual(['v1'])
  })

  it('under StrictMode applies the latest result and holds one listener per event', async () => {
    const fc = fakeClient()
    let n = 0
    const load = vi.fn(async () => ++n)
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => <StrictMode>{children}</StrictMode>
    const { result } = renderHook(() => useGuildData(load, { on: ['sync'] }), { wrapper })
    await act(async () => {})
    expect(result.current.data).toBe(load.mock.calls.length)
    expect(fc.listenerCount('onSyncChanged')).toBe(1)
  })
})
