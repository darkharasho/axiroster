// src/main/guildStore.ts
//
// A "Guild" is the unit of connection in AxiRoster: one GW2 guild and its 1:1
// Discord server, bundled with the credentials and selections needed to reach
// both. Settings is organized as a list of these profiles with one active; the
// roster always reads from the active guild. Profiles carry API keys, so the
// whole list is persisted as a single encrypted secret via SettingsStore.

import type { SettingsStore } from './secrets'

export interface BridgeRepo {
  owner: string
  repo: string
}

export interface GuildProfile {
  id: string
  /** Display name (defaults to the GW2 guild name). */
  name: string
  // GW2 side
  gw2ApiKey: string
  gw2GuildId: string
  gw2GuildName: string
  gw2AccountName: string
  // Discord side (via AxiTools)
  axitoolsKey: string
  discordGuildId: string
  discordGuildName: string
  /** Discord role id that marks a guild member (anchors the reconciled roster). */
  memberRoleId: string
  // WvW reports
  bridgeRepos: BridgeRepo[]
  /** True when this guild was adopted from a workspace — the GW2 key + guild are
   *  owner-managed (always shared) and read-only here. */
  shared: boolean
  /** True when the owner also shares the AxiTools key — then it's read-only too;
   *  otherwise the member supplies their own. */
  axitoolsShared: boolean
  /** Enables the Retention radar for this guild (default false — opt-in). */
  retentionEnabled: boolean
}

export type GuildProfileInput = Omit<GuildProfile, 'id'> & { id?: string }

/** What the renderer sees — never the raw keys, just whether they're set. */
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
  retentionEnabled: boolean
}

function uuid(): string {
  // Available in the Electron main process (Node 18+).
  return globalThis.crypto.randomUUID()
}

function normalize(p: Partial<GuildProfile>): GuildProfile {
  return {
    id: typeof p.id === 'string' && p.id ? p.id : uuid(),
    name: typeof p.name === 'string' ? p.name : '',
    gw2ApiKey: typeof p.gw2ApiKey === 'string' ? p.gw2ApiKey : '',
    gw2GuildId: typeof p.gw2GuildId === 'string' ? p.gw2GuildId : '',
    gw2GuildName: typeof p.gw2GuildName === 'string' ? p.gw2GuildName : '',
    gw2AccountName: typeof p.gw2AccountName === 'string' ? p.gw2AccountName : '',
    axitoolsKey: typeof p.axitoolsKey === 'string' ? p.axitoolsKey : '',
    discordGuildId: typeof p.discordGuildId === 'string' ? p.discordGuildId : '',
    discordGuildName: typeof p.discordGuildName === 'string' ? p.discordGuildName : '',
    memberRoleId: typeof p.memberRoleId === 'string' ? p.memberRoleId : '',
    bridgeRepos: Array.isArray(p.bridgeRepos)
      ? p.bridgeRepos.filter((r): r is BridgeRepo => Boolean(r?.owner && r?.repo))
      : [],
    shared: p.shared === true,
    axitoolsShared: p.axitoolsShared === true,
    retentionEnabled: p.retentionEnabled === true
  }
}

export class GuildStore {
  constructor(private readonly store: SettingsStore) {}

  private read(): GuildProfile[] {
    const raw = this.store.getSecret('guilds')
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? parsed.map(normalize) : []
    } catch {
      return []
    }
  }

  private write(list: GuildProfile[]): void {
    this.store.setSecret('guilds', JSON.stringify(list))
  }

  activeId(): string | null {
    const wanted = this.store.getSetting('activeGuildId')
    const list = this.read()
    if (wanted && list.some((g) => g.id === wanted)) return wanted
    return list[0]?.id ?? null
  }

  active(): GuildProfile | null {
    const id = this.activeId()
    return this.read().find((g) => g.id === id) ?? null
  }

  get(id: string): GuildProfile | null {
    return this.read().find((g) => g.id === id) ?? null
  }

  all(): GuildProfile[] {
    return this.read()
  }

  summaries(): GuildSummary[] {
    const activeId = this.activeId()
    return this.read().map((g) => ({
      id: g.id,
      name: g.name || g.gw2GuildName || g.discordGuildName || 'Untitled guild',
      active: g.id === activeId,
      gw2GuildName: g.gw2GuildName,
      gw2GuildId: g.gw2GuildId,
      gw2AccountName: g.gw2AccountName,
      hasGw2Key: Boolean(g.gw2ApiKey),
      discordGuildName: g.discordGuildName,
      discordGuildId: g.discordGuildId,
      hasAxitoolsKey: Boolean(g.axitoolsKey),
      memberRoleId: g.memberRoleId,
      bridgeRepos: g.bridgeRepos,
      shared: g.shared,
      axitoolsShared: g.axitoolsShared,
      retentionEnabled: g.retentionEnabled
    }))
  }

  /** Create or replace a profile; first profile created becomes active. */
  upsert(input: GuildProfileInput): GuildProfile {
    const list = this.read()
    const rec = normalize(input)
    const idx = list.findIndex((g) => g.id === rec.id)
    if (idx >= 0) list[idx] = rec
    else list.push(rec)
    this.write(list)
    if (!this.store.getSetting('activeGuildId') && list.length === 1) {
      this.store.setSetting('activeGuildId', rec.id)
    }
    return rec
  }

  remove(id: string): void {
    const list = this.read().filter((g) => g.id !== id)
    this.write(list)
    if (this.store.getSetting('activeGuildId') === id) {
      this.store.setSetting('activeGuildId', list[0]?.id ?? '')
    }
  }

  setActive(id: string): void {
    this.store.setSetting('activeGuildId', id)
  }
}
