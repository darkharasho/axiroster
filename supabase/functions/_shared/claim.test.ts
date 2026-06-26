// supabase/functions/_shared/claim.test.ts
import { test, expect } from 'vitest'
import { decideClaim } from './claim'
test('leader + unclaimed => ok', () => expect(decideClaim(0, true).ok).toBe(true))
test('not leader => not_leader', () => expect(decideClaim(0, false)).toEqual({ ok: false, reason: 'not_leader' }))
test('already claimed => already_claimed', () => expect(decideClaim(1, true)).toEqual({ ok: false, reason: 'already_claimed' }))
