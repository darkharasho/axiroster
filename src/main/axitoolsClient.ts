// src/main/axitoolsClient.ts
//
// Talks to a guild's AxiTools Discord bot over its HTTP API. The baseUrl + token
// are decoded from an `axt1.…` key (see axivaleKey.ts) so users never configure
// an address by hand. Trimmed to the endpoints AxiRoster needs: Discord roster +
// linked GW2 accounts + role management. Mirrors AxiVale's client shape.

import { resilientFetch, FetchTimeoutError } from '../shared/net/resilientFetch'
import type { DiscordAuditRaw } from './auditNormalize'

export class AxitoolsError extends Error {}

export interface DiscordGuild {
  id: string
  name: string
}

export class AxitoolsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    // GETs are idempotent and include the heavy member-roster fetch, which can
    // legitimately take a while on a big guild. Give them a generous deadline and
    // one retry so a single slow/hung response doesn't surface as "bot is down"
    // (the bot's Discord presence can be green while its HTTP API is just slow).
    // Mutations (POST actions like kick) stay single-shot to avoid double-applying.
    const isGet = method === 'GET'
    let resp: Response
    try {
      resp = await resilientFetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        timeoutMs: isGet ? 20000 : 10000,
        retries: isGet ? 1 : 0
      })
    } catch (err) {
      // Log the host (never the token) so a wrong/unreachable base URL is
      // diagnosable from the dev terminal.
      let host = this.baseUrl
      try {
        host = new URL(this.baseUrl).host
      } catch {
        /* keep raw */
      }
      console.warn(`[axitools] ${method} ${path} failed against ${host}:`, (err as Error).message)
      if (err instanceof FetchTimeoutError) {
        throw new AxitoolsError('The AxiTools bot did not respond in time — is it running?')
      }
      throw new AxitoolsError('The AxiTools bot is not reachable — is it running?')
    }
    if (resp.status === 204) return undefined as T
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        throw new AxitoolsError(
          (data as { error?: string }).error ??
            'This AxiTools key was rejected (invalid or revoked). Regenerate it in Discord with /config apikey generate.'
        )
      }
      throw new AxitoolsError(
        (data as { error?: string }).error ?? `AxiTools API error (HTTP ${resp.status})`
      )
    }
    return data as T
  }

  listGuilds(): Promise<DiscordGuild[]> {
    return this.request('GET', '/guilds')
  }

  /** Full Discord server snapshot: channels, roles (with permissions + member
   *  counts) and, when includeMembers, the member list with display names/roles. */
  discordOverview(guildId: string, includeMembers = false): Promise<unknown> {
    const qs = includeMembers ? '?include=members' : ''
    return this.request('GET', `/guilds/${guildId}/discord${qs}`)
  }

  /** AxiTools' cached roster: Discord members auto-linked to GW2 accounts. */
  membersLinked(guildId: string): Promise<unknown> {
    return this.request('GET', `/guilds/${guildId}/members-linked`)
  }

  /** Management actions: role_assign, role_unassign, member_kick, member_dm, etc.
   *  Destructive actions should be confirmed in the UI before calling. */
  discordAction(guildId: string, action: string, params: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', `/guilds/${guildId}/discord/actions`, { action, params })
  }

  /** The GW2-guild-id -> Discord-role-id mapping AxiTools maintains. */
  guildRolesGet(guildId: string): Promise<unknown> {
    return this.request('GET', `/guilds/${guildId}/guild-roles`)
  }

  /** Discord audit events for this guild, newest-first. `sinceId` returns only
   *  rows after that audit id (incremental catch-up); `limit` caps the batch
   *  (the bot enforces a max of 200). */
  auditDiscord(
    guildId: string,
    opts: { sinceId?: string; limit?: number } = {}
  ): Promise<DiscordAuditRaw[]> {
    const qs = new URLSearchParams()
    if (opts.sinceId) qs.set('since_id', opts.sinceId)
    qs.set('limit', String(opts.limit ?? 200))
    return this.request('GET', `/guilds/${guildId}/audit/discord?${qs.toString()}`)
  }
}
