import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Check, ShieldCheck, Swords, MessageSquare, Trash2, Loader2 } from 'lucide-react'
import { toast } from '../lib/toast'
import type {
  DiscordGuild,
  DiscordRole,
  GuildProfile,
  GuildProfileInput,
  GuildSummary,
  GuildRef
} from '../../../preload/index.d'
import { client } from '../lib/client'

// The per-guild Settings tab: a make-active / remove header over the connection
// editor. The "Add a guild" view reuses <GuildEditor initial={null}/> directly.
export default function GuildSettings({
  guild,
  onChanged,
  onRemoved
}: {
  guild: GuildSummary
  onChanged: () => void
  onRemoved: () => void
}): JSX.Element {
  const [profile, setProfile] = useState<GuildProfile | null>(null)

  const load = useCallback(async () => {
    setProfile(await client.getGuild(guild.id))
  }, [guild.id])
  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-8 py-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {!guild.active ? (
              <button
                onClick={async () => {
                  await client.setActiveGuild(guild.id)
                  onChanged()
                }}
                className="btn"
              >
                Make active
              </button>
            ) : (
              <span className="chip px-2 py-0.5 text-green-400">Active</span>
            )}
          </div>
          <button
            onClick={async () => {
              if (confirm(`Remove guild "${guild.name}"? Its keys and selections are deleted.`)) {
                await client.removeGuild(guild.id)
                onRemoved()
              }
            }}
            className="btn text-ink-faint hover:text-red-400"
            title="Remove guild"
          >
            <Trash2 size={14} /> Remove
          </button>
        </div>

        {profile ? (
          <GuildEditor
            initial={profile}
            embedded
            onDone={async () => {
              await load()
              onChanged()
            }}
            onCancel={() => void load()}
          />
        ) : (
          <div className="grid place-items-center py-16 text-ink-faint">
            <Loader2 size={20} className="animate-spin" />
          </div>
        )}
      </div>
    </div>
  )
}

// ---- the add/edit form (moved verbatim from the old SettingsView) -----------

export function GuildEditor({
  initial,
  onDone,
  onCancel,
  embedded = false
}: {
  initial: GuildProfile | null
  onDone: () => void
  onCancel: () => void
  /** Inside the Settings tab there's no separate "cancel"; the form is the page. */
  embedded?: boolean
}): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  // GW2
  const [gw2Key, setGw2Key] = useState(initial?.gw2ApiKey ?? '')
  const [gw2Guilds, setGw2Guilds] = useState<GuildRef[]>([])
  const [gw2GuildId, setGw2GuildId] = useState(initial?.gw2GuildId ?? '')
  const [gw2GuildName, setGw2GuildName] = useState(initial?.gw2GuildName ?? '')
  const [gw2Account, setGw2Account] = useState(initial?.gw2AccountName ?? '')
  const [gw2Busy, setGw2Busy] = useState(false)
  const [gw2Msg, setGw2Msg] = useState<string | null>(null)
  // AxiTools / Discord
  const [axiKey, setAxiKey] = useState(initial?.axitoolsKey ?? '')
  const [servers, setServers] = useState<DiscordGuild[]>([])
  const [discordGuildId, setDiscordGuildId] = useState(initial?.discordGuildId ?? '')
  const [discordGuildName, setDiscordGuildName] = useState(initial?.discordGuildName ?? '')
  const [roles, setRoles] = useState<DiscordRole[]>([])
  const [memberRoleId, setMemberRoleId] = useState(initial?.memberRoleId ?? '')
  const [axiBusy, setAxiBusy] = useState(false)
  const [axiMsg, setAxiMsg] = useState<string | null>(null)
  // Bridge
  const [reposText, setReposText] = useState(
    (initial?.bridgeRepos ?? []).map((r) => `${r.owner}/${r.repo}`).join('\n')
  )
  // Retention radar
  const [retentionEnabled, setRetentionEnabled] = useState(initial?.retentionEnabled ?? false)
  // Recruitment pipeline
  const [pipelineEnabled, setPipelineEnabled] = useState(initial?.pipelineEnabled !== false)
  // Shared guilds: the GW2 key + guild come from the workspace owner and are
  // always read-only here. The AxiTools key is read-only too only if the owner
  // shares it; otherwise the member fills in their own.
  const sharedGw2 = Boolean(initial?.shared)
  const sharedAxi = Boolean(initial?.axitoolsShared)
  // On a shared guild, only write+ members may edit the shared config (member
  // role + bridge repos); read members see it read-only.
  const [canEditConfig, setCanEditConfig] = useState(!initial?.shared)
  useEffect(() => {
    if (!initial?.shared) return
    void client
      .authStatus()
      .then((s) => setCanEditConfig(s.role === 'owner' || s.role === 'write'))
  }, [])

  // Re-validate stored keys on open so the dropdowns are populated for editing.
  useEffect(() => {
    if (initial?.gw2ApiKey) validateGw2(initial.gw2ApiKey)
    if (initial?.axitoolsKey) validateAxi(initial.axitoolsKey, initial.discordGuildId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const validateGw2 = async (key: string): Promise<void> => {
    setGw2Busy(true)
    setGw2Msg(null)
    const res = await client.gw2AccountInfo(key)
    setGw2Busy(false)
    if (!res.ok) return setGw2Msg(res.error)
    setGw2Guilds(res.data.guilds)
    setGw2Account(res.data.accountName)
    if (res.data.missingPermissions.length)
      setGw2Msg(`Key valid, but missing: ${res.data.missingPermissions.join(', ')}`)
  }

  const validateAxi = async (key: string, preselectDiscord?: string): Promise<void> => {
    setAxiBusy(true)
    setAxiMsg(null)
    const res = await client.axitoolsListGuilds(key)
    setAxiBusy(false)
    if (!res.ok) return setAxiMsg(res.error)
    setServers(res.data)
    if (preselectDiscord) loadRoles(preselectDiscord, key)
  }

  const loadRoles = async (discordId: string, key: string): Promise<void> => {
    const res = await client.discordOverview(discordId, false, key)
    if (res.ok) {
      const ov = res.data as { roles?: DiscordRole[] }
      setRoles((ov.roles ?? []).filter((r) => r.name !== '@everyone'))
    }
  }

  const pickGw2Guild = (id: string): void => {
    markEdited()
    const g = gw2Guilds.find((x) => x.id === id)
    setGw2GuildId(id)
    setGw2GuildName(g ? `[${g.tag}] ${g.name}` : '')
    if (!name && g) setName(g.name)
  }

  const pickServer = async (id: string): Promise<void> => {
    markEdited()
    const s = servers.find((x) => x.id === id)
    setDiscordGuildId(id)
    setDiscordGuildName(s?.name ?? '')
    setMemberRoleId('')
    loadRoles(id, axiKey)
    // 1:1 tie: if AxiTools binds this server to a GW2 guild, auto-select it.
    const bound = await client.boundGw2Guilds(id, axiKey)
    if (bound.ok && bound.data.length && gw2Guilds.some((g) => g.id === bound.data[0])) {
      pickGw2Guild(bound.data[0])
    }
  }

  const canSave = Boolean(gw2Key && gw2GuildId) || Boolean(axiKey && discordGuildId)

  // Track whether the user has actually edited anything. The on-mount key
  // re-validation sets derived state (account/servers/roles) — we must not treat
  // that as a user edit and autosave over it.
  const touched = useRef(false)
  const markEdited = (): void => {
    touched.current = true
  }
  const [autoSaving, setAutoSaving] = useState(false)

  const buildInput = (): GuildProfileInput => {
    const bridgeRepos = reposText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [owner, repo] = l.split('/')
        return owner && repo ? { owner, repo } : null
      })
      .filter((r): r is { owner: string; repo: string } => r !== null)

    return {
      id: initial?.id,
      name: name.trim() || gw2GuildName || discordGuildName,
      gw2ApiKey: gw2Key.trim(),
      gw2GuildId,
      gw2GuildName,
      gw2AccountName: gw2Account,
      axitoolsKey: axiKey.trim(),
      discordGuildId,
      discordGuildName,
      memberRoleId,
      bridgeRepos,
      shared: initial?.shared ?? false,
      axitoolsShared: initial?.axitoolsShared ?? false,
      retentionEnabled,
      pipelineEnabled
    }
  }

  // Explicit create (the add-a-guild flow). Editing an existing guild autosaves.
  const save = async (): Promise<void> => {
    await client.upsertGuild(buildInput())
    toast('Guild added')
    onDone()
  }

  // Autosave for the per-guild Settings tab: persist on edit, debounced, with a
  // toast. Only fires once the user has actually touched a field.
  const editSignature = JSON.stringify({
    name,
    gw2Key,
    gw2GuildId,
    gw2GuildName,
    gw2Account,
    axiKey,
    discordGuildId,
    discordGuildName,
    memberRoleId,
    reposText,
    retentionEnabled,
    pipelineEnabled
  })
  useEffect(() => {
    if (!embedded || !touched.current || !canSave) return
    const t = setTimeout(async () => {
      setAutoSaving(true)
      await client.upsertGuild(buildInput())
      setAutoSaving(false)
      toast('Settings saved')
      onDone()
    }, 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSignature])

  return (
    <section className="space-y-5 rounded-lg border border-panel-line bg-panel-raised/40 p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} className="text-accent" />
        <h2 className="text-sm font-semibold text-white">
          {initial ? 'Connection' : 'Add a guild'}
        </h2>
      </div>

      <Labeled label="Guild name">
        <input
          value={name}
          onChange={(e) => {
            markEdited()
            setName(e.target.value)
          }}
          placeholder="Defaults to the GW2 guild name"
          className="field"
        />
      </Labeled>

      {/* GW2 */}
      <div className="space-y-2 rounded-md border border-panel-line bg-panel p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <Swords size={14} className="text-ink-dim" /> Guild Wars 2
        </div>
        {sharedGw2 ? (
          <div className="space-y-1">
            <div className="rounded-md border border-panel-line bg-panel-sunk px-3 py-2 text-sm text-ink">
              {gw2GuildName || 'Shared GW2 guild'}
            </div>
            <div className="text-xs text-ink-faint">
              GW2 key &amp; guild are shared by the workspace owner (read-only). You just add your
              own AxiTools key below.
            </div>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                value={gw2Key}
                onChange={(e) => {
                  markEdited()
                  setGw2Key(e.target.value)
                }}
                placeholder="GW2 API key (account + guilds)"
                className="field flex-1 font-mono text-xs"
              />
              <button onClick={() => validateGw2(gw2Key)} disabled={!gw2Key || gw2Busy} className="btn">
                <RefreshCw size={14} className={gw2Busy ? 'animate-spin' : ''} /> Validate
              </button>
            </div>
            {gw2Guilds.length > 0 && (
              <select value={gw2GuildId} onChange={(e) => pickGw2Guild(e.target.value)} className="field">
                <option value="">Select GW2 guild…</option>
                {gw2Guilds.map((g) => (
                  <option key={g.id} value={g.id}>
                    [{g.tag}] {g.name}
                    {g.leader ? ' (leader)' : ''}
                  </option>
                ))}
              </select>
            )}
            {gw2Account && <div className="text-xs text-ink-faint">Account: {gw2Account}</div>}
            {gw2Msg && <div className="text-xs text-amber-300">{gw2Msg}</div>}
          </>
        )}
      </div>

      {/* Discord */}
      <div className="space-y-2 rounded-md border border-panel-line bg-panel p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <MessageSquare size={14} className="text-ink-dim" /> Discord (AxiTools)
        </div>
        {sharedAxi ? (
          <div className="text-xs text-ink-faint">
            AxiTools key is shared by the workspace owner (read-only).
          </div>
        ) : (
          <>
            {sharedGw2 && (
              <div className="text-xs text-ink-faint">Add your own AxiTools key for Discord features.</div>
            )}
            <div className="flex gap-2">
              <input
                value={axiKey}
                onChange={(e) => {
                  markEdited()
                  setAxiKey(e.target.value)
                }}
                placeholder="AxiTools key (axt1.…)"
                className="field flex-1 font-mono text-xs"
              />
              <button onClick={() => validateAxi(axiKey)} disabled={!axiKey || axiBusy} className="btn">
                <RefreshCw size={14} className={axiBusy ? 'animate-spin' : ''} /> Validate
              </button>
            </div>
          </>
        )}
        {servers.length > 0 && (
          <select
            value={discordGuildId}
            onChange={(e) => pickServer(e.target.value)}
            className="field"
          >
            <option value="">Select Discord server…</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {roles.length > 0 && (
          <div>
            <div className="mb-1 text-xs text-ink-dim">
              Guild-member role (anchors the roster)
            </div>
            <select
              value={memberRoleId}
              onChange={(e) => {
                markEdited()
                setMemberRoleId(e.target.value)
              }}
              disabled={!canEditConfig}
              className="field disabled:opacity-60"
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
        {axiMsg && <div className="text-xs text-amber-300">{axiMsg}</div>}
      </div>

      {/* Bridge */}
      <Labeled label="AxiBridge report repos (owner/repo per line)">
        <textarea
          value={reposText}
          onChange={(e) => {
            markEdited()
            setReposText(e.target.value)
          }}
          disabled={!canEditConfig}
          placeholder="myguild/wvw-reports"
          rows={2}
          className="field resize-y font-mono text-xs disabled:opacity-60"
        />
        {sharedGw2 && !canEditConfig && (
          <div className="mt-1 text-xs text-ink-faint">
            Shared config is read-only — only write members can edit it.
          </div>
        )}
      </Labeled>

      {/* Retention radar */}
      <label className="flex items-center gap-2 text-sm text-ink-dim">
        <input
          type="checkbox"
          checked={retentionEnabled}
          onChange={(e) => {
            markEdited()
            setRetentionEnabled(e.target.checked)
          }}
          disabled={!canEditConfig}
          className="accent-accent disabled:opacity-60"
        />
        Enable Retention radar (uses WvW attendance history)
      </label>

      {/* Recruitment pipeline */}
      <label className="flex items-center gap-2 text-sm text-ink-dim">
        <input
          type="checkbox"
          checked={pipelineEnabled}
          onChange={(e) => {
            markEdited()
            setPipelineEnabled(e.target.checked)
          }}
          disabled={!canEditConfig}
          className="accent-accent disabled:opacity-60"
        />
        Enable Recruitment pipeline
      </label>

      {embedded ? (
        <div className="flex items-center gap-1.5 text-xs text-ink-faint">
          {autoSaving ? (
            <>
              <Loader2 size={13} className="animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Check size={13} className="text-emerald-400" /> Changes save automatically
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={!canSave} className="btn btn-accent">
            <Check size={15} /> Create guild
          </button>
          <button onClick={onCancel} className="btn">
            Cancel
          </button>
        </div>
      )}
    </section>
  )
}

export function Labeled({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</div>
      {children}
    </div>
  )
}
