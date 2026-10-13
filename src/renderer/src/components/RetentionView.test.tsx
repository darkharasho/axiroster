// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { AttendanceRaidDTO, RosterPayload } from '../../../preload/index.d'
import { deferred, emptyRoster, fakeClient, member } from '../test/fakeClient'
import RetentionView from './RetentionView'

afterEach(cleanup)

// DEFAULT_RETENTION_CONFIG.minRaidsInWindow is 2; three recent raids clear it.
const raid = (id: string, daysAgo: number, account = 'old.1234'): AttendanceRaidDTO => ({
  id,
  date: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  attendees: [{ account, combatTimeMs: 600_000, squadTimeMs: 600_000 }]
})
const raids = [raid('r1', 1), raid('r2', 3), raid('r3', 5)]

describe('RetentionView', () => {
  it('shows its skeleton while loading', () => {
    fakeClient({ buildRoster: () => new Promise(() => {}) })
    render(<RetentionView />)
    expect(document.querySelector('[aria-label="Loading retention…"]')).not.toBeNull()
  })

  it('logs retention for the loaded guild (fixture sanity)', async () => {
    const fc = fakeClient({
      buildRoster: async () => ({ ok: true as const, data: { ...emptyRoster([member('old')]), attendance: raids } })
    })
    render(<RetentionView />)
    await act(async () => {})
    expect(fc.api.logRetention).toHaveBeenCalled()
  })

  it('never logs results from a guild it has been unmounted from', async () => {
    const stale = deferred<{ ok: true; data: RosterPayload }>()
    const fc = fakeClient({ buildRoster: () => stale.promise })
    const first = render(<RetentionView key="old" />)
    first.unmount()
    await act(async () =>
      stale.resolve({ ok: true, data: { ...emptyRoster([member('old')]), attendance: raids } })
    )
    expect(fc.api.logRetention).not.toHaveBeenCalled()
  })

  it('applies and logs only the latest reload when an older one resolves late', async () => {
    const forGuild = (key: string): RosterPayload => ({
      ...emptyRoster([member(key)]),
      attendance: [raid('r1', 1, `${key}.1234`), raid('r2', 3, `${key}.1234`), raid('r3', 5, `${key}.1234`)]
    })
    const slow = deferred<{ ok: true; data: RosterPayload }>()
    const calls = [
      () => Promise.resolve({ ok: true as const, data: forGuild('first') }),
      () => slow.promise,
      () => Promise.resolve({ ok: true as const, data: forGuild('latest') })
    ]
    let n = 0
    const fc = fakeClient({ buildRoster: () => calls[n++]() })
    const { container } = render(<RetentionView />)
    await act(async () => {})
    const refresh = container.querySelector('button.ar-icon-btn') as HTMLButtonElement
    fireEvent.click(refresh) // slow, will be superseded
    await act(async () => {})
    fireEvent.click(refresh) // latest
    await act(async () => {})
    await act(async () => slow.resolve({ ok: true, data: forGuild('stale') }))
    const logged = (fc.api.logRetention as unknown as { mock: { calls: { memberKey: string }[][][] } }).mock.calls
    const keys = logged.flatMap((c) => c[0].map((r) => r.memberKey))
    expect(keys).toContain('latest')
    expect(keys).not.toContain('stale')
  })
})
