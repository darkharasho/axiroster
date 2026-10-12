// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { deferred, fakeClient } from '../test/fakeClient'
import DepartedView from './DepartedView'

afterEach(cleanup)

describe('DepartedView loading', () => {
  it('shows its skeleton until departures arrive, then the empty state', async () => {
    const rows = deferred<never[]>()
    fakeClient({ departuresGet: () => rows.promise })
    render(<DepartedView />)
    expect(document.querySelector('[aria-label="Loading departures…"]')).not.toBeNull()
    await act(async () => rows.resolve([]))
    expect(screen.getByText(/No departures recorded yet/)).toBeTruthy()
  })

  it('keeps showing departures with a banner when only the roster build fails', async () => {
    fakeClient({ buildRoster: async () => ({ ok: false, error: 'GW2 API down' }) })
    render(<DepartedView />)
    await act(async () => {})
    expect(screen.getByText('GW2 API down')).toBeTruthy()
    expect(screen.queryByText("Couldn't load departures")).toBeNull()
  })
})
