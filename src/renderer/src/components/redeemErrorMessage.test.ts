import { test, expect } from 'vitest'
import { redeemErrorMessage } from './WebJoinGuild'

test('ok result → no error', () => {
  expect(redeemErrorMessage({ ok: true })).toBeNull()
})

test('failure with a message → that message', () => {
  expect(redeemErrorMessage({ ok: false, error: 'Invite already used' })).toBe('Invite already used')
})

test('failure without a message → default', () => {
  expect(redeemErrorMessage({ ok: false })).toBe('Could not redeem that code')
})
