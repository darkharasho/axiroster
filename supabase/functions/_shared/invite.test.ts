import { test, expect } from 'vitest'
import { matchInvite } from './invite.ts'
const base = { id: 'i', workspace_id: 'g', role: 'write', redeemed_by: null }
test('matches by code', () =>
  expect(matchInvite([{ ...base, code: 'ABC', discord_id: null }], { discordId: 'x', code: 'ABC' })?.id).toBe('i'))
test('matches by discord id when no code', () =>
  expect(matchInvite([{ ...base, code: null, discord_id: 'd1' }], { discordId: 'd1' })?.id).toBe('i'))
test('no match returns null', () =>
  expect(matchInvite([{ ...base, code: 'ABC', discord_id: null }], { discordId: 'd1' })).toBeNull())
