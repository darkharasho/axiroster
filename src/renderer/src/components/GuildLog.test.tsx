// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { deferred, fakeClient } from '../test/fakeClient'
import GuildLog from './GuildLog'

afterEach(cleanup)

describe('GuildLog loading', () => {
  it('shows the skeleton, not the empty state, while the first list loads', async () => {
    const list = deferred<{ events: never[]; updatedAt: string }>()
    fakeClient({ auditList: () => list.promise })
    render(<GuildLog />)
    expect(document.querySelector('[aria-label="Loading log…"]')).not.toBeNull()
    expect(screen.queryByText(/No log entries yet/)).toBeNull()
    await act(async () => list.resolve({ events: [], updatedAt: '' }))
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
    expect(screen.getByText(/No log entries yet/)).toBeTruthy()
  })

  it('refetches on a search change without showing the skeleton again', async () => {
    const fc = fakeClient()
    render(<GuildLog />)
    await act(async () => {})
    fireEvent.change(screen.getByPlaceholderText('Search name or action…'), { target: { value: 'kick' } })
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
    await act(async () => {})
    expect(fc.api.auditList).toHaveBeenLastCalledWith({ search: 'kick' })
  })
})
