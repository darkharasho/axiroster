// src/main/sync/syncScope.ts
//
// Containment filter for the one-time "upload pre-sync local notes" push in
// initSync. The local annotation/link stores are person-scoped and shared across
// every guild profile on this machine, so pushing them wholesale would leak one
// guild's notes into another guild's workspace. A record may only ride the bulk
// push if it resolves to a GW2 account that is a member of the attached
// workspace (roster_members is keyed by account name). Unresolvable records
// simply stay local — an individual edit still pushes in context — because
// under-pushing is safe and over-pushing is the leak.

import type { RosterAnnotation } from '../rosterStore'
import type { RosterLink } from '../linkStore'

const ACCT_PREFIX = 'acct:'

function accountsFor(a: RosterAnnotation, linksByMember: Map<string, string[]>): string[] {
  const out: string[] = []
  if (a.memberId.startsWith(ACCT_PREFIX)) out.push(a.memberId.slice(ACCT_PREFIX.length))
  if (a.mainAccount.trim()) out.push(a.mainAccount.trim())
  out.push(...(linksByMember.get(a.memberId) ?? []))
  return out
}

export function annotationsForWorkspace(
  annotations: RosterAnnotation[],
  links: RosterLink[],
  memberAccounts: Set<string>
): RosterAnnotation[] {
  const linksByMember = new Map<string, string[]>()
  for (const l of links) {
    const list = linksByMember.get(l.memberId) ?? []
    list.push(l.accountName)
    linksByMember.set(l.memberId, list)
  }
  return annotations.filter((a) =>
    accountsFor(a, linksByMember).some((acct) => memberAccounts.has(acct))
  )
}

export function linksForWorkspace(links: RosterLink[], memberAccounts: Set<string>): RosterLink[] {
  return links.filter((l) => memberAccounts.has(l.accountName))
}
