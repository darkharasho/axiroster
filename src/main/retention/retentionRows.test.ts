import { test, expect } from 'vitest'
import { snapshotToRow, rowToSnapshot } from './retentionRows'

test('snapshot round-trips through a row', () => {
  const s = { date: '2026-06-20', memberKey: 'Alice.1', score: 0.83, tier: 'stable' }
  expect(snapshotToRow('WS1', s)).toEqual({
    workspace_id: 'WS1', date: '2026-06-20', member_key: 'Alice.1', score: 0.83, tier: 'stable'
  })
  expect(rowToSnapshot(snapshotToRow('WS1', s))).toEqual(s)
})
