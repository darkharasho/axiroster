import { test, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(url, service, { auth: { persistSession: false } })

test('workspaces table accepts an insert', async () => {
  const id = '00000000-aaaa-bbbb-cccc-000000000001'
  await db.from('workspaces').delete().eq('workspace_id', id)
  const { error } = await db.from('workspaces').insert({ workspace_id: id, guild_name: 'T' })
  expect(error).toBeNull()
})
