// src/renderer/src/lib/webClient/webClient.ts
// The web implementation of the AxiClient contract (the 2a seam type). Every
// method is now fully implemented (no notImplemented stubs remain): web-trivial
// methods are inline, data/auth/admin methods delegate to the ./* slice modules
// and run against Supabase. Installed via setClient at the web entry. The vitest
// env is node, so browser globals are taken from deps (injected in tests) ??
// globalThis (real browser).
import type { AxiClient } from '../client'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Result } from '../../../../preload/index.d'
import { createWebSettings } from './settings'
import { webAuthStatus, webSignIn, webSignOut } from './auth'
import {
  webGw2AccountInfo,
  webAxitoolsListGuilds,
  webAxitoolsGuildRoles,
  webDiscordOverview,
  webBoundGw2Guilds,
  webDiscordAction
} from './discordGw2'
import { webBuildRoster, webRefreshRoster } from './roster'
import { webListGuilds, webGetGuild, webSetActiveGuild, webListWorkspaceRoles, webListInvites, webRespondInvite } from './workspace'
import { webGetTagRegistry, webSetTagRegistry, webUpsertAnnotation, webRemoveAnnotation, webSetLink, webRemoveLink } from './crud'
import { webAuditList, webAuditRefresh } from './audit'
import { webListMembers, webSetMemberRole, webRevokeMember, webDiscordMembers } from './members'
import { webPipelineGet, webPipelineSetPlacement, webPipelinePlaceMany, webPipelineSetStages, webPipelineAddProspect, webPipelineRemoveProspect, webPipelineVote, webPipelineLinkProspect, webPipelineArchivePassed } from './pipeline'
import { webCreateInvite, webRedeemInvite, webPendingSentInvites, webRevokeInvite, webAdoptSharedKeys, webLogRetention } from './admin'
import { webUpsertGuild, webClaimGuild, webRemoveGuild } from './guilds'

export interface WebClientDeps {
  storage?: Storage
  open?: (url: string, target?: string, features?: string) => unknown
  userAgent?: string
  appVersion?: string
  supabase?: SupabaseClient
  redirectTo?: string
}

export function createWebClient(deps: WebClientDeps = {}): AxiClient {
  const settings = createWebSettings(deps.storage)
  const redirect = deps.redirectTo ?? globalThis.location?.origin ?? ''
  const requireSupabase = (): SupabaseClient => {
    if (!deps.supabase) throw new Error('Supabase client not configured')
    return deps.supabase
  }
  const withSb = <T>(fn: (sb: SupabaseClient) => Promise<Result<T>>): Promise<Result<T>> =>
    deps.supabase ? fn(deps.supabase) : Promise.resolve({ ok: false, error: 'Supabase client not configured' })
  const ua = deps.userAgent ?? globalThis.navigator?.userAgent ?? ''
  const openUrl =
    deps.open ?? ((url: string, target?: string, features?: string) => globalThis.open?.(url, target, features))
  const version = deps.appVersion ?? '0.0.0-web'
  const noopUnsub = (): (() => void) => () => {}

  return {
    // (A) settings -> localStorage
    getSetting: async (key) => settings.get(key),
    setSetting: async (key, value) => {
      settings.set(key, value)
    },

    // (B) Electron-only -> web behavior
    windowMinimize: async () => {},
    windowClose: async () => {},
    windowMaximizeToggle: async () => false,
    windowIsMaximized: async () => false,
    platform: async () => (/Mac/i.test(ua) ? 'darwin' : /Win/i.test(ua) ? 'win32' : 'linux'),
    appVersion: async () => version,
    openExternal: async (url) => {
      openUrl(url, '_blank', 'noopener,noreferrer')
    },
    getWhatsNew: async () => ({ version, lastSeenVersion: null, releaseNotes: null }),
    markWhatsNewSeen: async () => {},
    checkForUpdate: async () => ({ ok: true }),
    restartToUpdate: async () => {},
    // A configured web client reads/writes Supabase directly, so the badge reads
    // "Synced" ('connected'); an unconfigured one (no supabase) reads "Local only"
    // ('disabled') rather than lying. (Realtime push isn't wired yet.)
    syncStatus: async () => (deps.supabase ? 'connected' : 'disabled'),
    reinitSync: async () => (deps.supabase ? 'connected' : 'disabled'),
    auditStatus: async () => null,

    // (C) event subscriptions -> no-op unsubscribe
    onWindowMaximized: () => noopUnsub(),
    onSyncChanged: () => noopUnsub(),
    onSyncStatus: () => noopUnsub(),
    onWorkspaceChanged: () => noopUnsub(),
    onUpdateStatus: () => noopUnsub(),
    onUpdateAvailable: () => noopUnsub(),
    onUpdateProgress: () => noopUnsub(),
    onUpdateDownloaded: () => noopUnsub(),
    onUpdateError: () => noopUnsub(),
    onAuditUpdated: () => noopUnsub(),
    onAuditError: () => noopUnsub(),
    onAuditStatus: () => noopUnsub(),

    // (D) data + auth -> NotImplemented (filled by 2b-3b+)
    listGuilds: async () => (deps.supabase ? webListGuilds(deps.supabase, settings) : []),
    getGuild: async (id) => (deps.supabase ? webGetGuild(deps.supabase, id) : null),
    upsertGuild: async (input) => (deps.supabase ? webUpsertGuild(deps.supabase, settings, input) : null),
    removeGuild: async (id) => {
      if (deps.supabase) await webRemoveGuild(deps.supabase, settings, id)
    },
    setActiveGuild: async (id) => webSetActiveGuild(settings, id),
    gw2AccountInfo: (apiKey) => webGw2AccountInfo(apiKey),
    axitoolsListGuilds: (key) => withSb((sb) => webAxitoolsListGuilds(sb, settings, key)),
    axitoolsGuildRoles: (guildId, key) => withSb((sb) => webAxitoolsGuildRoles(sb, settings, guildId, key)),
    boundGw2Guilds: (discordGuildId, key) => withSb((sb) => webBoundGw2Guilds(sb, settings, discordGuildId, key)),
    discordOverview: (guildId, includeMembers, key) =>
      withSb((sb) => webDiscordOverview(sb, settings, guildId, includeMembers, key)),
    discordAction: (guildId, action, params) => withSb((sb) => webDiscordAction(sb, settings, guildId, action, params)),
    buildRoster: () => withSb((sb) => webBuildRoster(sb, settings)),
    getTagRegistry: async () => (deps.supabase ? webGetTagRegistry(deps.supabase, settings) : {}),
    setTagRegistry: async (map) => {
      if (deps.supabase) await webSetTagRegistry(deps.supabase, settings, map)
    },
    upsertAnnotation: async (memberId, patch) =>
      deps.supabase ? webUpsertAnnotation(deps.supabase, settings, memberId, patch) : null,
    removeAnnotation: async (memberId) => {
      if (deps.supabase) await webRemoveAnnotation(deps.supabase, settings, memberId)
    },
    setLink: async (accountName, memberId) =>
      deps.supabase
        ? webSetLink(deps.supabase, settings, accountName, memberId)
        : { accountName, memberId, createdAt: new Date().toISOString() },
    removeLink: async (accountName) => {
      if (deps.supabase) await webRemoveLink(deps.supabase, settings, accountName)
    },
    authStatus: async () => (deps.supabase ? webAuthStatus(deps.supabase, settings) : { signedIn: false }),
    authSignIn: async () => webSignIn(requireSupabase(), redirect),
    authSignOut: async () => webSignOut(requireSupabase()),
    claimGuild: async () => (deps.supabase ? webClaimGuild(deps.supabase, settings) : { ok: false, error: 'Not signed in' }),
    listWorkspaceRoles: async () => (deps.supabase ? webListWorkspaceRoles(deps.supabase) : {}),
    listMembers: async () => (deps.supabase ? webListMembers(deps.supabase, settings) : []),
    setMemberRole: async (userId, role) => {
      if (deps.supabase) await webSetMemberRole(deps.supabase, settings, userId, role)
    },
    revokeMember: async (userId) => {
      if (deps.supabase) await webRevokeMember(deps.supabase, settings, userId)
    },
    discordMembers: async () => (deps.supabase ? webDiscordMembers(deps.supabase, settings) : []),
    createInvite: async (payload) => (deps.supabase ? webCreateInvite(deps.supabase, settings, payload) : {}),
    redeemInvite: async (code) => (deps.supabase ? webRedeemInvite(deps.supabase, code) : { ok: false, error: 'Not signed in' }),
    listInvites: async () => (deps.supabase ? webListInvites(deps.supabase) : []),
    respondInvite: async (inviteId, action) =>
      deps.supabase ? webRespondInvite(deps.supabase, inviteId, action) : { ok: false, error: 'Supabase client not configured' },
    pendingSentInvites: async () => (deps.supabase ? webPendingSentInvites(deps.supabase, settings) : []),
    revokeInvite: async (inviteId) => (deps.supabase ? webRevokeInvite(deps.supabase, settings, inviteId) : { ok: false }),
    adoptSharedKeys: async () => webAdoptSharedKeys(),
    refreshRoster: async () => {
      if (!deps.supabase) throw new Error('Supabase client not configured')
      return webRefreshRoster(deps.supabase, settings)
    },
    logRetention: async (snapshots) => {
      if (deps.supabase) await webLogRetention(deps.supabase, settings, snapshots)
    },
    auditList: async (filter) =>
      deps.supabase ? webAuditList(deps.supabase, settings, filter) : { events: [], updatedAt: '' },
    auditRefresh: async () => webAuditRefresh(),
    pipelineGet: async () =>
      deps.supabase
        ? webPipelineGet(deps.supabase, settings)
        : { stages: undefined, placement: {}, placedAt: {}, prospects: [], votes: [] },
    pipelineSetPlacement: async (subjectKey, stageId) => {
      if (deps.supabase) await webPipelineSetPlacement(deps.supabase, settings, subjectKey, stageId)
    },
    pipelinePlaceMany: async (keys, stageId) => {
      if (deps.supabase) await webPipelinePlaceMany(deps.supabase, settings, keys, stageId)
    },
    pipelineSetStages: async (stages) => {
      if (deps.supabase) await webPipelineSetStages(deps.supabase, settings, stages)
    },
    pipelineAddProspect: async (input) =>
      deps.supabase
        ? webPipelineAddProspect(deps.supabase, settings, input)
        : {
            memberId: `prospect:${crypto.randomUUID()}`,
            nickname: input.name,
            aliases: input.handle ? [input.handle] : [],
            notes: '',
            tags: [],
            mainAccount: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
    pipelineRemoveProspect: async (key) => {
      if (deps.supabase) await webPipelineRemoveProspect(deps.supabase, settings, key)
    },
    pipelineVote: async (subjectKey, value) => {
      if (deps.supabase) await webPipelineVote(deps.supabase, settings, subjectKey, value)
    },
    pipelineLinkProspect: async (prospectKey, memberKey) => {
      if (deps.supabase) await webPipelineLinkProspect(deps.supabase, settings, prospectKey, memberKey)
    },
    pipelineArchivePassed: async () => {
      if (deps.supabase) await webPipelineArchivePassed(deps.supabase, settings)
    }
  }
}
