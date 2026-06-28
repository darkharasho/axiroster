// supabase/functions/_shared/axitools.ts
// Deno + Node port of src/main/axitoolsClient.ts, trimmed to the proxied ops.
// fetch is injected for testability. Same Bearer + error semantics as desktop.
// NOTE: intentionally omits the desktop's resilientFetch retry/timeout (YAGNI on
// Edge); a fetch rejection surfaces as AxitoolsError and the handler maps it to 502.
export class AxitoolsError extends Error {}

export interface AxitoolsClientLike {
  listGuilds(): Promise<unknown>
  guildRoles(guildId: string): Promise<unknown>
  discordOverview(guildId: string, includeMembers: boolean): Promise<unknown>
  membersLinked(guildId: string): Promise<unknown>
  discordAction(guildId: string, action: string, params: Record<string, unknown>): Promise<unknown>
}

export class AxitoolsClient implements AxitoolsClientLike {
  constructor(
    private readonly fetchFn: typeof fetch,
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    let resp: Response
    try {
      resp = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      })
    } catch {
      throw new AxitoolsError('The AxiTools bot is not reachable — is it running?')
    }
    if (resp.status === 204) return undefined
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
    return data
  }

  listGuilds(): Promise<unknown> {
    return this.request('GET', '/guilds')
  }
  guildRoles(guildId: string): Promise<unknown> {
    return this.request('GET', `/guilds/${guildId}/guild-roles`)
  }
  discordOverview(guildId: string, includeMembers: boolean): Promise<unknown> {
    return this.request('GET', `/guilds/${guildId}/discord${includeMembers ? '?include=members' : ''}`)
  }
  membersLinked(guildId: string): Promise<unknown> {
    return this.request('GET', `/guilds/${guildId}/members-linked`)
  }
  discordAction(guildId: string, action: string, params: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', `/guilds/${guildId}/discord/actions`, { action, params })
  }
}
