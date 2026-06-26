import { contextBridge, ipcRenderer } from 'electron'

// The single typed surface the renderer talks to. Mirror every method in
// index.d.ts so the renderer stays type-checked against this bridge.
const api = {
  // settings (sync config only)
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),

  // Guild profiles
  listGuilds: () => ipcRenderer.invoke('guilds:list'),
  getGuild: (id: string) => ipcRenderer.invoke('guilds:get', id),
  upsertGuild: (input: Record<string, unknown>) => ipcRenderer.invoke('guilds:upsert', input),
  removeGuild: (id: string) => ipcRenderer.invoke('guilds:remove', id),
  setActiveGuild: (id: string) => ipcRenderer.invoke('guilds:setActive', id),

  // GW2 — pass a key to validate it before saving a guild, else uses the active guild
  gw2AccountInfo: (apiKey?: string) => ipcRenderer.invoke('gw2:accountInfo', apiKey),

  // AxiTools / Discord — optional key to validate during the add-new flow
  axitoolsListGuilds: (key?: string) => ipcRenderer.invoke('axitools:listGuilds', key),
  axitoolsGuildRoles: (guildId: string, key?: string) =>
    ipcRenderer.invoke('axitools:guildRoles', guildId, key),
  boundGw2Guilds: (discordGuildId: string, key?: string) =>
    ipcRenderer.invoke('connection:boundGw2Guilds', discordGuildId, key),
  discordOverview: (guildId: string, includeMembers: boolean, key?: string) =>
    ipcRenderer.invoke('axitools:discordOverview', guildId, includeMembers, key),
  discordAction: (guildId: string, action: string, params: Record<string, unknown>) =>
    ipcRenderer.invoke('discord:action', guildId, action, params),

  // Roster
  buildRoster: () => ipcRenderer.invoke('roster:build'),
  upsertAnnotation: (memberId: string, patch: Record<string, unknown>) =>
    ipcRenderer.invoke('roster:annotation:upsert', memberId, patch),
  removeAnnotation: (memberId: string) => ipcRenderer.invoke('roster:annotation:remove', memberId),
  setLink: (accountName: string, memberId: string) =>
    ipcRenderer.invoke('roster:link:set', accountName, memberId),
  removeLink: (accountName: string) => ipcRenderer.invoke('roster:link:remove', accountName),

  // Window controls (frameless custom titlebar)
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximizeToggle: () => ipcRenderer.invoke('window:maximizeToggle'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  platform: () => ipcRenderer.invoke('app:platform'),
  onWindowMaximized: (cb: (max: boolean) => void) => {
    const listener = (_e: unknown, max: boolean): void => cb(max)
    ipcRenderer.on('window:maximized', listener)
    return () => ipcRenderer.removeListener('window:maximized', listener)
  },

  // Auth
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authSignIn: () => ipcRenderer.invoke('auth:signIn'),
  authSignOut: () => ipcRenderer.invoke('auth:signOut'),

  // Guild claiming
  claimGuild: () => ipcRenderer.invoke('guild:claim'),

  // Members management
  listMembers: () => ipcRenderer.invoke('members:list'),
  setMemberRole: (userId: string, role: string) =>
    ipcRenderer.invoke('members:setRole', { userId, role }),
  revokeMember: (userId: string) => ipcRenderer.invoke('members:revoke', { userId }),
  discordMembers: () => ipcRenderer.invoke('discord:members'),

  // Invites
  createInvite: (payload: { discordId?: string; code?: string; role?: string }) =>
    ipcRenderer.invoke('invite:create', payload),

  // Roster refresh
  refreshRoster: () => ipcRenderer.invoke('roster:refresh'),

  // Sync
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  reinitSync: () => ipcRenderer.invoke('sync:reinit'),
  onSyncChanged: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('sync:changed', listener)
    return () => ipcRenderer.removeListener('sync:changed', listener)
  },
  onSyncStatus: (cb: (status: string) => void) => {
    const listener = (_e: unknown, status: string): void => cb(status)
    ipcRenderer.on('sync:status', listener)
    return () => ipcRenderer.removeListener('sync:status', listener)
  }
}

contextBridge.exposeInMainWorld('axiroster', api)

export type AxiRosterApi = typeof api
