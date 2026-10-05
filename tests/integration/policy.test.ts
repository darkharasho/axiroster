import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
// These tests replace the live policy list and bump its version. Against a
// hosted project that would wipe the real list and make every later push from
// the axi-config Worker look stale, so they only ever run on a local stack.
const isLocal = ['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
if (!isLocal) console.warn(`policy.test.ts skipped: SUPABASE_URL (${new URL(url).host}) is not a local stack`)
const anon = process.env.SUPABASE_ANON_KEY!
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(url, service, { auth: { persistSession: false } })
const WS = '00000000-aaaa-bbbb-cccc-000000000020'
const READER_DISCORD = '123456789012345678'
const SERVER = '1100000000000000001'
const IDENT_DISCORD = '123456789012345679'
const VECTORS = JSON.parse(
  readFileSync(new URL('../../supabase/functions/_shared/policy.vectors.json', import.meta.url), 'utf8')
) as { valid: { kind: string; input: string; hash: string }[] }

const sha = (kind: string, normalized: string) =>
  createHash('sha256').update(`${kind}:${normalized}`, 'utf8').digest('hex')

describe.skipIf(!isLocal)('access policy (local stack only)', () => {
  // Pushes must outrank the stored version (restored in afterAll), so start above it.
  let version = Date.now()
  async function push(hashes: string[]) {
    version += 1
    const { data, error } = await admin.rpc('replace_policy_blocks', { p_hashes: hashes, p_version: version })
    expect(error).toBeNull()
    return data as boolean
  }
  async function blocks() {
    const { data, error } = await admin.from('policy_blocks').select('hash').order('hash')
    expect(error).toBeNull()
    return (data ?? []).map((r: { hash: string }) => r.hash)
  }

  async function userClient(email: string) {
    const c = createClient(url, anon, { auth: { persistSession: false } })
    await admin.auth.admin.createUser({ email, password: 'pw123456', email_confirm: true }).catch(() => {})
    await c.auth.signInWithPassword({ email, password: 'pw123456' })
    const { data } = await c.auth.getUser()
    return { c, uid: data.user!.id }
  }

  let owner: Awaited<ReturnType<typeof userClient>>
  let reader: Awaited<ReturnType<typeof userClient>>

  async function visibleWorkspaces(who: typeof owner) {
    const { data, error } = await who.c.from('workspaces').select('workspace_id').eq('workspace_id', WS)
    expect(error).toBeNull()
    return (data ?? []).length
  }

  // Whatever list the local stack held before this file ran is put back after it.
  let saved: { version: number; hashes: string[] }

  // auth.identities is not exposed through PostgREST; seed it with the CLI's
  // local SQL runner (this file only runs against a local stack).
  function localSql(sql: string) {
    execFileSync('npx', ['supabase', 'db', 'query', '--local', sql], { stdio: 'pipe' })
  }

  beforeAll(async () => {
    const state = await admin.from('policy_state').select('version').eq('id', true).single()
    expect(state.error).toBeNull()
    saved = { version: Number(state.data!.version), hashes: await blocks() }
    version = Math.max(version, saved.version)
    owner = await userClient('policy-owner@test.dev')
    reader = await userClient('policy-reader@test.dev')
    await admin.from('workspace_members').delete().eq('workspace_id', WS)
    await admin.from('workspaces').delete().eq('workspace_id', WS)
    await admin.from('workspaces').insert({ workspace_id: WS, guild_name: 'Policy', discord_guild_id: '' })
    await admin.from('workspace_members').insert([
      { workspace_id: WS, user_id: owner.uid, role: 'owner' },
      { workspace_id: WS, user_id: reader.uid, role: 'read', discord_id: READER_DISCORD }
    ])
    await push([])
  })

  afterAll(async () => {
    const del = await admin.from('policy_blocks').delete().neq('hash', '')
    expect(del.error).toBeNull()
    if (saved.hashes.length) {
      const ins = await admin.from('policy_blocks').insert(saved.hashes.map((hash) => ({ hash })))
      expect(ins.error).toBeNull()
    }
    const upd = await admin.from('policy_state').update({ version: saved.version }).eq('id', true)
    expect(upd.error).toBeNull()
  })

  test('policy_hash reproduces every shared vector', async () => {
    for (const v of VECTORS.valid) {
      const { data, error } = await admin.rpc('policy_hash', { kind: v.kind, value: v.input })
      expect(error).toBeNull()
      expect(data, `${v.kind} ${JSON.stringify(v.input)}`).toBe(v.hash)
    }
  })

  test('policy_hash is NULL for a NULL or blank value', async () => {
    expect((await admin.rpc('policy_hash', { kind: 'discord_user', value: null })).data).toBeNull()
    expect((await admin.rpc('policy_hash', { kind: 'discord_user', value: '  ' })).data).toBeNull()
    expect((await admin.rpc('policy_hash', { kind: 'discord_user', value: '\u00a0\t\u3000' })).data).toBeNull()
  })

  test('policy_hash trims the same characters as JS String.prototype.trim', async () => {
    const clean = sha('gw2_guild', WS)
    for (const value of [`\t${WS}\n`, `\u00a0\ufeff${WS}\u3000`, `\u2028\u1680${WS}\u2009\u202f\u205f\u2029\u000b\u000c\r`]) {
      expect(value.trim()).toBe(WS)
      const { data, error } = await admin.rpc('policy_hash', { kind: 'gw2_guild', value })
      expect(error).toBeNull()
      expect(data, JSON.stringify(value)).toBe(clean)
    }
    // Not JS whitespace, so not trimmed: zero-width space U+200B.
    const zw = await admin.rpc('policy_hash', { kind: 'gw2_guild', value: `\u200b${WS}` })
    expect(zw.data).not.toBe(clean)
  })

  test('replace_policy_blocks replaces the set and ignores stale versions', async () => {
    const a = sha('discord_user', '111111111111111111')
    const b = sha('discord_user', '222222222222222222')
    expect(await push([a, b, a, 'not-a-hash'])).toBe(true)
    expect(await blocks()).toEqual([a, b].sort())

    const stale = await admin.rpc('replace_policy_blocks', { p_hashes: [], p_version: version - 1 })
    expect(stale.error).toBeNull()
    expect(stale.data).toBe(false)
    expect(await blocks()).toEqual([a, b].sort())

    const same = await admin.rpc('replace_policy_blocks', { p_hashes: [a], p_version: version })
    expect(same.data).toBe(true)
    expect(await blocks()).toEqual([a])

    expect(await push([])).toBe(true)
    expect(await blocks()).toEqual([])
  })

  test('clients can neither push nor read the list', async () => {
    const r = await reader.c.rpc('replace_policy_blocks', { p_hashes: [], p_version: version + 1000 })
    expect(r.error).not.toBeNull()
    const sel = await reader.c.from('policy_blocks').select('hash')
    expect(sel.data ?? []).toHaveLength(0)
    const state = await reader.c.from('policy_state').select('version')
    expect(state.data ?? []).toHaveLength(0)
  })

  test('clients cannot probe the policy predicates', async () => {
    const anonClient = createClient(url, anon, { auth: { persistSession: false } })
    for (const who of [reader.c, anonClient]) {
      const a = await who.rpc('is_blocked', { hashes: [sha('discord_user', READER_DISCORD)] })
      expect(a.error?.code).toBe('42501')
      const b = await who.rpc('caller_blocked', { ws: WS })
      expect(b.error?.code).toBe('42501')
    }
  })

  test('dormant: an empty list leaves both members their access', async () => {
    await push([])
    expect(await visibleWorkspaces(owner)).toBe(1)
    expect(await visibleWorkspaces(reader)).toBe(1)
  })

  test('a revoked member loses read access; others keep theirs; unban restores it', async () => {
    await push([sha('discord_user', READER_DISCORD)])
    expect(await visibleWorkspaces(reader)).toBe(0)
    expect(await visibleWorkspaces(owner)).toBe(1)
    await push([])
    expect(await visibleWorkspaces(reader)).toBe(1)
  })

  test('a revoked GW2 guild hides its workspace from every member', async () => {
    await push([sha('gw2_guild', WS)])
    expect(await visibleWorkspaces(owner)).toBe(0)
    expect(await visibleWorkspaces(reader)).toBe(0)
    const write = await owner.c.from('roster_annotations').upsert({ workspace_id: WS, member_id: 'm1', notes: 'x' })
    expect(write.error).not.toBeNull()
    await push([])
    expect(await visibleWorkspaces(owner)).toBe(1)
  })

  test('a revoked Discord server hides the workspace linked to it', async () => {
    await admin.from('workspaces').update({ discord_guild_id: SERVER }).eq('workspace_id', WS)
    await push([sha('discord_server', SERVER)])
    expect(await visibleWorkspaces(owner)).toBe(0)
    await push([])
    await admin.from('workspaces').update({ discord_guild_id: '' }).eq('workspace_id', WS)
    expect(await visibleWorkspaces(owner)).toBe(1)
  })

  test('a revoked member can still leave the workspace', async () => {
    await push([sha('discord_user', READER_DISCORD)])
    const left = await reader.c.from('workspace_members').delete().eq('workspace_id', WS).eq('user_id', reader.uid)
    expect(left.error).toBeNull()
    const still = await admin.from('workspace_members').select('user_id').eq('workspace_id', WS).eq('user_id', reader.uid)
    expect(still.data ?? []).toHaveLength(0)
    await push([])
    await admin.from('workspace_members').upsert({ workspace_id: WS, user_id: reader.uid, role: 'read', discord_id: READER_DISCORD })
  })

  test('a workspace id stored uppercase and space-padded still matches its normalized guild hash', async () => {
    const PADDED = '  00000000-AAAA-BBBB-CCCC-000000000021 '
    const normalized = PADDED.trim().toLowerCase()
    await admin.from('workspace_members').delete().eq('workspace_id', PADDED)
    await admin.from('workspaces').delete().eq('workspace_id', PADDED)
    const ins = await admin.from('workspaces').insert({ workspace_id: PADDED, guild_name: 'Padded', discord_guild_id: '' })
    expect(ins.error).toBeNull()
    await admin.from('workspace_members').insert({ workspace_id: PADDED, user_id: reader.uid, role: 'read' })
    const visible = async () => {
      const { data, error } = await reader.c.from('workspaces').select('workspace_id').eq('workspace_id', PADDED)
      expect(error).toBeNull()
      return (data ?? []).length
    }
    try {
      await push([])
      expect(await visible()).toBe(1)
      await push([sha('gw2_guild', normalized)])
      expect(await visible()).toBe(0)
    } finally {
      await push([])
      await admin.from('workspace_members').delete().eq('workspace_id', PADDED)
      await admin.from('workspaces').delete().eq('workspace_id', PADDED)
    }
  })

  test('a revoked Discord id is found through auth.identities when the member row has none', async () => {
    const ident = await userClient('policy-identity@test.dev')
    await admin.from('workspace_members').delete().eq('workspace_id', WS).eq('user_id', ident.uid)
    localSql(`delete from auth.identities where provider = 'discord' and (provider_id = '${IDENT_DISCORD}' or user_id = '${ident.uid}')`)
    localSql(`insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
      values ('${IDENT_DISCORD}', '${ident.uid}',
              '{"sub":"${IDENT_DISCORD}","provider_id":"${IDENT_DISCORD}"}'::jsonb, 'discord', now(), now())`)
    const ins = await admin.from('workspace_members').insert({ workspace_id: WS, user_id: ident.uid, role: 'read', discord_id: null })
    expect(ins.error).toBeNull()
    try {
      await push([])
      expect(await visibleWorkspaces(ident)).toBe(1)
      await push([sha('discord_user', IDENT_DISCORD)])
      expect(await visibleWorkspaces(ident)).toBe(0)
      expect(await visibleWorkspaces(owner)).toBe(1)
    } finally {
      await push([])
      await admin.from('workspace_members').delete().eq('workspace_id', WS).eq('user_id', ident.uid)
      localSql(`delete from auth.identities where provider = 'discord' and user_id = '${ident.uid}'`)
    }
  })
})
