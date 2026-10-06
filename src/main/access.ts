// Access check: blocks the app when one of its identities is on the Axi
// denylist. See README "Access".
import {
  createAccessGate,
  createConfig,
  gw2GuildIdentity,
  gw2KeyIdentities,
  tryNormalizeIdentity,
  type AccessGate,
  type AxiConfig,
  type Identity
} from '@axiapps/axi-config'
import { blockIfTripped, handleBlocked, type ElectronLike, type RelaunchableApp } from '@axiapps/axi-config/electron'

/** The guild fields the check reads (a subset of GuildProfile). */
export interface AccessGuild {
  gw2ApiKey?: string
  gw2GuildId?: string
  gw2AccountName?: string
}

/** The parts of a Supabase user the Discord snowflake can come from. */
export interface AccessUser {
  id?: unknown // the Supabase UUID; deliberately never used
  user_metadata?: { provider_id?: unknown; sub?: unknown } | null
  identities?: Array<{ provider?: unknown; id?: unknown }> | null
}

export interface AccessDeps {
  electron: ElectronLike & { app: RelaunchableApp & { getPath(name: 'userData'): string } }
  config?: AxiConfig // tests inject one; production creates it
  onBlocked?: (info: { persisted: boolean }) => void // tests inject a spy
  readGuilds: () => readonly AccessGuild[]
  getSession: () => Promise<{ user?: AccessUser | null } | null>
  fetch?: typeof globalThis.fetch
}

export type AccessBoot = { blocked: true } | { blocked: false; gate: AccessGate; config: AxiConfig }

const SNOWFLAKE = /^\d{5,25}$/

/**
 * The signed-in user's Discord snowflake: provider_id, else sub, else the id of
 * the discord entry in identities[]. Never the Supabase UUID; a malformed
 * value gives null.
 */
export function discordUserId(user: AccessUser | null | undefined): string | null {
  if (!user) return null
  const meta = user.user_metadata
  const candidates: unknown[] = [meta?.provider_id, meta?.sub]
  if (Array.isArray(user.identities)) {
    candidates.push(user.identities.find((i) => i?.provider === 'discord')?.id)
  }
  for (const c of candidates) {
    if (typeof c === 'string' && SNOWFLAKE.test(c)) return c
  }
  return null
}

// Drops anything the package would reject, so one malformed value can't make a
// whole check fail open.
function valid(ids: readonly Identity[]): Identity[] {
  return ids.filter((i) => tryNormalizeIdentity(i.kind, i.value) !== null)
}

export async function startAccess(deps: AccessDeps): Promise<AccessBoot> {
  const config = deps.config ?? createConfig({ appId: 'axiroster', cacheDir: deps.electron.app.getPath('userData') })
  await config.ready()
  if (blockIfTripped(deps.electron, config)) return { blocked: true }
  const gate = createAccessGate({
    config,
    onBlocked: deps.onBlocked ?? ((info) => handleBlocked(deps.electron, config, info))
  })

  // Every guild profile, including shared ones that carry the owner's key.
  gate.addSource('gw2', async () => {
    const out: Identity[] = []
    const keys = new Set<string>()
    for (const g of deps.readGuilds()) {
      if (typeof g.gw2AccountName === 'string' && g.gw2AccountName.trim() !== '') {
        out.push({ kind: 'gw2_account', value: g.gw2AccountName })
      }
      out.push(...gw2GuildIdentity(g.gw2GuildId))
      if (typeof g.gw2ApiKey === 'string' && g.gw2ApiKey.trim() !== '') keys.add(g.gw2ApiKey.trim())
    }
    for (const key of keys) out.push(...(await gw2KeyIdentities(key, { fetch: deps.fetch })))
    return valid(out)
  })

  gate.addSource('discord', async () => {
    const id = discordUserId((await deps.getSession())?.user)
    return id ? valid([{ kind: 'discord_user', value: id }]) : []
  })

  config.onChange(() => void gate.recheck())
  return { blocked: false, gate, config }
}
