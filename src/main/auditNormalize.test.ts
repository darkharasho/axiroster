import { test, expect } from 'vitest'
import { normalizeGw2, normalizeDiscord } from './auditNormalize'

test('normalizeGw2 maps a join entry', () => {
  const ev = normalizeGw2({ id: 42, time: '2026-06-26T10:00:00Z', type: 'joined', user: 'Bob.1234' })
  expect(ev).toMatchObject({
    uid: 'gw2:42',
    source: 'gw2',
    id: '42',
    time: '2026-06-26T10:00:00Z',
    type: 'joined',
    actor: 'Bob.1234'
  })
  expect(ev.summary).toContain('Bob.1234')
  expect(ev.summary.toLowerCase()).toContain('joined')
})

test('normalizeGw2 describes a rank change with both parties', () => {
  const ev = normalizeGw2({
    id: 7, time: '2026-06-26T11:00:00Z', type: 'rank_change',
    user: 'Bob.1234', old_rank: 'Member', new_rank: 'Officer', changed_by: 'Lead.9999'
  })
  expect(ev.target).toBe('Lead.9999')
  expect(ev.summary).toContain('Member')
  expect(ev.summary).toContain('Officer')
})

test('normalizeGw2 distinguishes a self-leave kick from an officer kick', () => {
  const left = normalizeGw2({ id: 1, time: 't', type: 'kick', user: 'A.1', kicked_by: 'A.1' })
  const kicked = normalizeGw2({ id: 2, time: 't', type: 'kick', user: 'A.1', kicked_by: 'Lead.9' })
  expect(left.summary.toLowerCase()).toContain('left')
  expect(kicked.summary.toLowerCase()).toContain('kicked')
})

test('normalizeDiscord prefers the bot-provided details line', () => {
  const ev = normalizeDiscord({
    id: 100, created_at: '2026-06-26T12:00:00Z', event_type: 'member_join',
    target_id: '555', target_name: '@bob (bob)', details: 'Member joined the server.'
  })
  expect(ev).toMatchObject({
    uid: 'discord:100', source: 'discord', id: '100',
    time: '2026-06-26T12:00:00Z', type: 'member_join',
    target: '@bob (bob)', summary: 'Member joined the server.'
  })
})

test('normalizeDiscord falls back to a generated summary when details is missing', () => {
  const ev = normalizeDiscord({
    id: 101, created_at: 't', event_type: 'member_kick',
    actor_name: 'Mod', target_name: 'Bob'
  })
  expect(ev.summary.length).toBeGreaterThan(0)
  expect(ev.summary).toContain('Bob')
})
