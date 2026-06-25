// Public types shared with the renderer. Kept in sync by hand with the main
// process so the renderer's tsconfig need not include src/main.

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export interface KeyLabel {
  label: string
  active: boolean
  meta?: { name?: string; id?: string }
}

export interface GuildRef {
  id: string
  name: string
  tag: string
  leader: boolean
}

export interface Gw2AccountInfo {
  accountName: string
  permissions: string[]
  missingPermissions: string[]
  guilds: GuildRef[]
}

export interface DiscordGuild {
  id: string
  name: string
}

export type RosterStatus = 'verified' | 'linked' | 'no-key' | 'left-guild' | 'unlinked'

export interface ReconciledAccount {
  account_name: string
  characters: string[]
  inGuild: boolean
  rank?: string
  joined?: string | null
  manual: boolean
  main: boolean
}

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

export interface CommanderStats {
  runs: number
  fightsLed: number
  kills: number
  downs: number
  deaths: number
  wins: number
  losses: number
  kdr: number
}

export interface BridgePlayerMetrics {
  accountName: string
  mainClass: string | null
  classSpread: Record<string, number>
  raidsAttended: number
  raidsConsidered: number
  combatTimeMs: number
  squadTimeMs: number
  lastSeen: string | null
  commander: CommanderStats | null
}

export interface DiscordRole {
  id: string
  name: string
}

export interface SourceStatus {
  configured: boolean
  loaded: boolean
  count: number
  guildId: string | null
  guildName: string | null
  error: string | null
}

export interface RosterPayload {
  members: ReconciledMember[]
  metrics: Record<string, BridgePlayerMetrics>
  discordGuildId: string | null
  discordRoles: DiscordRole[]
  memberRoleId: string | null
  sources: { gw2: SourceStatus; discord: SourceStatus; bridge: SourceStatus }
  warnings: string[]
}

export interface RosterAnnotation {
  memberId: string
  nickname: string
  aliases: string[]
  notes: string
  tags: string[]
  mainAccount: string
  createdAt: string
  updatedAt: string
}

export interface RosterAnnotationPatch {
  nickname?: string
  aliases?: string[]
  notes?: string
  tags?: string[]
  mainAccount?: string
}

export interface RosterLink {
  accountName: string
  memberId: string
  createdAt: string
}

export type SyncStatus = 'disabled' | 'connecting' | 'connected' | 'error'

export interface AxiRosterApi {
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>
  listKeys(service: 'gw2' | 'axitools'): Promise<KeyLabel[]>
  addKey(service: 'gw2' | 'axitools', label: string, key: string): Promise<void>
  removeKey(service: 'gw2' | 'axitools', label: string): Promise<void>
  setActiveKey(service: 'gw2' | 'axitools', label: string): Promise<void>

  gw2AccountInfo(): Promise<Result<Gw2AccountInfo>>

  axitoolsListGuilds(): Promise<Result<DiscordGuild[]>>
  axitoolsGuildRoles(guildId: string): Promise<Result<unknown>>
  boundGw2Guilds(discordGuildId: string): Promise<Result<string[]>>
  discordOverview(guildId: string, includeMembers: boolean): Promise<Result<unknown>>
  discordAction(
    guildId: string,
    action: string,
    params: Record<string, unknown>
  ): Promise<Result<unknown>>

  buildRoster(): Promise<Result<RosterPayload>>
  upsertAnnotation(memberId: string, patch: RosterAnnotationPatch): Promise<RosterAnnotation | null>
  removeAnnotation(memberId: string): Promise<void>
  setLink(accountName: string, memberId: string): Promise<RosterLink>
  removeLink(accountName: string): Promise<void>

  syncStatus(): Promise<SyncStatus>
  reinitSync(): Promise<SyncStatus>
  onSyncChanged(cb: () => void): () => void
  onSyncStatus(cb: (status: SyncStatus) => void): () => void
}

declare global {
  interface Window {
    axiroster: AxiRosterApi
  }
}
