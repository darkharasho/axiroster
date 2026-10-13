// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AuditEvent } from '../../../preload/index.d'
import { fakeClient } from '../test/fakeClient'
import MemberHistory, { HISTORY_PREVIEW } from './MemberHistory'

afterEach(cleanup)

function kick(i: number): AuditEvent {
  return {
    uid: `gw2:${i}`, source: 'gw2', id: String(i), time: `2026-0${(i % 9) + 1}-01T12:00:00Z`, type: 'kick',
    actor: 'Foo.1234', target: 'Off.1', summary: 'Foo.1234 was kicked by Off.1',
    raw: { user: 'Foo.1234', kicked_by: 'Off.1' }
  }
}

describe('MemberHistory', () => {
  it('asks the audit log for this person only and renders their events', async () => {
    const c = fakeClient({ auditList: async () => ({ events: [kick(1)], updatedAt: '' }) })
    render(<MemberHistory accounts={['Foo.1234']} discordIds={['42']} />)
    await act(async () => {})
    expect(c.api.auditList).toHaveBeenCalledWith({ person: { accounts: ['Foo.1234'], discordIds: ['42'] } })
    expect(screen.getByText('was kicked by')).toBeTruthy()
    expect(screen.queryByText(/Link a Discord account/)).toBeNull()
  })

  it('says so when there is nothing, and hints at linking Discord when unlinked', async () => {
    fakeClient({ auditList: async () => ({ events: [], updatedAt: '' }) })
    render(<MemberHistory accounts={['Foo.1234']} discordIds={[]} />)
    await act(async () => {})
    expect(screen.getByText(/Nothing in the audit log for this person yet/)).toBeTruthy()
    expect(screen.getByText(/Link a Discord account to include Discord actions/)).toBeTruthy()
  })

  it(`shows the newest ${HISTORY_PREVIEW} and then all on request`, async () => {
    const events = Array.from({ length: HISTORY_PREVIEW + 5 }, (_, i) => kick(i))
    fakeClient({ auditList: async () => ({ events, updatedAt: '' }) })
    render(<MemberHistory accounts={['Foo.1234']} discordIds={['42']} />)
    await act(async () => {})
    expect(screen.getAllByText('was kicked by')).toHaveLength(HISTORY_PREVIEW)
    fireEvent.click(screen.getByText(`Show all ${HISTORY_PREVIEW + 5}`))
    expect(screen.getAllByText('was kicked by')).toHaveLength(HISTORY_PREVIEW + 5)
  })

  it('reloads when new audit events arrive', async () => {
    const c = fakeClient({ auditList: async () => ({ events: [], updatedAt: '' }) })
    render(<MemberHistory accounts={['Foo.1234']} discordIds={[]} />)
    await act(async () => {})
    expect(c.api.auditList).toHaveBeenCalledTimes(1)
    c.api.auditList.mockResolvedValue({ events: [kick(1)], updatedAt: '' })
    await act(async () => {
      c.emit("onAuditUpdated")
      await new Promise((r) => setTimeout(r, 250))
    })
    expect(screen.getByText('was kicked by')).toBeTruthy()
  })
})
