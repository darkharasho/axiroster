// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { deferred, fakeClient, guild } from './test/fakeClient'

// BlockNote (via MemberDetail) does not load under jsdom and is never opened here.
vi.mock('./components/NotesEditor', () => ({ default: () => null }))

import App from './App'

afterEach(cleanup)

const A = guild('a', { name: 'Alpha', active: true })
const B = guild('b', { name: 'Bravo' })
const C = guild('c', { name: 'Charlie' })

async function renderApp(setActive: (id: string) => Promise<void>) {
  const fc = fakeClient({ listGuilds: async () => [A, B, C], setActiveGuild: setActive })
  render(<App />)
  await act(async () => {})
  return fc
}
const row = (name: string): HTMLElement => screen.getByText(name).closest('button') as HTMLElement
const busy = (): HTMLElement | null => document.querySelector('main [aria-busy="true"]')

describe('guild switching', () => {
  it('highlights the new guild and shows the skeleton before setActiveGuild resolves', async () => {
    const pending = deferred<void>()
    const fc = await renderApp(async (id) => (id === 'b' ? pending.promise : undefined))
    const buildsBefore = fc.api.buildRoster.mock.calls.length

    act(() => { fireEvent.click(row('Bravo')) })
    expect(row('Bravo').className).toContain('ar-guild--on')
    expect(busy()?.getAttribute('aria-label')).toBe('Loading roster…')
    expect(fc.api.buildRoster.mock.calls.length).toBe(buildsBefore) // nothing fetches mid-switch

    await act(async () => pending.resolve())
    expect(fc.api.buildRoster.mock.calls.length).toBe(buildsBefore + 1) // remounted once, for B
    expect(screen.getByPlaceholderText('Search roster…')).not.toHaveProperty('disabled', true)
  })

  it('A→B→C with earlier switches resolving last mounts only C', async () => {
    const waits: Record<string, ReturnType<typeof deferred<void>>> = { a: deferred(), b: deferred(), c: deferred() }
    const fc = await renderApp((id) => waits[id].promise)
    act(() => { fireEvent.click(row('Bravo')) })
    act(() => { fireEvent.click(row('Charlie')) })
    act(() => { fireEvent.click(row('Alpha')) })
    act(() => { fireEvent.click(row('Charlie')) })
    const buildsBefore = fc.api.buildRoster.mock.calls.length

    await act(async () => waits.c.resolve())
    expect(busy()).toBeNull()
    expect(fc.api.buildRoster.mock.calls.length).toBe(buildsBefore + 1)
    await act(async () => { waits.b.resolve(); waits.a.resolve() })
    expect(busy()).toBeNull()
    expect(screen.queryByText("Couldn't open this guild")).toBeNull()
    expect(fc.api.buildRoster.mock.calls.length).toBe(buildsBefore + 1)
    expect(row('Charlie').className).toContain('ar-guild--on')
  })

  it('shows the error with Retry when setActiveGuild rejects, and Retry switches again', async () => {
    const setActive = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
    const fc = await renderApp(setActive)
    await act(async () => { fireEvent.click(row('Bravo')) })
    expect(screen.getByText("Couldn't open this guild")).toBeTruthy()
    expect(screen.getByText('offline')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByText('Retry')) })
    expect(fc.api.setActiveGuild).toHaveBeenLastCalledWith('b')
    expect(screen.queryByText("Couldn't open this guild")).toBeNull()
  })

  it('remounts the view per guild, so search state resets', async () => {
    await renderApp(async () => {})
    const search = screen.getByPlaceholderText('Search roster…') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'zed' } })
    expect(search.value).toBe('zed')
    await act(async () => { fireEvent.click(row('Bravo')) })
    expect((screen.getByPlaceholderText('Search roster…') as HTMLInputElement).value).toBe('')
  })

  it('re-clicking the open, active guild does not switch again', async () => {
    const fc = await renderApp(async () => {})
    await act(async () => { fireEvent.click(row('Alpha')) })
    expect(fc.api.setActiveGuild).not.toHaveBeenCalled()
    expect(busy()).toBeNull()
  })
})
