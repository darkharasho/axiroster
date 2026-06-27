// src/main/retentionHistory.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync, mkdtempSync } from 'fs'
import { RetentionHistory } from './retentionHistory'

let path: string
beforeEach(() => { path = join(mkdtempSync(join(tmpdir(), 'rh-')), 'retentionHistory.json') })

describe('RetentionHistory', () => {
  it('appends and de-dupes by (date, memberKey) — same day overwrites', () => {
    const h = new RetentionHistory(path)
    h.append([{ date: '2026-02-15', memberKey: 'a', score: 10, tier: 'healthy' }])
    h.append([{ date: '2026-02-15', memberKey: 'a', score: 80, tier: 'at-risk' }]) // same day → overwrite
    h.append([{ date: '2026-02-16', memberKey: 'a', score: 50, tier: 'watch' }])
    const rows = h.list()
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.date === '2026-02-15')!.score).toBe(80)
  })
  it('survives a corrupt file without throwing', () => {
    rmSync(path, { force: true })
    const h = new RetentionHistory(path)
    expect(h.list()).toEqual([])
  })
})
