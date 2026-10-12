// Test-only fake of the renderer's client seam. Every method is a vi.fn; on*
// subscriptions record their callback so a test can emit() the event, and
// return an unsubscribe so listenerCount() can prove cleanup. Anything not
// given a default resolves undefined.
import { vi, type Mock } from 'vitest'
import { setClient, type AxiClient } from '../lib/client'
import type { GuildSummary, ReconciledMember, RosterPayload, SourceStatus } from '../../../preload/index.d'

const SOURCE: SourceStatus = {
  hasKey: false, configured: false, loaded: false, count: 0, guildId: null, guildName: null, error: null
}

export function emptyRoster(members: ReconciledMember[] = []): RosterPayload {
  return {
    members, metrics: {}, attendance: [], discordGuildId: null, discordRoles: [],
    discordCandidates: [], memberRoleId: null, rankOrder: {},
    sources: { gw2: SOURCE, discord: SOURCE, bridge: SOURCE }, warnings: []
  }
}

export function member(key: string, over: Partial<ReconciledMember> = {}): ReconciledMember {
  return {
    memberId: null, annotationKey: key, hasMemberRole: false, roles: [],
    accounts: [{ account_name: `${key}.1234`, characters: [], inGuild: true, manual: false, main: true }],
    linkSource: null, guildLabels: [], linked: false, inGuild: true, status: 'unlinked' as ReconciledMember['status'],
    nickname: '', aliases: [], notes: '', tags: [], label: key, ...over
  }
}

export function guild(id: string, over: Partial<GuildSummary> = {}): GuildSummary {
  return {
    id, name: `Guild ${id}`, active: false, gw2GuildName: `Guild ${id}`, gw2GuildId: `gw2-${id}`,
    gw2AccountName: '', hasGw2Key: true, discordGuildName: '', discordGuildId: '', hasAxitoolsKey: false,
    memberRoleId: '', bridgeRepos: [], shared: false, axitoolsShared: false,
    retentionEnabled: true, pipelineEnabled: true, ...over
  }
}

export function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const DEFAULTS: Record<string, (...args: never[]) => unknown> = {
  authStatus: async () => ({ signedIn: true, role: 'owner', userId: 'u1' }),
  syncStatus: async () => 'disabled',
  listWorkspaceRoles: async () => ({}),
  listGuilds: async () => [],
  listInvites: async () => [],
  getWhatsNew: async () => ({ version: '1.0.0', releaseNotes: null, lastSeenVersion: '1.0.0' }),
  getTagRegistry: async () => ({}),
  departuresGet: async () => [],
  buildRoster: async () => ({ ok: true, data: emptyRoster() }),
  auditList: async () => ({ events: [], updatedAt: '' }),
  auditStatus: async () => null,
  pipelineGet: async () => ({ stages: undefined, placement: {}, placedAt: {}, prospects: [], votes: [], commentCounts: {} }),
  pipelinePrunePlacements: async () => 0,
  adoptSharedKeys: async () => undefined,
  getGuild: async () => null,
  setActiveGuild: async () => undefined,
  logRetention: async () => undefined
}

export function fakeClient(overrides: Record<string, (...args: never[]) => unknown> = {}): {
  api: Record<string, Mock>
  emit: (name: string) => void
  listenerCount: (name: string) => number
} {
  const listeners = new Map<string, Set<() => void>>()
  const fns = new Map<string, Mock>()
  const impls = { ...DEFAULTS, ...overrides }
  const get = (prop: string): Mock => {
    let fn = fns.get(prop)
    if (fn) return fn
    if (/^on[A-Z]/.test(prop) && !(prop in impls)) {
      fn = vi.fn((cb: () => void) => {
        const set = listeners.get(prop) ?? new Set()
        set.add(cb)
        listeners.set(prop, set)
        return () => { set.delete(cb) }
      })
    } else {
      fn = vi.fn(impls[prop] ?? (async () => undefined))
    }
    fns.set(prop, fn)
    return fn
  }
  const api = new Proxy({} as Record<string, Mock>, { get: (_t, prop: string) => get(prop) })
  setClient(api as unknown as AxiClient)
  return {
    api,
    emit: (name) => { for (const cb of [...(listeners.get(name) ?? [])]) cb() },
    listenerCount: (name) => listeners.get(name)?.size ?? 0
  }
}
