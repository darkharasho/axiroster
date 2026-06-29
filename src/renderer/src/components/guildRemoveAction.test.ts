import { test, expect } from 'vitest'
import { guildRemoveAction } from './GuildSettings'

test('desktop: always Remove with the destructive confirm', () => {
  expect(guildRemoveAction('owner', false, 'Saga')).toEqual({
    label: 'Remove',
    title: 'Remove guild',
    confirmText: 'Remove guild "Saga"? Its keys and selections are deleted.'
  })
  expect(guildRemoveAction('read', false, 'Saga')?.label).toBe('Remove')
})

test('web owner: button hidden (null)', () => {
  expect(guildRemoveAction('owner', true, 'Saga')).toBeNull()
})

test('web non-owner: Leave with a non-destructive confirm', () => {
  for (const role of ['write', 'read', undefined]) {
    expect(guildRemoveAction(role, true, 'Saga')).toEqual({
      label: 'Leave',
      title: 'Leave guild',
      confirmText: 'Leave guild "Saga"? You\'ll lose access to its roster.'
    })
  }
})
