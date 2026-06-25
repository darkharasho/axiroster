import { useCallback, useEffect, useState } from 'react'
import { Check, Trash2, RefreshCw } from 'lucide-react'
import type { DiscordGuild, DiscordRole, GuildRef, KeyLabel } from '../../../preload/index.d'

export default function SettingsView(): JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 px-8 py-8">
        <header>
          <h1 className="text-lg font-semibold text-white">Settings</h1>
          <p className="text-sm text-ink-dim">
            Connect Guild Wars 2, your AxiTools Discord bot, AxiBridge reports, and the shared
            sync workspace.
          </p>
        </header>
        <Gw2Section />
        <DiscordSection />
        <BridgeSection />
        <SyncSection />
      </div>
    </div>
  )
}

function Card({
  title,
  desc,
  children
}: {
  title: string
  desc?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="rounded-lg border border-panel-line bg-panel-raised/40 p-5">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {desc && <p className="mt-0.5 text-xs text-ink-dim">{desc}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  )
}

// ---- GW2 -------------------------------------------------------------------

function Gw2Section(): JSX.Element {
  const [keys, setKeys] = useState<KeyLabel[]>([])
  const [label, setLabel] = useState('')
  const [key, setKey] = useState('')
  const [guilds, setGuilds] = useState<GuildRef[]>([])
  const [guildId, setGuildId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setKeys(await window.axiroster.listKeys('gw2'))
    setGuildId((await window.axiroster.getSetting('gw2GuildId')) ?? '')
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])

  const addKey = async (): Promise<void> => {
    if (!key.trim()) return
    await window.axiroster.addKey('gw2', label.trim() || 'default', key.trim())
    setKey('')
    setLabel('')
    await refresh()
    loadGuilds()
  }

  const loadGuilds = async (): Promise<void> => {
    setBusy(true)
    setMsg(null)
    const res = await window.axiroster.gw2AccountInfo()
    setBusy(false)
    if (!res.ok) return setMsg(res.error)
    setGuilds(res.data.guilds)
    if (res.data.missingPermissions.length)
      setMsg(`Key missing permissions: ${res.data.missingPermissions.join(', ')}`)
    await window.axiroster.setSetting('gw2AccountName', res.data.accountName)
  }

  const pickGuild = async (g: GuildRef): Promise<void> => {
    setGuildId(g.id)
    await window.axiroster.setSetting('gw2GuildId', g.id)
    await window.axiroster.setSetting('gw2GuildName', g.name)
  }

  return (
    <Card title="Guild Wars 2" desc="API key with 'account' + 'guilds' permissions.">
      <KeyRing service="gw2" keys={keys} onChange={refresh} />
      <div className="flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="label"
          className="field w-28"
        />
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="GW2 API key"
          className="field flex-1 font-mono text-xs"
        />
        <button onClick={addKey} className="btn btn-accent">
          Add
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={loadGuilds} className="btn" disabled={busy}>
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Load guilds
        </button>
        {msg && <span className="text-xs text-amber-300">{msg}</span>}
      </div>

      {guilds.length > 0 && (
        <select
          value={guildId}
          onChange={(e) => {
            const g = guilds.find((x) => x.id === e.target.value)
            if (g) pickGuild(g)
          }}
          className="field"
        >
          <option value="">Select a guild…</option>
          {guilds.map((g) => (
            <option key={g.id} value={g.id}>
              [{g.tag}] {g.name}
              {g.leader ? ' (leader)' : ''}
            </option>
          ))}
        </select>
      )}
    </Card>
  )
}

// ---- Discord / AxiTools ----------------------------------------------------

function DiscordSection(): JSX.Element {
  const [keys, setKeys] = useState<KeyLabel[]>([])
  const [label, setLabel] = useState('')
  const [key, setKey] = useState('')
  const [guilds, setGuilds] = useState<DiscordGuild[]>([])
  const [guildId, setGuildId] = useState('')
  const [roles, setRoles] = useState<DiscordRole[]>([])
  const [memberRoleId, setMemberRoleId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setKeys(await window.axiroster.listKeys('axitools'))
    const gid = (await window.axiroster.getSetting('discordGuildId')) ?? ''
    setGuildId(gid)
    setMemberRoleId(await readMemberRole(gid))
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])

  // Auto-load the role catalog whenever a server is selected (needed for the
  // member-role picker below and to label roles in the roster detail).
  useEffect(() => {
    if (guildId) loadRoles(guildId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId])

  const loadRoles = async (gid: string): Promise<void> => {
    if (!gid) return
    const res = await window.axiroster.discordOverview(gid, false)
    if (res.ok) {
      const ov = res.data as { roles?: DiscordRole[] }
      setRoles((ov.roles ?? []).filter((r) => r.name !== '@everyone'))
    }
  }

  const addKey = async (): Promise<void> => {
    if (!key.trim()) return
    await window.axiroster.addKey('axitools', label.trim() || 'default', key.trim())
    setKey('')
    setLabel('')
    await refresh()
    loadGuilds()
  }

  const loadGuilds = async (): Promise<void> => {
    setBusy(true)
    setMsg(null)
    const res = await window.axiroster.axitoolsListGuilds()
    setBusy(false)
    if (!res.ok) return setMsg(res.error)
    setGuilds(res.data)
  }

  const pickGuild = async (g: DiscordGuild): Promise<void> => {
    setGuildId(g.id)
    await window.axiroster.setSetting('discordGuildId', g.id)
    await window.axiroster.setSetting('discordGuildName', g.name)
    setMemberRoleId(await readMemberRole(g.id))
    loadRoles(g.id)
  }

  const pickMemberRole = async (roleId: string): Promise<void> => {
    setMemberRoleId(roleId)
    await writeMemberRole(guildId, roleId)
  }

  return (
    <Card
      title="Discord (via AxiTools)"
      desc="Paste your guild's AxiTools key (axt1.…) from /config apikey generate."
    >
      <KeyRing service="axitools" keys={keys} onChange={refresh} />
      <div className="flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="label"
          className="field w-28"
        />
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="axt1.…"
          className="field flex-1 font-mono text-xs"
        />
        <button onClick={addKey} className="btn btn-accent">
          Add
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={loadGuilds} className="btn" disabled={busy}>
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Load servers
        </button>
        {msg && <span className="text-xs text-amber-300">{msg}</span>}
      </div>

      {guilds.length > 0 && (
        <select
          value={guildId}
          onChange={(e) => {
            const g = guilds.find((x) => x.id === e.target.value)
            if (g) pickGuild(g)
          }}
          className="field"
        >
          <option value="">Select a Discord server…</option>
          {guilds.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}

      {guildId && (
        <div>
          <div className="mb-1 text-xs text-ink-dim">
            Guild-member role — anchors the roster (members with this role are
            included even without a linked GW2 key).
          </div>
          <select
            value={memberRoleId}
            onChange={(e) => pickMemberRole(e.target.value)}
            className="field"
          >
            <option value="">No member role (show all)</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </Card>
  )
}

/** Read/write the per-guild member-role map stored in discordMemberRoleByGuild. */
async function readMemberRole(guildId: string): Promise<string> {
  if (!guildId) return ''
  const raw = await window.axiroster.getSetting('discordMemberRoleByGuild')
  if (!raw) return ''
  try {
    return (JSON.parse(raw) as Record<string, string>)[guildId] ?? ''
  } catch {
    return ''
  }
}

async function writeMemberRole(guildId: string, roleId: string): Promise<void> {
  if (!guildId) return
  const raw = await window.axiroster.getSetting('discordMemberRoleByGuild')
  let map: Record<string, string> = {}
  if (raw) {
    try {
      map = JSON.parse(raw) as Record<string, string>
    } catch {
      map = {}
    }
  }
  if (roleId) map[guildId] = roleId
  else delete map[guildId]
  await window.axiroster.setSetting('discordMemberRoleByGuild', JSON.stringify(map))
}

// ---- AxiBridge -------------------------------------------------------------

function BridgeSection(): JSX.Element {
  const [repos, setRepos] = useState('')

  useEffect(() => {
    window.axiroster.getSetting('axibridgeRepos').then((v) => {
      if (!v) return
      try {
        const parsed = JSON.parse(v) as { owner: string; repo: string }[]
        setRepos(parsed.map((r) => `${r.owner}/${r.repo}`).join('\n'))
      } catch {
        /* ignore */
      }
    })
  }, [])

  const save = async (): Promise<void> => {
    const parsed = repos
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [owner, repo] = l.split('/')
        return owner && repo ? { owner, repo } : null
      })
      .filter(Boolean)
    await window.axiroster.setSetting('axibridgeRepos', JSON.stringify(parsed))
  }

  return (
    <Card
      title="AxiBridge reports"
      desc="GitHub repos where your guild publishes WvW combat reports — one owner/repo per line."
    >
      <textarea
        value={repos}
        onChange={(e) => setRepos(e.target.value)}
        onBlur={save}
        placeholder="myguild/wvw-reports"
        rows={3}
        className="field resize-y font-mono text-xs"
      />
    </Card>
  )
}

// ---- Sync ------------------------------------------------------------------

function SyncSection(): JSX.Element {
  const [enabled, setEnabled] = useState(false)
  const [url, setUrl] = useState('')
  const [anonKey, setAnonKey] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [status, setStatus] = useState('disabled')

  useEffect(() => {
    ;(async () => {
      setEnabled((await window.axiroster.getSetting('syncEnabled')) === 'true')
      setUrl((await window.axiroster.getSetting('syncUrl')) ?? '')
      setAnonKey((await window.axiroster.getSetting('syncAnonKey')) ?? '')
      setWorkspaceId((await window.axiroster.getSetting('syncWorkspaceId')) ?? '')
      setStatus(await window.axiroster.syncStatus())
    })()
  }, [])

  const apply = async (): Promise<void> => {
    await window.axiroster.setSetting('syncEnabled', String(enabled))
    await window.axiroster.setSetting('syncUrl', url.trim())
    await window.axiroster.setSetting('syncAnonKey', anonKey.trim())
    await window.axiroster.setSetting('syncWorkspaceId', workspaceId.trim())
    setStatus(await window.axiroster.reinitSync())
  }

  return (
    <Card
      title="Shared sync (Supabase)"
      desc="Leadership share one workspace — tags, notes & links sync live across officers."
    >
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="accent-accent"
        />
        Enable shared sync
      </label>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://xxxx.supabase.co"
        className="field font-mono text-xs"
      />
      <input
        value={anonKey}
        onChange={(e) => setAnonKey(e.target.value)}
        placeholder="anon public key"
        className="field font-mono text-xs"
      />
      <input
        value={workspaceId}
        onChange={(e) => setWorkspaceId(e.target.value)}
        placeholder="workspace id (shared guild key)"
        className="field font-mono text-xs"
      />
      <div className="flex items-center gap-2">
        <button onClick={apply} className="btn btn-accent">
          Apply
        </button>
        <span className="text-xs text-ink-dim">Status: {status}</span>
      </div>
    </Card>
  )
}

// ---- shared keyring widget -------------------------------------------------

function KeyRing({
  service,
  keys,
  onChange
}: {
  service: 'gw2' | 'axitools'
  keys: KeyLabel[]
  onChange: () => void
}): JSX.Element {
  if (keys.length === 0) return <div className="text-xs text-ink-faint">No keys yet.</div>
  return (
    <div className="space-y-1">
      {keys.map((k) => (
        <div
          key={k.label}
          className="flex items-center gap-2 rounded-md border border-panel-line bg-panel px-3 py-1.5 text-sm"
        >
          <button
            onClick={async () => {
              await window.axiroster.setActiveKey(service, k.label)
              onChange()
            }}
            className={`led ${k.active ? '' : 'opacity-30'}`}
            style={{ background: k.active ? '#22c55e' : '#78716c' }}
            title={k.active ? 'Active' : 'Set active'}
          />
          <span className="flex-1 text-ink">{k.label}</span>
          {k.active && <Check size={14} className="text-green-400" />}
          {k.meta?.name && <span className="text-xs text-ink-faint">{k.meta.name}</span>}
          <button
            onClick={async () => {
              await window.axiroster.removeKey(service, k.label)
              onChange()
            }}
            className="text-ink-faint hover:text-red-400"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
