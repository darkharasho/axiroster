// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { RosterPayload } from '../../../preload/index.d'
import { deferred, emptyRoster, fakeClient, member } from '../test/fakeClient'
import RecruitmentView from './RecruitmentView'

afterEach(cleanup)

const pipe = (placement: Record<string, string>) => ({
  stages: undefined, placement, placedAt: {}, prospects: [], votes: [], commentCounts: {}
})

describe('RecruitmentView prune', () => {
  it('never prunes before its own roster has loaded', async () => {
    const roster = deferred<{ ok: true; data: RosterPayload }>()
    const fc = fakeClient({
      buildRoster: () => roster.promise,
      pipelineGet: async () => pipe({ m1: 'applied', ghost: 'applied' })
    })
    render(<RecruitmentView />)
    expect(document.querySelector('[aria-label="Loading recruitment…"]')).not.toBeNull()
    await act(async () => {})
    expect(fc.api.pipelinePrunePlacements).not.toHaveBeenCalled()
    await act(async () => roster.resolve({ ok: true, data: emptyRoster([member('m1')]) }))
    expect(fc.api.pipelinePrunePlacements).toHaveBeenCalledTimes(1)
    expect(fc.api.pipelinePrunePlacements).toHaveBeenCalledWith(['ghost'])
  })

  it('never prunes when its roster comes back empty', async () => {
    const fc = fakeClient({ pipelineGet: async () => pipe({ m1: 'applied' }) })
    render(<RecruitmentView />)
    await act(async () => {})
    expect(fc.api.pipelinePrunePlacements).not.toHaveBeenCalled()
  })

  it('prunes at most once per mount even after a background reload', async () => {
    const fc = fakeClient({
      buildRoster: async () => ({ ok: true, data: emptyRoster([member('m1')]) }),
      pipelineGet: async () => pipe({ m1: 'applied', ghost: 'applied' }),
      pipelinePrunePlacements: async () => 0
    })
    const { getByLabelText } = render(<RecruitmentView />)
    await act(async () => {})
    await act(async () => { getByLabelText('Refresh').click() })
    expect(fc.api.pipelinePrunePlacements).toHaveBeenCalledTimes(1)
  })
})
