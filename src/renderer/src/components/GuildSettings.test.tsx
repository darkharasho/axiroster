// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { deferred, fakeClient, guild } from '../test/fakeClient'
import type { GuildProfile } from '../../../preload/index.d'
import GuildSettings from './GuildSettings'

afterEach(cleanup)

const profile = (id: string, name: string): GuildProfile => ({
  id,
  name,
  gw2ApiKey: '',
  gw2GuildId: '',
  gw2GuildName: '',
  gw2AccountName: '',
  axitoolsKey: '',
  discordGuildId: '',
  discordGuildName: '',
  memberRoleId: '',
  bridgeRepos: [],
  shared: false,
  axitoolsShared: false,
  retentionEnabled: false,
  pipelineEnabled: true
})

describe('GuildSettings', () => {
  it("never shows the previous guild's profile while the next one loads", async () => {
    const second = deferred<GuildProfile>()
    fakeClient({
      getGuild: (id: string) => (id === 'a' ? Promise.resolve(profile('a', 'Alpha Name')) : second.promise)
    } as never)
    const noop = (): void => {}
    const view = render(<GuildSettings key="a" guild={guild('a')} onChanged={noop} onRemoved={noop} />)
    await act(async () => {})
    expect(screen.getByDisplayValue('Alpha Name')).toBeTruthy()
    view.rerender(<GuildSettings key="b" guild={guild('b')} onChanged={noop} onRemoved={noop} />)
    expect(screen.queryByDisplayValue('Alpha Name')).toBeNull()
    expect(document.querySelector('[aria-label="Loading settings…"]')).not.toBeNull()
    await act(async () => second.resolve(profile('b', 'Bravo Name')))
    expect(screen.getByDisplayValue('Bravo Name')).toBeTruthy()
  })
})
