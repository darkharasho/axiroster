import { test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createWebRealtime } from './realtime'
import { createWebSettings } from './settings'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size
    }
  } as Storage
}

// A fake channel records each .on() handler by table, and .subscribe(cb) fires cb
// with a controllable status (default SUBSCRIBED).
function makeChannel(name: string, order: string[]) {
  const handlers: Record<string, (p: unknown) => void> = {}
  const ch = {
    name,
    on(_type: string, opts: { table: string }, handler: (p: unknown) => void) {
      handlers[opts.table] = handler
      return ch
    },
    subscribe(cb?: (st: string) => void) {
      order.push('subscribe')
      ch._cb = cb
      cb?.('SUBSCRIBED')
      return ch
    },
    _cb: undefined as undefined | ((st: string) => void),
    fire(table: string) {
      handlers[table]?.({ eventType: 'INSERT', new: {} })
    }
  }
  return ch
}

function fakeSb(opts: { members?: { workspace_id: string; role: string }[] } = {}) {
  const order: string[] = []
  const channels: ReturnType<typeof makeChannel>[] = []
  let authCb: ((e: string, s: unknown) => void) | null = null
  const sb = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
      getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authCb = cb
        return { data: { subscription: { unsubscribe() {} } } }
      }
    },
    realtime: { setAuth: vi.fn(() => order.push('setAuth')) },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: opts.members ?? [{ workspace_id: 'w1', role: 'owner' }] }) }) }),
    channel: (name: string) => {
      const ch = makeChannel(name, order)
      channels.push(ch)
      return ch
    },
    removeChannel: vi.fn(async () => {})
  } as unknown as SupabaseClient
  const removeChannel = (sb as unknown as { removeChannel: ReturnType<typeof vi.fn> }).removeChannel
  return { sb, order, channels, fireAuth: (e: string, s: unknown) => authCb?.(e, s), removeChannel }
}

const settings = () => createWebSettings(fakeStorage())
const tick = () => new Promise((r) => setTimeout(r, 0))

test('onSync subscribes to the active workspace and fires on a roster change', async () => {
  const { sb, channels } = fakeSb()
  const rt = createWebRealtime(sb, settings())
  const hit = vi.fn()
  rt.onSync(hit)
  await tick()
  expect(channels).toHaveLength(1)
  expect(channels[0].name).toBe('axiroster-web:w1')
  channels[0].fire('roster_annotations')
  expect(hit).toHaveBeenCalledTimes(1)
})

test('routes meta + audit tables to the right callback sets', async () => {
  const { sb, channels } = fakeSb()
  const rt = createWebRealtime(sb, settings())
  const sync = vi.fn(), ws = vi.fn(), audit = vi.fn()
  rt.onSync(sync); rt.onWorkspace(ws); rt.onAudit(audit)
  await tick()
  channels[0].fire('workspace_members')
  channels[0].fire('audit_events')
  channels[0].fire('roster_links')
  expect(ws).toHaveBeenCalledTimes(1)
  expect(audit).toHaveBeenCalledTimes(1)
  expect(sync).toHaveBeenCalledTimes(1)
})

test('setAuth is called before subscribe', async () => {
  const { sb, order } = fakeSb()
  const rt = createWebRealtime(sb, settings())
  rt.onSync(() => {})
  await tick()
  expect(order.indexOf('setAuth')).toBeLessThan(order.indexOf('subscribe'))
})

test('status goes connecting → connected and onStatus receives it', async () => {
  const { sb } = fakeSb()
  const rt = createWebRealtime(sb, settings())
  const seen: string[] = []
  rt.onStatus((s) => seen.push(s))
  rt.onSync(() => {})
  await tick()
  expect(rt.status()).toBe('connected')
  expect(seen).toContain('connecting')
  expect(seen).toContain('connected')
})

test('resync after the active workspace changes tears down + re-subscribes', async () => {
  const { sb, channels, removeChannel } = fakeSb({ members: [{ workspace_id: 'w1', role: 'owner' }, { workspace_id: 'w2', role: 'write' }] })
  const s = settings()
  s.set('activeGuildId', 'w1')
  const rt = createWebRealtime(sb, s)
  rt.onSync(() => {})
  await tick()
  expect(channels[0].name).toBe('axiroster-web:w1')
  s.set('activeGuildId', 'w2')
  rt.resync()
  await tick()
  expect(removeChannel).toHaveBeenCalled()
  expect(channels[channels.length - 1].name).toBe('axiroster-web:w2')
})

test('no active workspace → no channel, status disabled', async () => {
  const { sb, channels } = fakeSb({ members: [] })
  const rt = createWebRealtime(sb, settings())
  rt.onSync(() => {})
  await tick()
  expect(channels).toHaveLength(0)
  expect(rt.status()).toBe('disabled')
})

test('SIGNED_OUT tears down and disables', async () => {
  const { sb, removeChannel, fireAuth } = fakeSb()
  const rt = createWebRealtime(sb, settings())
  rt.onSync(() => {})
  await tick()
  fireAuth('SIGNED_OUT', null)
  await tick()
  expect(removeChannel).toHaveBeenCalled()
  expect(rt.status()).toBe('disabled')
})

test('SIGNED_OUT while an ensure is in-flight still ends disabled (no status race)', async () => {
  const { sb, fireAuth } = fakeSb()
  const rt = createWebRealtime(sb, settings())
  rt.onSync(() => {}) // queues ensure (subscribes → would set connected)
  fireAuth('SIGNED_OUT', null) // queued before the ensure resolves
  await tick()
  await tick()
  expect(rt.status()).toBe('disabled')
})
