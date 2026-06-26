// Public types shared with the renderer. Kept in sync by hand with the main
// process so the renderer's tsconfig need not include src/main.

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export interface BridgeRepo {
  owner: string
  repo: string
}

/** A guild connection: one GW2 guild + its 1:1 Discord server, with credentials. */
export interface GuildSummary {
  id: string
  name: string
  active: boolean
  gw2GuildName: string
  gw2GuildId: string
  gw2AccountName: string
  hasGw2Key: boolean
  discordGuildName: string
  discordGuildId: string
  hasAxitoolsKey: boolean
  memberRoleId: string
  bridgeRepos: BridgeRepo[]
  /** GW2 key + guild adopted (read-only) from a shared workspace. */
  shared: boolean
  /** AxiTools key is owner-shared (read-only) rather than the member's own. */
  axitoolsShared: boolean
}

/** Full profile incl. secret keys — only ever round-trips main<->edit form. */
export interface GuildProfile {
  id: string
  name: string
  gw2ApiKey: string
  gw2GuildId: string
  gw2GuildName: string
  gw2AccountName: string
  axitoolsKey: string
  discordGuildId: string
  discordGuildName: string
  memberRoleId: string
  bridgeRepos: BridgeRepo[]
  /** GW2 key + guild adopted (read-only) from the workspace. */
  shared: boolean
  /** AxiTools key is owner-shared (read-only) rather than the member's own. */
  axitoolsShared: boolean
}

export type GuildProfileInput = Omit<GuildProfile, 'id'> & { id?: string }

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
  /** Raw Discord color: an int, a hex string, or null (normalized renderer-side). */
  colorRaw: number | string | null
  /** Custom role icon hash, or null. */
  iconHash: string | null
  /** Role's unicode emoji, or null. */
  emoji: string | null
}

export interface SourceStatus {
  hasKey: boolean
  configured: boolean
  loaded: boolean
  count: number
  guildId: string | null
  guildName: string | null
  error: string | null
}

export interface DiscordCandidate {
  id: string
  name: string
  displayName: string
}

export interface RosterPayload {
  members: ReconciledMember[]
  metrics: Record<string, BridgePlayerMetrics>
  discordGuildId: string | null
  discordRoles: DiscordRole[]
  discordCandidates: DiscordCandidate[]
  memberRoleId: string | null
  /** GW2 rank name -> hierarchy order (lower = higher rank), for sorting. */
  rankOrder: Record<string, number>
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

export interface AuthStatus {
  signedIn: boolean
  role?: string
  workspaceId?: string
}

export interface AuthSignInResult {
  accountName: string
  role: string | null
  workspaceId: string | null
}

export interface ClaimGuildResult {
  ok: boolean
  error?: string
  workspaceId?: string
}

export interface WorkspaceMember {
  userId: string
  discordId: string
  /** Discord @username, persisted on the membership row (may be empty). */
  discordName: string
  /** Discord display (global) name, persisted on the membership row. */
  discordGlobalName: string
  role: string
}

export interface InviteResult {
  code?: string
  error?: string
}

export interface DiscordRosterMember {
  id: string
  name: string
  displayName: string
}

export interface PendingInvite {
  id: string
  workspaceId: string
  role: string
  guildName: string
}

export interface SentInvite {
  id: string
  discordId: string | null
  code: string | null
  role: string
}

export interface RosterRefreshResult {
  count: number
}

export interface WhatsNew {
  version: string
  lastSeenVersion: string | null
  /** Markdown for versions newer than lastSeenVersion (or all, when forced); null if none. */
  releaseNotes: string | null
}

export interface AxiRosterApi {
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>

  listGuilds(): Promise<GuildSummary[]>
  getGuild(id: string): Promise<GuildProfile | null>
  upsertGuild(input: GuildProfileInput): Promise<GuildSummary | null>
  removeGuild(id: string): Promise<void>
  setActiveGuild(id: string): Promise<void>

  gw2AccountInfo(apiKey?: string): Promise<Result<Gw2AccountInfo>>

  axitoolsListGuilds(key?: string): Promise<Result<DiscordGuild[]>>
  axitoolsGuildRoles(guildId: string, key?: string): Promise<Result<unknown>>
  boundGw2Guilds(discordGuildId: string, key?: string): Promise<Result<string[]>>
  discordOverview(guildId: string, includeMembers: boolean, key?: string): Promise<Result<unknown>>
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

  // Auth
  authStatus(): Promise<AuthStatus>
  authSignIn(): Promise<AuthSignInResult | null>
  authSignOut(): Promise<void>

  // Guild claiming
  claimGuild(): Promise<ClaimGuildResult>

  /** Role per workspace (keyed by gw2GuildId) for the signed-in user; {} when signed out. */
  listWorkspaceRoles(): Promise<Record<string, string>>

  // Members management
  listMembers(): Promise<WorkspaceMember[]>
  setMemberRole(userId: string, role: string): Promise<void>
  revokeMember(userId: string): Promise<void>
  discordMembers(): Promise<DiscordRosterMember[]>

  // Invites
  createInvite(payload: { discordId?: string; code?: string; role?: string }): Promise<InviteResult>
  redeemInvite(code: string): Promise<{ ok: boolean; error?: string; role?: string; workspaceId?: string }>
  listInvites(): Promise<PendingInvite[]>
  respondInvite(
    inviteId: string,
    action: 'accept' | 'reject'
  ): Promise<{ ok: boolean; error?: string; workspaceId?: string }>
  pendingSentInvites(): Promise<SentInvite[]>
  revokeInvite(inviteId: string): Promise<{ ok: boolean }>
  adoptSharedKeys(): Promise<{ adopted: boolean }>

  // Roster refresh
  refreshRoster(): Promise<RosterRefreshResult>

  windowMinimize(): Promise<void>
  windowMaximizeToggle(): Promise<boolean>
  windowClose(): Promise<void>
  windowIsMaximized(): Promise<boolean>
  platform(): Promise<NodeJS.Platform>
  appVersion(): Promise<string>

  openExternal(url: string): Promise<void>

  // What's New (release notes baked into the app)
  getWhatsNew(force?: boolean): Promise<WhatsNew>
  markWhatsNewSeen(version: string): Promise<void>
  onWindowMaximized(cb: (max: boolean) => void): () => void

  syncStatus(): Promise<SyncStatus>
  reinitSync(): Promise<SyncStatus>
  onSyncChanged(cb: () => void): () => void
  onSyncStatus(cb: (status: SyncStatus) => void): () => void
  onWorkspaceChanged(cb: () => void): () => void

  // Auto-update
  checkForUpdate(): Promise<{ ok: boolean; error?: string }>
  restartToUpdate(): Promise<void>
  onUpdateStatus(cb: (status: string) => void): () => void
  onUpdateAvailable(cb: (info: { version: string }) => void): () => void
  onUpdateProgress(cb: (info: { percent: number }) => void): () => void
  onUpdateDownloaded(cb: (info: { version: string }) => void): () => void
  onUpdateError(cb: (info: { message: string }) => void): () => void
}

declare global {
  interface Window {
    axiroster: AxiRosterApi
  }
}
