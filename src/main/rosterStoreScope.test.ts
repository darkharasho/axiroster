// Reserved annotation rows (meta:pipeline, prospect:*, vote:*, comment:*) are
// per-guild workspace state, not person-scoped notes. They must never be visible
// from another guild profile — that is a cross-guild data leak.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RosterStore } from './rosterStore'

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'roster-scope-'))
  path = join(dir, 'rosterAnnotations.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('RosterStore reserved-key scoping', () => {
  it('hides one guild\'s prospects from another guild', () => {
    const s = new RosterStore(path)
    s.setScope('guild-eww')
    s.upsert('prospect:aaa', { nickname: 'Hitoma' })
    s.upsert('meta:pipeline', { notes: '{"placement":{"prospect:aaa":"passed"}}' })

    s.setScope('guild-defi')
    expect(s.get('prospect:aaa')).toBeNull()
    expect(s.get('meta:pipeline')).toBeNull()
    expect(s.list().some((a) => a.memberId.startsWith('prospect:'))).toBe(false)

    s.setScope('guild-eww')
    expect(s.get('prospect:aaa')?.nickname).toBe('Hitoma')
  })

  it('keeps person annotations shared across guilds (unchanged behaviour)', () => {
    const s = new RosterStore(path)
    s.setScope('guild-eww')
    s.upsert('acct:Eternal.1234', { notes: 'solid tank' })
    s.setScope('guild-defi')
    expect(s.get('acct:Eternal.1234')?.notes).toBe('solid tank')
  })

  it('scopes remote-applied reserved rows to the attached guild', () => {
    const s = new RosterStore(path)
    s.setScope('guild-eww')
    s.applyRemote({
      memberId: 'vote:user-9', nickname: '', aliases: [], notes: '{"prospect:aaa":"yes"}',
      tags: [], mainAccount: '', createdAt: 'x', updatedAt: 'x'
    })
    s.setScope('guild-defi')
    expect(s.list().some((a) => a.memberId === 'vote:user-9')).toBe(false)
  })

  it('removes reserved rows only from the current scope', () => {
    const s = new RosterStore(path)
    s.setScope('guild-eww')
    s.upsert('prospect:aaa', { nickname: 'Hitoma' })
    s.setScope('guild-defi')
    s.upsert('prospect:bbb', { nickname: 'Other' })
    s.remove('prospect:bbb')
    s.setScope('guild-eww')
    expect(s.get('prospect:aaa')?.nickname).toBe('Hitoma')
  })

  it('survives a reload', () => {
    const a = new RosterStore(path)
    a.setScope('guild-eww')
    a.upsert('prospect:aaa', { nickname: 'Hitoma' })
    a.flush()
    const b = new RosterStore(path)
    b.setScope('guild-defi')
    expect(b.get('prospect:aaa')).toBeNull()
    b.setScope('guild-eww')
    expect(b.get('prospect:aaa')?.nickname).toBe('Hitoma')
  })

  it('quarantines legacy unscoped reserved rows instead of leaking them', () => {
    writeFileSync(
      path,
      JSON.stringify({
        annotations: [
          { memberId: 'prospect:aaa', nickname: 'Hitoma', aliases: [], notes: '', tags: [], mainAccount: '', createdAt: 'x', updatedAt: 'x' },
          { memberId: 'meta:pipeline', nickname: '', aliases: [], notes: '{"placement":{}}', tags: [], mainAccount: '', createdAt: 'x', updatedAt: 'x' },
          { memberId: 'acct:Eternal.1234', nickname: '', aliases: [], notes: 'keep me', tags: [], mainAccount: '', createdAt: 'x', updatedAt: 'x' }
        ]
      })
    )
    const s = new RosterStore(path)
    s.setScope('guild-defi')
    expect(s.get('prospect:aaa')).toBeNull()
    expect(s.get('acct:Eternal.1234')?.notes).toBe('keep me')
    const backup = `${path}.legacy-reserved.json`
    expect(existsSync(backup)).toBe(true)
    expect(JSON.parse(readFileSync(backup, 'utf8')).annotations).toHaveLength(2)
  })
})
