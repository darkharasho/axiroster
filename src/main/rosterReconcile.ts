// src/main/rosterReconcile.ts
//
// Merges the identity signals a guild has into one reconciled roster. The
// in-game GW2 guild roster is the base (GW2-first): every guild account is
// matched to a Discord member via a manual link first, then the AxiTools
// auto-link, and all of a member's accounts fold under one identity row.
// Accounts with no match stay as their own "unlinked" rows; Discord members not
// in the in-game roster come after (left-guild / no-key). Pure (no IO) so the
// merge is unit-testable.

export interface DiscordMemberRaw {
  id: string
  name?: string
  display_name?: string
  roles?: string[]
  bot?: boolean
}

export interface LinkedAccountRaw {
  account_name?: string
  characters?: string[]
  guild_labels?: Record<string, string>
}

export interface LinkedMemberRaw {
  member_id: string
  member_name?: string
  accounts?: LinkedAccountRaw[]
}

export interface InGameMemberRaw {
  name: string
  rank?: string
  joined?: string | null
}

export interface ManualLinkRaw {
  accountName: string
  memberId: string
}

export interface AnnotationRaw {
  memberId: string
  nickname: string
  aliases: string[]
  notes: string
  tags: string[]
  mainAccount?: string
}

export interface ReconciledAccount {
  account_name: string
  characters: string[]
  inGuild: boolean
  rank?: string
  joined?: string | null
  manual: boolean
  main: boolean
}

export type RosterStatus =
  | 'verified' // matched to a Discord member, at least one account in the in-game guild
  | 'linked' // matched to a Discord member, in-game status unconfirmed (no GW2 roster)
  | 'no-key' // a Discord guild member who never linked a GW2 key
  | 'left-guild' // matched to a Discord member, but no account in the in-game guild
  | 'unlinked' // in the in-game guild, but no Discord member matched

/** Key an annotation rides on: the Discord member_id when linked, else the GW2
 *  account (so unlinked accounts can still be annotated). */
export const accountAnchor = (accountName: string): string => `acct:${accountName.trim()}`

/** Reserved annotation keys hold app metadata (e.g. the tag color registry under
 *  `meta:tags`), never a real person — they must never surface as members. */
export const isReservedAnnotationKey = (key: string): boolean => key.startsWith('meta:')

export interface ReconciledMember {
  memberId: string | null
  annotationKey: string
  discordName?: string
  displayName?: string
  hasMemberRole: boolean
  roles: string[]
  accounts: ReconciledAccount[]
  accountName?: string
  rank?: string
  joined?: string | null
  linkSource: 'auto' | 'manual' | null
  guildLabels: string[]
  linked: boolean
  inGuild: boolean
  status: RosterStatus
  nickname: string
  aliases: string[]
  notes: string
  tags: string[]
  label: string
}

export interface ReconcileInput {
  discordMembers: DiscordMemberRaw[]
  linked: LinkedMemberRaw[]
  inGameRoster: InGameMemberRaw[]
  manualLinks: ManualLinkRaw[]
  annotations: AnnotationRaw[]
  memberRoleId: string | null
  haveInGame: boolean
}

const lc = (s: string): string => s.trim().toLowerCase()

function emptyAnn(key: string): AnnotationRaw {
  return { memberId: key, nickname: '', aliases: [], notes: '', tags: [], mainAccount: '' }
}

interface Acc {
  name: string
  characters: string[]
  labels: string[]
  manual: boolean
}

export function reconcileRoster(input: ReconcileInput): ReconciledMember[] {
  const { discordMembers, linked, inGameRoster, manualLinks, annotations, memberRoleId, haveInGame } =
    input
  const roleConfigured = Boolean(memberRoleId)
  const discordById = new Map(discordMembers.map((d) => [d.id, d]))
  const annByKey = new Map(
    annotations.filter((a) => !isReservedAnnotationKey(a.memberId)).map((a) => [a.memberId, a])
  )
  const inGameByName = new Map(inGameRoster.map((g) => [lc(g.name), g]))
  const hasMemberRole = (id: string): boolean =>
    roleConfigured ? (discordById.get(id)?.roles ?? []).includes(memberRoleId as string) : false

  const autoByAccount = new Map<string, string>()
  for (const l of linked) {
    for (const a of l.accounts ?? [])
      if (a.account_name) autoByAccount.set(lc(a.account_name), l.member_id)
  }
  const manualByAccount = new Map(manualLinks.map((m) => [lc(m.accountName), m.memberId]))

  const memberAccts = new Map<string, Map<string, Acc>>()
  const addAcct = (
    memberId: string,
    name: string,
    characters: string[],
    labels: string[],
    manual: boolean
  ): void => {
    const m = memberAccts.get(memberId) ?? new Map<string, Acc>()
    memberAccts.set(memberId, m)
    const k = lc(name)
    const ex = m.get(k)
    m.set(k, {
      name: ex?.name ?? name,
      characters: characters.length ? characters : (ex?.characters ?? []),
      labels: [...new Set([...(ex?.labels ?? []), ...labels])],
      manual: Boolean(ex?.manual) || manual
    })
  }
  for (const l of linked) {
    for (const a of l.accounts ?? []) {
      if (!a.account_name) continue
      const manualMember = manualByAccount.get(lc(a.account_name))
      if (manualMember && manualMember !== l.member_id) continue
      addAcct(l.member_id, a.account_name, a.characters ?? [], Object.values(a.guild_labels ?? {}), false)
    }
  }
  for (const ml of manualLinks) addAcct(ml.memberId, ml.accountName, [], [], true)

  const out: ReconciledMember[] = []

  // 1. One folded row per matched Discord member.
  for (const [memberId, accts] of memberAccts) {
    const list = [...accts.values()]
    const ann = annByKey.get(memberId) ?? emptyAnn(memberId)
    const accounts: ReconciledAccount[] = list.map((a) => {
      const ig = inGameByName.get(lc(a.name))
      return {
        account_name: ig?.name ?? a.name,
        characters: a.characters,
        inGuild: Boolean(ig),
        rank: ig?.rank,
        joined: ig?.joined ?? null,
        manual: a.manual,
        main: false
      }
    })
    const mainLc = ann.mainAccount ? lc(ann.mainAccount) : ''
    const mainAcc =
      accounts.find((a) => lc(a.account_name) === mainLc) ??
      accounts.find((a) => a.inGuild) ??
      accounts[0]
    if (mainAcc) mainAcc.main = true
    accounts.sort((a, b) => Number(b.main) - Number(a.main) || Number(b.inGuild) - Number(a.inGuild))
    const inGuild = accounts.some((a) => a.inGuild)
    if (haveInGame && !inGuild && roleConfigured && !hasMemberRole(memberId)) continue
    const discord = discordById.get(memberId)
    out.push({
      memberId,
      annotationKey: memberId,
      discordName: discord?.name,
      displayName: discord?.display_name,
      hasMemberRole: hasMemberRole(memberId),
      roles: discord?.roles ?? [],
      accounts,
      accountName: accounts[0]?.account_name,
      rank: accounts[0]?.rank,
      joined: accounts[0]?.joined ?? null,
      linkSource: list.some((a) => a.manual) ? 'manual' : 'auto',
      guildLabels: [...new Set(list.flatMap((a) => a.labels))],
      linked: true,
      inGuild,
      status: inGuild ? 'verified' : haveInGame ? 'left-guild' : 'linked',
      nickname: ann.nickname,
      aliases: ann.aliases,
      notes: ann.notes,
      tags: ann.tags,
      label: ann.nickname || discord?.display_name || discord?.name || accounts[0]?.account_name || memberId
    })
  }

  // 2. Role-holding Discord members who never linked a key (the rest of the
  //    Discord server is exposed separately for the link typeahead, not as rows).
  if (roleConfigured) {
    for (const dm of discordMembers) {
      if (memberAccts.has(dm.id)) continue
      if (dm.bot) continue
      if (!(dm.roles ?? []).includes(memberRoleId as string)) continue
      const ann = annByKey.get(dm.id) ?? emptyAnn(dm.id)
      out.push({
        memberId: dm.id,
        annotationKey: dm.id,
        discordName: dm.name,
        displayName: dm.display_name,
        hasMemberRole: true,
        roles: dm.roles ?? [],
        accounts: [],
        linkSource: null,
        guildLabels: [],
        linked: false,
        inGuild: false,
        status: 'no-key',
        nickname: ann.nickname,
        aliases: ann.aliases,
        notes: ann.notes,
        tags: ann.tags,
        label: ann.nickname || dm.display_name || dm.name || dm.id
      })
    }
  }

  // 3. In-game accounts with no Discord match — their own unlinked rows.
  if (haveInGame) {
    for (const gm of inGameRoster) {
      const k = lc(gm.name)
      if (manualByAccount.get(k) ?? autoByAccount.get(k)) continue
      const annKey = accountAnchor(gm.name)
      const ann = annByKey.get(annKey) ?? emptyAnn(annKey)
      out.push({
        memberId: null,
        annotationKey: annKey,
        hasMemberRole: false,
        roles: [],
        accounts: [
          {
            account_name: gm.name,
            characters: [],
            inGuild: true,
            rank: gm.rank,
            joined: gm.joined ?? null,
            manual: false,
            main: true
          }
        ],
        accountName: gm.name,
        rank: gm.rank,
        joined: gm.joined ?? null,
        linkSource: null,
        guildLabels: [],
        linked: false,
        inGuild: true,
        status: 'unlinked',
        nickname: ann.nickname,
        aliases: ann.aliases,
        notes: ann.notes,
        tags: ann.tags,
        label: ann.nickname || gm.name
      })
    }
  }

  return out.sort((a, b) => a.label.localeCompare(b.label))
}
