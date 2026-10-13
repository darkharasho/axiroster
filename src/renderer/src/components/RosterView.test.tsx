// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { fakeClient } from '../test/fakeClient'

vi.mock('./NotesEditor', () => ({ default: () => null }))
import RosterView from './RosterView'

afterEach(cleanup)

describe('RosterView loading', () => {
  it('loads the tag registry on every mount, with the roster', async () => {
    const fc = fakeClient()
    const first = render(<RosterView key="a" />)
    await act(async () => {})
    expect(fc.api.getTagRegistry).toHaveBeenCalledTimes(1)
    first.rerender(<RosterView key="b" />)
    await act(async () => {})
    expect(fc.api.getTagRegistry).toHaveBeenCalledTimes(2)
  })

  it('also reloads the tag registry on a sync event', async () => {
    vi.useFakeTimers()
    const fc = fakeClient()
    render(<RosterView />)
    await act(async () => {})
    act(() => fc.emit('onSyncChanged'))
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(fc.api.getTagRegistry).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('shows LoadError when the first build fails', async () => {
    fakeClient({ buildRoster: async () => ({ ok: false, error: 'GW2 API down' }) })
    const { findByText } = render(<RosterView />)
    expect(await findByText("Couldn't load the roster")).toBeTruthy()
    expect(await findByText('GW2 API down')).toBeTruthy()
  })
})
