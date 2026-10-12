// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { deferred, emptyRoster, fakeClient, member } from '../test/fakeClient'
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

describe('DepartedView background reload', () => {
  it('keeps the flagged count when a background roster build fails', async () => {
    let up = true
    const doc = {
      account: 'Foo.1234', memberId: 'd1', dismissedSuggestions: [], note: '',
      episodes: [{ kind: 'left', actor: null, at: '2026-01-01T00:00:00Z', source: 'roster-diff', auditUid: null, reason: '', rejoinedAt: null }]
    }
    fakeClient({
      departuresGet: async () => [{ key: 'departure:foo.1234', notes: JSON.stringify(doc) }],
      buildRoster: async () =>
        up
          ? {
              ok: true,
              data: {
                ...emptyRoster([member('m1', { memberId: 'd1', hasMemberRole: true, inGuild: false })]),
                memberRoleId: 'role'
              }
            }
          : { ok: false, error: 'GW2 API down' }
    })
    render(<DepartedView />)
    await act(async () => {})
    const flagged = (): string => screen.getByRole('button', { name: /^Flagged/ }).textContent ?? ''
    expect(flagged()).toBe('Flagged1')
    up = false
    await act(async () => { screen.getByLabelText('Refresh').click() })
    expect(screen.getByText('GW2 API down')).toBeTruthy()
    expect(flagged()).toBe('Flagged1')
  })
})
