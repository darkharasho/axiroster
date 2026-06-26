// src/main/sync/supabaseSync.test.ts
import { test, expect } from 'vitest'
import { rowToMember } from './supabaseSync'

test('rowToMember maps payload + member_id', () => {
  const m = rowToMember({ member_id: 'A.1', payload: { rank: 'Member' } })
  expect(m).toEqual({ memberId: 'A.1', payload: { rank: 'Member' } })
})
