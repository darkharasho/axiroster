import { describe, expect, it, vi } from 'vitest'
import { activateGuild } from './activateGuild'

describe('activateGuild', () => {
  it('sets the guild active, awaits initSync, then sends workspace:changed once', async () => {
    const order: string[] = []
    const notify = vi.fn((ch: string) => { order.push(`notify:${ch}`) })
    await activateGuild('g2', {
      setActive: (id) => { order.push(`setActive:${id}`) },
      initSync: async () => { order.push('initSync') },
      notify
    })
    expect(order).toEqual(['setActive:g2', 'initSync', 'notify:workspace:changed'])
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).not.toHaveBeenCalledWith('sync:changed')
  })

  it('rejects without notifying when initSync fails, so the renderer can show the error', async () => {
    const notify = vi.fn()
    await expect(
      activateGuild('g2', { setActive: () => {}, initSync: async () => { throw new Error('offline') }, notify })
    ).rejects.toThrow('offline')
    expect(notify).not.toHaveBeenCalled()
  })
})
