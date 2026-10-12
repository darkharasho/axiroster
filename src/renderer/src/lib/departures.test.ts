import { describe, test, expect, vi } from 'vitest'
import type { ReconciledMember } from '../../../preload/index.d'
import type { DepartureDoc } from '../../../shared/departures'
import {
  handleOf, roleHolders, suggestMatch, buildDepartedRows, sortDepartedRows, filterDepartedRows,
  countDeparted, replaceDoc, linkDoc, dismissSuggestion, setDocNote, setEpisodeReason, episodeRef,
  addManualEpisode, previousKick, kickTooltip, roleActionBlocker, removeRoles
} from './departures'

const member = (over: Partial<ReconciledMember>): ReconciledMember => ({
  memberId: null, annotationKey: 'x', hasMemberRole: false, roles: [], accounts: [], linkSource: null,
  guildLabels: [], linked: false, inGuild: false, status: 'no-key', nickname: '', aliases: [], notes: '',
  tags: [], label: 'x', ...over
})
const ep = (over: Partial<DepartureDoc['episodes'][number]> = {}) => ({
  kind: 'left' as const, actor: null, at: '2026-10-01T00:00:00.000Z', source: 'gw2-log' as const,
  auditUid: null, reason: '', rejoinedAt: null, ...over
})
const doc = (account: string, over: Partial<DepartureDoc> = {}): DepartureDoc => ({
  account, memberId: null, dismissedSuggestions: [], note: '', episodes: [ep()], ...over
})

describe('suggestions', () => {
  const holders = [
    { id: 'd1', name: 'foo', displayName: 'Foo' },
    { id: 'd2', name: 'foobarian', displayName: 'FB' },
    { id: 'd3', name: 'zed', displayName: 'Zeddicus' }
  ]
  test('handleOf strips the 4-digit suffix and lowercases', () => {
    expect(handleOf(' Foo.1234 ')).toBe('foo')
    expect(handleOf('Odd Name')).toBe('odd name')
  })
  test('an exact name or display-name match wins', () => {
    expect(suggestMatch('Foo.1234', holders, [])?.id).toBe('d1')
    expect(suggestMatch('Zeddicus.9999', holders, [])?.id).toBe('d3')
  })
  test('a unique partial match is suggested', () => {
    expect(suggestMatch('barian.1111', holders, [])?.id).toBe('d2')
  })
  test('ambiguous partial matches give no suggestion', () => {
    expect(suggestMatch('fooba.1111', [...holders, { id: 'd4', name: 'foobaz', displayName: '' }], [])).toBeNull()
  })
  test('short handles never partial-match', () => {
    expect(suggestMatch('ze.1234', holders, [])).toBeNull()
  })
  test('dismissed ids are excluded', () => {
    expect(suggestMatch('Foo.1234', holders, ['d1'])?.id).toBe('d2')
  })
  test('only role holders are candidates', () => {
    const ms = [
      member({ memberId: 'd1', hasMemberRole: true, discordName: 'foo' }),
      member({ memberId: 'd9', hasMemberRole: false, discordName: 'bar' })
    ]
    expect(roleHolders(ms).map((h) => h.id)).toEqual(['d1'])
  })
  test('role holders still in the guild through another account are never suggested', () => {
    const ms = [
      member({ memberId: 'd1', hasMemberRole: true, discordName: 'foo', inGuild: true }),
      member({ memberId: 'd2', hasMemberRole: true, discordName: 'foobar' })
    ]
    expect(roleHolders(ms).map((h) => h.id)).toEqual(['d2'])
    const [r] = buildDepartedRows([doc('Foo.1234')], ms, 'role1')
    expect(r.suggestion?.id).toBe('d2')
  })
})

describe('rows', () => {
  const members = [
    member({ memberId: 'd1', hasMemberRole: true, discordName: 'gone', accounts: [{ account_name: 'Gone.2', characters: [], inGuild: false, manual: false, main: true }] }),
    member({ memberId: 'd2', hasMemberRole: true, discordName: 'quit' })
  ]

  test('a member linked by account is resolved and flagged while gone with the role', () => {
    const [r] = buildDepartedRows([doc('Gone.2')], members, 'role1')
    expect(r).toMatchObject({ memberId: 'd1', flagged: true, status: 'left', suggestion: null })
  })

  test('a rejoined person is not flagged and shows as rejoined', () => {
    const [r] = buildDepartedRows([doc('Gone.2', { episodes: [ep({ rejoinedAt: '2026-10-05T00:00:00.000Z' })] })], members, 'role1')
    expect(r).toMatchObject({ status: 'rejoined', flagged: false })
  })

  test('a departed alt does not flag an owner still in the guild on another account', () => {
    const owner = member({
      memberId: 'd7', hasMemberRole: true, discordName: 'owner', inGuild: true,
      accounts: [
        { account_name: 'Main.1111', characters: [], inGuild: true, manual: false, main: true },
        { account_name: 'Alt.2222', characters: [], inGuild: false, manual: false, main: false }
      ]
    })
    const [r] = buildDepartedRows([doc('Alt.2222')], [owner], 'role1')
    expect(r).toMatchObject({ memberId: 'd7', flagged: false })
    expect(countDeparted([r]).flagged).toBe(0)
  })

  test('no member role configured → nothing flagged', () => {
    expect(buildDepartedRows([doc('Gone.2')], members, null)[0].flagged).toBe(false)
  })

  test('an unlinked doc gets a suggestion; a doc with no episodes is skipped', () => {
    const rows = buildDepartedRows([doc('Quit.1234'), doc('Empty.1', { episodes: [] })], members, 'role1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ memberId: null, flagged: false, suggestion: { id: 'd2' } })
  })

  test('flagged rows sort first, then newest departure first', () => {
    const rows = buildDepartedRows(
      [
        doc('Old.1', { episodes: [ep({ at: '2025-01-01T00:00:00.000Z' })] }),
        doc('New.1', { episodes: [ep({ at: '2026-10-10T00:00:00.000Z' })] }),
        doc('Gone.2', { episodes: [ep({ at: '2024-01-01T00:00:00.000Z' })] })
      ],
      members,
      'role1'
    )
    expect(sortDepartedRows(rows).map((r) => r.doc.account)).toEqual(['Gone.2', 'New.1', 'Old.1'])
  })

  test('filters and counts', () => {
    const rows = buildDepartedRows(
      [
        doc('Gone.2'),
        doc('Kick.3', { note: 'griefing', episodes: [ep({ kind: 'kicked', actor: 'Boss.9', reason: 'afk' })] })
      ],
      members,
      'role1'
    )
    expect(filterDepartedRows(rows, 'kicked', '').map((r) => r.doc.account)).toEqual(['Kick.3'])
    expect(filterDepartedRows(rows, 'flagged', '').map((r) => r.doc.account)).toEqual(['Gone.2'])
    expect(filterDepartedRows(rows, 'all', 'boss').map((r) => r.doc.account)).toEqual(['Kick.3'])
    expect(filterDepartedRows(rows, 'all', 'GRIEF').map((r) => r.doc.account)).toEqual(['Kick.3'])
    expect(filterDepartedRows(rows, 'all', 'gone').map((r) => r.doc.account)).toEqual(['Gone.2'])
    expect(countDeparted(rows)).toEqual({ all: 2, flagged: 1, left: 1, kicked: 1, unknown: 0, rejoined: 0 })
  })
})

describe('doc edits', () => {
  test('replaceDoc swaps by key, or appends a new one', () => {
    const a = doc('A.1')
    const b = doc('B.2')
    expect(replaceDoc([a], { ...a, note: 'x' })[0].note).toBe('x')
    expect(replaceDoc([a], b)).toHaveLength(2)
  })
  test('link, dismiss, note and reason edits return new docs', () => {
    const d = doc('A.1')
    expect(linkDoc(d, 'd1').memberId).toBe('d1')
    expect(dismissSuggestion(dismissSuggestion(d, 'd1'), 'd1').dismissedSuggestions).toEqual(['d1'])
    expect(setDocNote(d, 'hi').note).toBe('hi')
    expect(setEpisodeReason(d, episodeRef(d.episodes[0]), 'afk').episodes[0].reason).toBe('afk')
    expect(d.note).toBe('')
  })
  test('a reason edit finds its episode by identity, not position', () => {
    const target = ep({ at: '2026-09-01T00:00:00.000Z', source: 'roster-diff', kind: 'unknown' })
    const stale = doc('A.1', { episodes: [target] })
    const ref = episodeRef(stale.episodes[0])
    // A fresher doc where detection added a newer episode in front.
    const fresh = doc('A.1', { episodes: [ep({ at: '2026-10-05T00:00:00.000Z', auditUid: 'u9' }), target] })
    const out = setEpisodeReason(fresh, ref, 'afk')
    expect(out.episodes.map((e) => e.reason)).toEqual(['', 'afk'])
  })
  test('a reason edit matches log episodes by auditUid and is a no-op when the episode is gone', () => {
    const logged = ep({ auditUid: 'u1', at: '2026-10-01T00:00:00.000Z' })
    const d = doc('A.1', { episodes: [logged] })
    // Same uid, different timestamp format still matches.
    const ref = { ...episodeRef(logged), at: '2026-10-01T00:00:00+00:00' }
    expect(setEpisodeReason(d, ref, 'x').episodes[0].reason).toBe('x')
    expect(setEpisodeReason(d, { auditUid: 'nope', at: logged.at, source: 'gw2-log' }, 'x')).toBe(d)
  })
  test('a manual episode is inserted in date order', () => {
    const d = addManualEpisode(doc('A.1'), { kind: 'kicked', actor: 'Boss.9', at: '2026-10-11T00:00:00.000Z' })
    expect(d.episodes[0]).toMatchObject({ kind: 'kicked', actor: 'Boss.9', source: 'manual', auditUid: null })
    expect(d.episodes).toHaveLength(2)
  })
})

describe('previousKick', () => {
  const docs = [
    doc('Bad.1', { memberId: 'd5', episodes: [ep({ kind: 'kicked', actor: 'Boss.9', at: '2026-01-01T00:00:00.000Z', reason: 'toxic' })] }),
    doc('Quit.2')
  ]
  test('matches by account, case-insensitively', () => {
    expect(previousKick(docs, { accounts: ['bad.1'], memberId: null })?.account).toBe('Bad.1')
  })
  test('matches by Discord memberId', () => {
    expect(previousKick(docs, { accounts: [], memberId: 'd5' })?.episode.actor).toBe('Boss.9')
  })
  test('a leave is not a kick', () => {
    expect(previousKick(docs, { accounts: ['Quit.2'], memberId: null })).toBeNull()
  })
  test('the tooltip names the actor and the reason', () => {
    const t = kickTooltip(previousKick(docs, { accounts: ['Bad.1'], memberId: null })!)
    expect(t).toContain('Kicked by Boss.9')
    expect(t).toContain('toxic')
  })
})

describe('role removal', () => {
  test('roleActionBlocker explains why removal is disabled', () => {
    expect(roleActionBlocker({ canEdit: false, discordConfigured: true, memberRoleId: 'r' })).toMatch(/read-only/i)
    expect(roleActionBlocker({ canEdit: true, discordConfigured: false, memberRoleId: 'r' })).toMatch(/AxiTools/)
    expect(roleActionBlocker({ canEdit: true, discordConfigured: true, memberRoleId: null })).toMatch(/member role/i)
    expect(roleActionBlocker({ canEdit: true, discordConfigured: true, memberRoleId: 'r' })).toBeNull()
  })

  test('runs sequentially, continues past failures, reports progress', async () => {
    const order: string[] = []
    const act = vi.fn(async (id: string) => {
      order.push(id)
      return id === 'd2' ? { ok: false as const, error: 'Missing permission' } : { ok: true as const, data: null }
    })
    const progress = vi.fn()
    const res = await removeRoles(
      [{ key: 'k1', memberId: 'd1', label: 'A' }, { key: 'k2', memberId: 'd2', label: 'B' }, { key: 'k3', memberId: 'd3', label: 'C' }],
      act,
      progress
    )
    expect(order).toEqual(['d1', 'd2', 'd3'])
    expect(res).toEqual({ removed: ['k1', 'k3'], failed: [{ key: 'k2', label: 'B', error: 'Missing permission' }] })
    expect(progress).toHaveBeenLastCalledWith(3, 3)
  })
})
