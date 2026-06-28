// src/renderer/src/lib/webClient/webClient.ts
// The web implementation of the AxiClient contract (the 2a seam type). This is
// the SKELETON: web-trivial methods are real; data/auth methods throw
// notImplemented and are filled by later 2b-3 slices. Unwired — 2c installs it
// via setClient at the web entry. The vitest env is node, so browser globals are
// taken from deps (injected in tests) ?? globalThis (real browser).
import type { AxiClient } from '../client'
import { createWebSettings } from './settings'
import { notImplemented } from './notImplemented'

export interface WebClientDeps {
  storage?: Storage
  open?: (url: string, target?: string, features?: string) => unknown
  userAgent?: string
  appVersion?: string
}

export function createWebClient(deps: WebClientDeps = {}): AxiClient {
  const settings = createWebSettings(deps.storage)
  const ua = deps.userAgent ?? globalThis.navigator?.userAgent ?? ''
  const openUrl =
    deps.open ?? ((url: string, target?: string, features?: string) => globalThis.open?.(url, target, features))
  const version = deps.appVersion ?? '0.0.0-web'
  const noopUnsub = (): (() => void) => () => {}
  const ni = <K extends keyof AxiClient>(name: K): AxiClient[K] =>
    notImplemented(name as string) as unknown as AxiClient[K]

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
    syncStatus: async () => 'disabled',
    reinitSync: async () => 'disabled',
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
    listGuilds: ni('listGuilds'),
    getGuild: ni('getGuild'),
    upsertGuild: ni('upsertGuild'),
    removeGuild: ni('removeGuild'),
    setActiveGuild: ni('setActiveGuild'),
    gw2AccountInfo: ni('gw2AccountInfo'),
    axitoolsListGuilds: ni('axitoolsListGuilds'),
    axitoolsGuildRoles: ni('axitoolsGuildRoles'),
    boundGw2Guilds: ni('boundGw2Guilds'),
    discordOverview: ni('discordOverview'),
    discordAction: ni('discordAction'),
    buildRoster: ni('buildRoster'),
    upsertAnnotation: ni('upsertAnnotation'),
    removeAnnotation: ni('removeAnnotation'),
    getTagRegistry: ni('getTagRegistry'),
    setTagRegistry: ni('setTagRegistry'),
    setLink: ni('setLink'),
    removeLink: ni('removeLink'),
    authStatus: ni('authStatus'),
    authSignIn: ni('authSignIn'),
    authSignOut: ni('authSignOut'),
    claimGuild: ni('claimGuild'),
    listWorkspaceRoles: ni('listWorkspaceRoles'),
    listMembers: ni('listMembers'),
    setMemberRole: ni('setMemberRole'),
    revokeMember: ni('revokeMember'),
    discordMembers: ni('discordMembers'),
    createInvite: ni('createInvite'),
    redeemInvite: ni('redeemInvite'),
    listInvites: ni('listInvites'),
    respondInvite: ni('respondInvite'),
    pendingSentInvites: ni('pendingSentInvites'),
    revokeInvite: ni('revokeInvite'),
    adoptSharedKeys: ni('adoptSharedKeys'),
    refreshRoster: ni('refreshRoster'),
    logRetention: ni('logRetention'),
    auditList: ni('auditList'),
    auditRefresh: ni('auditRefresh'),
    pipelineGet: ni('pipelineGet'),
    pipelineSetPlacement: ni('pipelineSetPlacement'),
    pipelinePlaceMany: ni('pipelinePlaceMany'),
    pipelineSetStages: ni('pipelineSetStages'),
    pipelineAddProspect: ni('pipelineAddProspect'),
    pipelineRemoveProspect: ni('pipelineRemoveProspect'),
    pipelineVote: ni('pipelineVote'),
    pipelineLinkProspect: ni('pipelineLinkProspect'),
    pipelineArchivePassed: ni('pipelineArchivePassed')
  }
}
