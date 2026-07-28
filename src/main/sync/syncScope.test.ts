import { test, expect } from 'vitest'
import { annotationsForWorkspace, linksForWorkspace } from './syncScope'
import type { RosterAnnotation } from '../rosterStore'
import type { RosterLink } from '../linkStore'

function ann(memberId: string, mainAccount = ''): RosterAnnotation {
  return {
    memberId,
    nickname: 'n',
    aliases: [],
    notes: 'x',
    tags: [],
    mainAccount,
    createdAt: 't',
    updatedAt: 't'
  }
}

function link(accountName: string, memberId: string): RosterLink {
  return { accountName, memberId, createdAt: 't' }
}

const MEMBERS = new Set(['Alice.1234', 'Bob.5678'])

test('acct:-keyed annotations push only when the account is a workspace member', () => {
  const anns = [ann('acct:Alice.1234'), ann('acct:Stranger.9999')]
  expect(annotationsForWorkspace(anns, [], MEMBERS).map((a) => a.memberId)).toEqual([
    'acct:Alice.1234'
  ])
})

test('discord-keyed annotations resolve through mainAccount', () => {
  const anns = [ann('111', 'Bob.5678'), ann('222', 'Stranger.9999')]
  expect(annotationsForWorkspace(anns, [], MEMBERS).map((a) => a.memberId)).toEqual(['111'])
})

test('discord-keyed annotations resolve through manual links', () => {
  const anns = [ann('333'), ann('444')]
  const links = [link('Alice.1234', '333'), link('Stranger.9999', '444')]
  expect(annotationsForWorkspace(anns, links, MEMBERS).map((a) => a.memberId)).toEqual(['333'])
})

test('unresolvable annotations stay local (never pushed)', () => {
  // A discord-keyed note with no mainAccount and no link cannot be attributed to
  // this workspace — under-pushing is safe, over-pushing is the leak.
  expect(annotationsForWorkspace([ann('555')], [], MEMBERS)).toEqual([])
})

test('an empty membership set pushes nothing', () => {
  // Fresh workspace whose roster has not populated yet: defer rather than leak.
  expect(annotationsForWorkspace([ann('acct:Alice.1234')], [], new Set())).toEqual([])
  expect(linksForWorkspace([link('Alice.1234', '111')], new Set())).toEqual([])
})

test('links push only when their account is a workspace member', () => {
  const links = [link('Alice.1234', '111'), link('Stranger.9999', '222')]
  expect(linksForWorkspace(links, MEMBERS).map((l) => l.accountName)).toEqual(['Alice.1234'])
})
