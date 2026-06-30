import { describe, it, expect } from 'vitest'
import { discordVerb, describeEvent, buildIdentityIndex } from './auditIdentities'
import type { AuditEvent } from '../../../preload/index.d'

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

const idx = buildIdentityIndex([])

function discordEvent(raw: Record<string, unknown>): AuditEvent {
  return {
    uid: `discord:${raw.id}`,
    source: 'discord',
    id: String(raw.id),
    time: '2026-06-30T07:38:00Z',
    type: String(raw.event_type),
    summary: '',
    raw
  }
}

describe('describeDiscord', () => {
  it('renders a channel event with verb + channel chip from channel_name', () => {
    const m = describeEvent(
      discordEvent({
        id: 1,
        event_type: 'channel_create',
        actor_id: '42',
        actor_name: 'rooster',
        target_type: 'channel',
        channel_id: '1449262177046495356',
        channel_name: 'raid-signups'
      }),
      idx
    )
    expect(m.action.map((s) => s.t).join('')).toContain('created channel')
    expect(m.channel).toEqual({ name: 'raid-signups', id: '1449262177046495356' })
    expect(m.lead?.discordName).toBe('rooster')
  })

  it('always shows a verb for a member leave (no actor)', () => {
    const m = describeEvent(
      discordEvent({ id: 2, event_type: 'member_leave', target_id: '7', target_name: 'khava', target_type: 'user' }),
      idx
    )
    expect(m.action.map((s) => s.t).join('')).toContain('left the server')
    expect(m.lead?.discordName).toBe('khava')
    expect(m.channel).toBeUndefined()
  })

  it('falls back to the channel id from a <#id> token in details for old rows', () => {
    const m = describeEvent(
      discordEvent({ id: 3, event_type: 'channel_delete', actor_name: 'rooster', details: 'Channel: <#999>' }),
      idx
    )
    expect(m.channel).toEqual({ id: '999' })
    expect(m.action.map((s) => s.t).join('')).toContain('deleted channel')
  })
})
