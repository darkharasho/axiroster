import { test, expect, vi } from 'vitest'
import { SupabaseRetentionRepo } from './supabaseRetentionRepo'

function repo(upsert = vi.fn().mockResolvedValue({ error: null })): { r: SupabaseRetentionRepo; upsert: typeof upsert } {
  const client = { from: () => ({ upsert }) } as never
  return { r: new SupabaseRetentionRepo({ url: 'u', anonKey: 'a', workspaceId: 'WS1' }, client), upsert }
}

test('append dedupes one row per member per day in the cache', () => {
  const { r } = repo()
  r.append([{ date: '2026-06-20', memberKey: 'A', score: 0.5, tier: 't1' }])
  r.append([{ date: '2026-06-20', memberKey: 'A', score: 0.9, tier: 't2' }])
  expect(r.list()).toEqual([{ date: '2026-06-20', memberKey: 'A', score: 0.9, tier: 't2' }])
})

test('append upserts mapped rows to Supabase', () => {
  const { r, upsert } = repo()
  r.append([{ date: '2026-06-20', memberKey: 'A', score: 0.5, tier: 't1' }])
  expect(upsert).toHaveBeenCalledWith(
    [{ workspace_id: 'WS1', date: '2026-06-20', member_key: 'A', score: 0.5, tier: 't1' }],
    { onConflict: 'workspace_id,date,member_key' }
  )
})

test('empty append is a no-op (no upsert)', () => {
  const { r, upsert } = repo()
  r.append([])
  expect(upsert).not.toHaveBeenCalled()
})

test('appendConfirmed reports upsert success/failure and still fills the cache', async () => {
  const { r, upsert } = repo()
  await expect(r.appendConfirmed([{ date: '2026-06-20', memberKey: 'A', score: 0.5, tier: 't1' }])).resolves.toBe(true)
  expect(r.list()).toHaveLength(1)
  upsert.mockResolvedValue({ error: { message: 'rls denied' } })
  await expect(r.appendConfirmed([{ date: '2026-06-21', memberKey: 'A', score: 0.6, tier: 't1' }])).resolves.toBe(false)
  upsert.mockRejectedValue(new Error('network down'))
  await expect(r.appendConfirmed([{ date: '2026-06-22', memberKey: 'A', score: 0.7, tier: 't1' }])).resolves.toBe(false)
  await expect(r.appendConfirmed([])).resolves.toBe(true) // nothing to push -> vacuous success
})
