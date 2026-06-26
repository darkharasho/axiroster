import { test, expect } from 'vitest'
import { discordIdFromUser } from './identity'

test('reads discord id from the discord identity (provider_id)', () => {
  const user = {
    identities: [{ provider: 'discord', id: 'abc', identity_data: { provider_id: '12345', sub: '12345' } }]
  }
  expect(discordIdFromUser(user)).toBe('12345')
})

test('falls back to identity.id when identity_data lacks provider_id/sub', () => {
  const user = { identities: [{ provider: 'discord', id: 'rawid', identity_data: {} }] }
  expect(discordIdFromUser(user)).toBe('rawid')
})

test('returns null when there is no discord identity', () => {
  const user = { identities: [{ provider: 'email', id: 'e', identity_data: {} }] }
  expect(discordIdFromUser(user)).toBeNull()
})

test('ignores user_metadata entirely (spoofing guard)', () => {
  // A user-editable user_metadata.provider_id must NOT influence the result.
  const user = {
    identities: [{ provider: 'discord', id: 'real', identity_data: { provider_id: 'real-discord' } }],
    user_metadata: { provider_id: 'spoofed-victim-id' }
  } as unknown as Parameters<typeof discordIdFromUser>[0]
  expect(discordIdFromUser(user)).toBe('real-discord')
})
