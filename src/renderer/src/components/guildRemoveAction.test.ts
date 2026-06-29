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

test('web owner: destructive Delete with type-to-confirm flags', () => {
  expect(guildRemoveAction('owner', true, 'Saga')).toEqual({
    label: 'Delete',
    title: 'Delete guild',
    confirmText:
      'Permanently delete "Saga" and ALL its data (roster, notes, members, invites, audit log) for every member? This cannot be undone.',
    danger: true,
    requireName: true
  })
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
