import { describe, expect, it } from 'vitest'
import { activateGuild } from './activateGuild'

describe('activateGuild', () => {
  it('sets the guild active, then awaits initSync (which sends workspace:changed itself)', async () => {
    const order: string[] = []
    await activateGuild('g2', {
      setActive: (id) => { order.push(`setActive:${id}`) },
      initSync: async () => { order.push('initSync') }
    })
    expect(order).toEqual(['setActive:g2', 'initSync'])
  })

  it('rejects when initSync fails, so the renderer can show the error', async () => {
    await expect(
      activateGuild('g2', { setActive: () => {}, initSync: async () => { throw new Error('offline') } })
    ).rejects.toThrow('offline')
  })
})
