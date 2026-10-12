// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { fakeClient, guild } from '../test/fakeClient'
import GuildSharing from './GuildSharing'

afterEach(cleanup)

describe('GuildSharing', () => {
  it('loads exactly once per mount', async () => {
    const fc = fakeClient()
    render(<GuildSharing guild={guild('a')} onOpenAppSettings={() => {}} />)
    expect(document.querySelector('[aria-label="Loading sharing…"]')).not.toBeNull()
    await act(async () => {})
    expect(fc.api.adoptSharedKeys).toHaveBeenCalledTimes(1)
    expect(fc.api.listWorkspaceRoles).toHaveBeenCalledTimes(1)
  })
})
