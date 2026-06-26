import { test, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const anon = process.env.SUPABASE_ANON_KEY!
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(url, service, { auth: { persistSession: false } })
const WS = '00000000-aaaa-bbbb-cccc-000000000010'

async function userClient(email: string) {
  const c = createClient(url, anon, { auth: { persistSession: false } })
  await admin.auth.admin.createUser({ email, password: 'pw123456', email_confirm: true })
    .catch(() => {})
  await c.auth.signInWithPassword({ email, password: 'pw123456' })
  const { data } = await c.auth.getUser()
  return { c, uid: data.user!.id }
}

let owner: Awaited<ReturnType<typeof userClient>>
let reader: Awaited<ReturnType<typeof userClient>>

beforeAll(async () => {
  owner = await userClient('owner@test.dev')
  reader = await userClient('reader@test.dev')
  await admin.from('roster_annotations').delete().eq('workspace_id', WS)
  await admin.from('workspace_members').delete().eq('workspace_id', WS)
  await admin.from('workspaces').delete().eq('workspace_id', WS)
  await admin.from('workspaces').insert({ workspace_id: WS, guild_name: 'RLS' })
  await admin.from('workspace_members').insert([
    { workspace_id: WS, user_id: owner.uid, role: 'owner' },
    { workspace_id: WS, user_id: reader.uid, role: 'read' }
  ])
})

test('reader can select but not write annotations', async () => {
  const sel = await reader.c.from('roster_annotations').select('*').eq('workspace_id', WS)
  expect(sel.error).toBeNull()
  const ins = await reader.c.from('roster_annotations')
    .insert({ workspace_id: WS, member_id: 'm1', notes: 'x' })
  expect(ins.error).not.toBeNull() // RLS denies
})

test('owner can write annotations', async () => {
  const ins = await owner.c.from('roster_annotations')
    .upsert({ workspace_id: WS, member_id: 'm2', notes: 'ok' })
  expect(ins.error).toBeNull()
})

test('no client can read workspace_secrets', async () => {
  const r = await owner.c.from('workspace_secrets').select('*').eq('workspace_id', WS)
  expect(r.data ?? []).toHaveLength(0)
})

test('non-owner cannot add members', async () => {
  const r = await reader.c.from('workspace_members')
    .insert({ workspace_id: WS, user_id: reader.uid, role: 'write' })
  expect(r.error).not.toBeNull()
})
