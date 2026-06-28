// src/renderer/src/lib/webClient/discordGw2.ts
// Web Discord/GW2 data methods: the AxiTools ops go through the Phase-1 axitools
// Edge Function (functions.invoke), GW2 account validation is browser-direct via
// the shared Gw2Client. Validation mode (caller key) vs stored mode (active
// workspace). All return Result and never throw.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Result, Gw2AccountInfo, DiscordGuild } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { resolveEffectiveWorkspace } from './auth'
import { Gw2Client } from '../../../../shared/gw2Client'
import { parseBoundGw2Guilds } from '../../../../shared/roster/adapters'

const ok = <T>(data: T): Result<T> => ({ ok: true, data })
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

async function extractMsg(error: unknown): Promise<string> {
  const e = error as { message?: string; context?: { json?: () => Promise<unknown> } }
  try {
    if (e?.context?.json) {
      const body = (await e.context.json()) as { error?: string; message?: string }
      return body.message ?? body.error ?? e.message ?? 'request failed'
    }
  } catch {
    /* fall through to message */
  }
  return e?.message ?? 'request failed'
}

export async function invokeAxitools(
  sb: SupabaseClient,
  body: Record<string, unknown>
): Promise<Result<unknown>> {
  const { data, error } = await sb.functions.invoke('axitools', { body })
  if (error) return fail(await extractMsg(error))
  return ok((data as { data?: unknown } | null)?.data)
}

export async function activeWorkspaceId(
  sb: SupabaseClient,
  settings: WebSettings
): Promise<string | null> {
  const {
    data: { user }
  } = await sb.auth.getUser()
  if (!user?.id) return null
  const ws = await resolveEffectiveWorkspace(sb, settings, user.id)
  return ws?.workspaceId ?? null
}

// Validation mode if `key` is given; else stored mode (active workspace). Returns
// null when stored mode has no resolvable workspace.
async function buildBody(
  sb: SupabaseClient,
  settings: WebSettings,
  op: string,
  key: string | undefined,
  extra: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  if (key !== undefined) return { op, key, ...extra }
  const workspaceId = await activeWorkspaceId(sb, settings)
  if (!workspaceId) return null
  return { op, workspaceId, ...extra }
}

export async function webAxitoolsListGuilds(
  sb: SupabaseClient,
  settings: WebSettings,
  key?: string
): Promise<Result<DiscordGuild[]>> {
  const body = await buildBody(sb, settings, 'listGuilds', key, {})
  if (!body) return fail('No active workspace')
  const r = await invokeAxitools(sb, body)
  return r.ok ? ok((r.data as DiscordGuild[]) ?? []) : r
}

export async function webAxitoolsGuildRoles(
  sb: SupabaseClient,
  settings: WebSettings,
  guildId: string,
  key?: string
): Promise<Result<unknown>> {
  const body = await buildBody(sb, settings, 'guildRoles', key, { guildId })
  if (!body) return fail('No active workspace')
  return invokeAxitools(sb, body)
}

export async function webDiscordOverview(
  sb: SupabaseClient,
  settings: WebSettings,
  guildId: string,
  includeMembers: boolean,
  key?: string
): Promise<Result<unknown>> {
  const body = await buildBody(sb, settings, 'discordOverview', key, { guildId, includeMembers })
  if (!body) return fail('No active workspace')
  return invokeAxitools(sb, body)
}

export async function webBoundGw2Guilds(
  sb: SupabaseClient,
  settings: WebSettings,
  discordGuildId: string,
  key?: string
): Promise<Result<string[]>> {
  const body = await buildBody(sb, settings, 'guildRoles', key, { guildId: discordGuildId })
  if (!body) return fail('No active workspace')
  const r = await invokeAxitools(sb, body)
  return r.ok ? ok(parseBoundGw2Guilds(r.data)) : r
}

export async function webDiscordAction(
  sb: SupabaseClient,
  settings: WebSettings,
  guildId: string,
  action: string,
  params: Record<string, unknown>
): Promise<Result<unknown>> {
  const workspaceId = await activeWorkspaceId(sb, settings)
  if (!workspaceId) return fail('No active workspace')
  return invokeAxitools(sb, { op: 'discordAction', workspaceId, guildId, action, params })
}

export async function webGw2AccountInfo(apiKey?: string): Promise<Result<Gw2AccountInfo>> {
  if (!apiKey) return fail('No GW2 API key')
  try {
    return ok((await new Gw2Client(apiKey).accountInfo()) as unknown as Gw2AccountInfo)
  } catch (e) {
    return fail((e as Error).message)
  }
}
