import { describe, it, expect } from 'vitest'
import { discordVerb } from './auditIdentities'

describe('discordVerb', () => {
  it('maps known channel/member event types to verb phrases', () => {
    expect(discordVerb('channel_create')).toBe('created channel')
    expect(discordVerb('channel_delete')).toBe('deleted channel')
    expect(discordVerb('channel_update')).toBe('updated channel')
    expect(discordVerb('member_leave')).toBe('left the server')
    expect(discordVerb('member_kick')).toBe('was kicked')
  })

  it('falls back to a de-underscored type for unmapped events', () => {
    expect(discordVerb('some_new_event')).toBe('some new event')
  })
})
