import { test, expect } from 'vitest'
import { isReservedAnnotationKey, reconcileRoster } from './rosterReconcile'

test('comment: keys are reserved (excluded from member list)', () => {
  expect(isReservedAnnotationKey('comment:abc')).toBe(true)
  expect(isReservedAnnotationKey('123456789')).toBe(false)
})

test('a member gets the earliest in-guild join date and their Discord join date', () => {
  const out = reconcileRoster({
    discordMembers: [{ id: 'd1', name: 'alice', joined_at: '2023-01-12T08:00:00Z' }],
    linked: [
      {
        member_id: 'd1',
        accounts: [{ account_name: 'Alice.1' }, { account_name: 'Alice.2' }, { account_name: 'Alice.3' }]
      }
    ],
    inGameRoster: [
      { name: 'Alice.1', joined: '2024-06-01T00:00:00Z' },
      { name: 'Alice.2', joined: '2024-03-04T00:00:00Z' }
    ],
    manualLinks: [],
    annotations: [],
    memberRoleId: null,
    haveInGame: true
  })
  expect(out[0].joined).toBe('2024-03-04T00:00:00Z')
  expect(out[0].discordJoined).toBe('2023-01-12T08:00:00Z')
})

test('a role holder with no key still carries their Discord join date', () => {
  const out = reconcileRoster({
    discordMembers: [{ id: 'd2', name: 'bob', roles: ['r'], joined_at: '2022-05-05T00:00:00Z' }],
    linked: [],
    inGameRoster: [],
    manualLinks: [],
    annotations: [],
    memberRoleId: 'r',
    haveInGame: false
  })
  expect(out[0].status).toBe('no-key')
  expect(out[0].joined).toBeUndefined()
  expect(out[0].discordJoined).toBe('2022-05-05T00:00:00Z')
})
