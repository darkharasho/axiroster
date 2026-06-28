// supabase/functions/axitools/handler.ts
// Pure proxy handler for the `axitools` edge function. Resolves the AxiTools key
// (validation mode = caller-supplied candidate key; stored mode = workspace's
// encrypted shared key), authorizes the caller, calls the AxiTools client, and
// maps the result to an HTTP { status, body }. No I/O — everything is injected.
import { parseAxitoolsKey } from '../_shared/axivaleKey.ts'
import type { AxitoolsClientLike } from '../_shared/axitools.ts'

export interface AxitoolsInput {
  userId: string
  op?: string
  key?: string
  workspaceId?: string
  guildId?: string
  includeMembers?: boolean
  action?: string
  params?: Record<string, unknown>
}

export interface AxitoolsDeps {
  decrypt: (enc: string, secret: string) => Promise<string>
  keySecret: string
  client: (baseUrl: string, token: string) => AxitoolsClientLike
  db: {
    role(ws: string, uid: string): Promise<string | null>
    getAxitoolsSecret(ws: string): Promise<string | null>
  }
}

type Result = { status: number; body: unknown }

const READ_OPS = new Set(['listGuilds', 'guildRoles', 'discordOverview', 'membersLinked'])
const WRITE_OPS = new Set(['discordAction'])
const WRITE_ROLES = new Set(['owner', 'write']) // mirrors can_write() in 0002_rls_policies.sql

const bad = (): Result => ({ status: 400, body: { error: 'bad_request' } })

export async function handleAxitools(deps: AxitoolsDeps, input: AxitoolsInput): Promise<Result> {
  const op = input.op
  if (!op || (!READ_OPS.has(op) && !WRITE_OPS.has(op))) return bad()
  if (op !== 'listGuilds' && !input.guildId) return bad()
  if (op === 'discordAction' && !input.action) return bad()

  // Resolve the key + authorize.
  let parsed: { baseUrl: string; token: string } | null
  if (input.key !== undefined) {
    // Validation mode: any signed-in user, but writes are stored-only.
    if (WRITE_OPS.has(op)) return bad()
    parsed = parseAxitoolsKey(input.key)
    if (!parsed) return bad()
  } else {
    // Stored mode: must be a member; discordAction needs a write-capable role.
    if (!input.workspaceId) return bad()
    const role = await deps.db.role(input.workspaceId, input.userId)
    if (!role) return { status: 403, body: { error: 'not_member' } }
    if (WRITE_OPS.has(op) && !WRITE_ROLES.has(role)) {
      return { status: 403, body: { error: 'not_authorized' } }
    }
    const enc = await deps.db.getAxitoolsSecret(input.workspaceId)
    if (!enc) return { status: 409, body: { error: 'no_key' } }
    parsed = parseAxitoolsKey(await deps.decrypt(enc, deps.keySecret))
    if (!parsed) return bad() // stored key corrupt
  }

  const client = deps.client(parsed.baseUrl, parsed.token)
  try {
    const data = await callOp(client, op, input)
    return { status: 200, body: { data } }
  } catch (e) {
    return { status: 502, body: { error: 'upstream_error', message: (e as Error).message } }
  }
}

function callOp(client: AxitoolsClientLike, op: string, input: AxitoolsInput): Promise<unknown> {
  switch (op) {
    case 'listGuilds':
      return client.listGuilds()
    case 'guildRoles':
      return client.guildRoles(input.guildId as string)
    case 'discordOverview':
      return client.discordOverview(input.guildId as string, !!input.includeMembers)
    case 'membersLinked':
      return client.membersLinked(input.guildId as string)
    case 'discordAction':
      return client.discordAction(input.guildId as string, input.action as string, input.params ?? {})
    default:
      throw new Error('unreachable')
  }
}
