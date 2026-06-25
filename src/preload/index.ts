import { contextBridge, ipcRenderer } from 'electron'

// The single typed surface the renderer talks to. Mirror every method in
// index.d.ts so the renderer stays type-checked against this bridge.
const api = {
  // settings + keyrings
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  listKeys: (service: string) => ipcRenderer.invoke('keys:list', service),
  addKey: (service: string, label: string, key: string) =>
    ipcRenderer.invoke('keys:add', service, label, key),
  removeKey: (service: string, label: string) => ipcRenderer.invoke('keys:remove', service, label),
  setActiveKey: (service: string, label: string) =>
    ipcRenderer.invoke('keys:setActive', service, label),

  // GW2
  gw2AccountInfo: () => ipcRenderer.invoke('gw2:accountInfo'),

  // AxiTools / Discord
  axitoolsListGuilds: () => ipcRenderer.invoke('axitools:listGuilds'),
  axitoolsGuildRoles: (guildId: string) => ipcRenderer.invoke('axitools:guildRoles', guildId),
  boundGw2Guilds: (discordGuildId: string) =>
    ipcRenderer.invoke('connection:boundGw2Guilds', discordGuildId),
  discordOverview: (guildId: string, includeMembers: boolean) =>
    ipcRenderer.invoke('axitools:discordOverview', guildId, includeMembers),
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
