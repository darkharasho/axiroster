import { test, expect, describe } from 'vitest'
import { checkHierarchy, needsHierarchyCheck, type HierarchyOverview } from './hierarchy'

// Positions: @everyone 0 < member 1 < officer 5 < leader 9.
const overview: HierarchyOverview = {
  guild: { owner_id: 'owner' },
  roles: [
    { id: 'everyone', position: 0 },
    { id: 'member', position: 1 },
    { id: 'officer', position: 5 },
    { id: 'leader', position: 9 }
  ],
  members: [
    { id: 'owner', role_ids: ['everyone'] },
    { id: 'lead', role_ids: ['everyone', 'leader'] },
    { id: 'off', role_ids: ['everyone', 'officer', 'member'] },
    { id: 'off2', role_ids: ['everyone', 'officer'] },
    { id: 'mem', role_ids: ['everyone', 'member'] }
  ]
}

describe('needsHierarchyCheck', () => {
  test('member/role actions need it; channel/message actions do not', () => {
    for (const a of ['role_assign', 'role_unassign', 'member_kick', 'member_ban', 'member_timeout', 'member_nick', 'role_update', 'role_delete']) {
      expect(needsHierarchyCheck(a)).toBe(true)
    }
    for (const a of ['message_send', 'channel_create', 'member_dm', 'role_create']) {
      expect(needsHierarchyCheck(a)).toBe(false)
    }
  })
})

describe('checkHierarchy', () => {
  test('officer can give a lower role to a lower member', () => {
    expect(checkHierarchy(overview, 'off', 'role_assign', { member_id: 'mem', role_id: 'member' })).toBeNull()
  })

  test('officer cannot assign or remove a role at or above their own top role', () => {
    expect(checkHierarchy(overview, 'off', 'role_assign', { member_id: 'mem', role_id: 'officer' })?.error).toBe('hierarchy_denied')
    expect(checkHierarchy(overview, 'off', 'role_assign', { member_id: 'mem', role_id: 'leader' })?.error).toBe('hierarchy_denied')
    expect(checkHierarchy(overview, 'off', 'role_unassign', { member_id: 'lead', role_id: 'leader' })?.error).toBe('hierarchy_denied')
  })

  test('officer cannot change roles of, kick, or rename a higher or equal member', () => {
    expect(checkHierarchy(overview, 'off', 'role_unassign', { member_id: 'lead', role_id: 'member' })?.error).toBe('hierarchy_denied')
    expect(checkHierarchy(overview, 'off', 'member_kick', { member_id: 'lead' })?.error).toBe('hierarchy_denied')
    expect(checkHierarchy(overview, 'off', 'member_kick', { member_id: 'off2' })?.error).toBe('hierarchy_denied')
    expect(checkHierarchy(overview, 'off', 'member_nick', { member_id: 'lead', nick: 'x' })?.error).toBe('hierarchy_denied')
  })

  test('nobody but the owner can act on the owner, even with a higher role', () => {
    expect(checkHierarchy(overview, 'lead', 'member_kick', { member_id: 'owner' })?.error).toBe('hierarchy_denied')
  })

  test('owner bypasses the hierarchy even with no roles', () => {
    expect(checkHierarchy(overview, 'owner', 'member_kick', { member_id: 'lead' })).toBeNull()
    expect(checkHierarchy(overview, 'owner', 'role_assign', { member_id: 'mem', role_id: 'leader' })).toBeNull()
  })

  test('acting on yourself only checks the role', () => {
    expect(checkHierarchy(overview, 'off', 'role_unassign', { member_id: 'off', role_id: 'member' })).toBeNull()
    expect(checkHierarchy(overview, 'off', 'role_unassign', { member_id: 'off', role_id: 'officer' })?.error).toBe('hierarchy_denied')
  })

  test('role_update / role_delete need the role below the actor', () => {
    expect(checkHierarchy(overview, 'off', 'role_update', { role_id: 'member', name: 'x' })).toBeNull()
    expect(checkHierarchy(overview, 'off', 'role_delete', { role_id: 'leader' })?.error).toBe('hierarchy_denied')
  })

  test('actor missing from the server is refused', () => {
    expect(checkHierarchy(overview, 'stranger', 'member_kick', { member_id: 'mem' })?.error).toBe('not_in_guild')
    expect(checkHierarchy(overview, null, 'member_kick', { member_id: 'mem' })?.error).toBe('not_in_guild')
  })

  test('unknown target member or role fails closed', () => {
    expect(checkHierarchy(overview, 'lead', 'member_kick', { member_id: 'ghost' })?.error).toBe('hierarchy_denied')
    expect(checkHierarchy(overview, 'lead', 'role_assign', { member_id: 'mem', role_id: 'ghost' })?.error).toBe('hierarchy_denied')
  })

  test('actions outside the hierarchy pass through', () => {
    expect(checkHierarchy(overview, 'mem', 'message_send', { channel_id: 'c', content: 'hi' })).toBeNull()
  })
})
