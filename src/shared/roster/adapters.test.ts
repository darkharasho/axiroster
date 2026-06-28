// src/main/roster/adapters.test.ts
import { test, expect } from 'vitest'
import {
  asLinkedMembers,
  asDiscordRoles,
  asDiscordMembers,
  parseBoundGw2Guilds
} from './adapters'

test('asLinkedMembers maps members-linked rows and drops rows without member_id', () => {
  const raw = [
    {
      member_id: '111',
      member_name: 'Alice',
      accounts: [{ account_name: 'Alice.1234', characters: ['Char A'], guild_labels: { g1: 'L' } }]
    },
    { member_name: 'NoId' }, // dropped — no member_id
    null
  ]
  expect(asLinkedMembers(raw)).toEqual([
    {
      member_id: '111',
      member_name: 'Alice',
      accounts: [{ account_name: 'Alice.1234', characters: ['Char A'], guild_labels: { g1: 'L' } }]
    }
  ])
  expect(asLinkedMembers('nope')).toEqual([])
})

test('asDiscordRoles parses color/colour, icon, emoji and falls back name->id', () => {
  const out = asDiscordRoles({
    roles: [
      { id: '1', name: 'Officer', color: 16711680, icon: 'abc', unicode_emoji: '⭐' },
      { id: '2', colour: '#00ff00' }, // no name -> id; colour string
      { bad: true } // no id -> dropped
    ]
  })
  expect(out).toEqual([
    { id: '1', name: 'Officer', colorRaw: 16711680, iconHash: 'abc', emoji: '⭐' },
    { id: '2', name: '2', colorRaw: '#00ff00', iconHash: null, emoji: null }
  ])
  expect(asDiscordRoles(null)).toEqual([])
})

test('asDiscordMembers parses role-id shapes, bot flags, and drops rows without id', () => {
  const out = asDiscordMembers({
    members: [
      { id: '1', name: 'a', display_name: 'A', roles: ['10', { id: 20 }] },
      { id: '2', is_bot: true },
      { id: '3', user: { bot: true } },
      { name: 'noId' } // dropped
    ]
  })
  expect(out).toEqual([
    { id: '1', name: 'a', display_name: 'A', roles: ['10', '20'], bot: false },
    { id: '2', name: undefined, display_name: undefined, roles: [], bot: true },
    { id: '3', name: undefined, display_name: undefined, roles: [], bot: true }
  ])
  expect(asDiscordMembers(undefined)).toEqual([])
})

test('parseBoundGw2Guilds reads array-of-objects, array-of-strings, and map shapes', () => {
  const GUID = 'ABCDEF01-2345-6789-ABCD-EF0123456789'
  const GUID2 = '11111111-2222-3333-4444-555555555555'
  expect(parseBoundGw2Guilds([{ gw2_guild_id: GUID }, { guild_id: GUID2 }])).toEqual([GUID, GUID2])
  expect(parseBoundGw2Guilds([GUID, 'not-a-guid'])).toEqual([GUID])
  expect(parseBoundGw2Guilds({ roles: { [GUID]: 'role1', notguid: 'x' } })).toEqual([GUID])
  expect(parseBoundGw2Guilds({ [GUID]: 'r' })).toEqual([GUID])
  expect(parseBoundGw2Guilds(42)).toEqual([])
})
