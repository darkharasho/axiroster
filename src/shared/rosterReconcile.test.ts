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

test('departure: keys are reserved', () => {
  expect(isReservedAnnotationKey('departure:foo.1234')).toBe(true)
})

test('reconcileRoster never surfaces a departure: row as a member', () => {
  const out = reconcileRoster({
    discordMembers: [],
    linked: [],
    inGameRoster: [{ name: 'Foo.1234' }],
    manualLinks: [],
    annotations: [
      { memberId: 'departure:foo.1234', nickname: '', aliases: [], notes: '{"account":"Foo.1234"}', tags: [] }
    ],
    memberRoleId: null,
    haveInGame: true
  })
  expect(out.map((m) => m.annotationKey)).toEqual(['acct:Foo.1234'])
  expect(out[0].notes).toBe('')
})
