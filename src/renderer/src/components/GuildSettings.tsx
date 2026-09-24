import { useCallback, useEffect, useRef, useState } from 'react'
import Picker from './Picker'
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
import { isWeb } from '../lib/runtime'
import { useMountTransition } from '../lib/useMountTransition'

export function guildRemoveAction(
  role: string | undefined,
  web: boolean,
  guildName: string
): { label: string; title: string; confirmText: string; danger?: boolean; requireName?: boolean } | null {
  if (!web) {
    return {
      label: 'Remove',
      title: 'Remove guild',
      confirmText: `Remove guild "${guildName}"? Its keys and selections are deleted.`
    }
  }
  if (role === 'owner') {
    return {
      label: 'Delete',
      title: 'Delete guild',
      confirmText: `Permanently delete "${guildName}" and ALL its data (roster, notes, members, invites, audit log) for every member? This cannot be undone.`,
      danger: true,
      requireName: true
    }
  }
  return {
    label: 'Leave',
    title: 'Leave guild',
    confirmText: `Leave guild "${guildName}"? You'll lose access to its roster.`
  }
}

export function saveOutcome(result: GuildSummary | null): {
  ok: boolean
  message: string
  variant: 'success' | 'error'
} {
  return result
    ? { ok: true, message: 'Guild added', variant: 'success' }
    : {
        ok: false,
        message: "Couldn't add guild — check you're a GW2 guild leader and the keys are valid.",
        variant: 'error'
      }
}

// The per-guild Settings tab: a make-active / remove header over the connection
// editor. The "Add a guild" view reuses <GuildEditor initial={null}/> directly.
export default function GuildSettings({
  guild,
  role,
  onChanged,
  onRemoved
}: {
  guild: GuildSummary
  role?: string
  onChanged: () => void
  onRemoved: () => void
}): JSX.Element {
  const [profile, setProfile] = useState<GuildProfile | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Stay mounted through the fade-out.
  const confirmT = useMountTransition(confirmingDelete)
  const [confirmName, setConfirmName] = useState('')

  const load = useCallback(async () => {
    setProfile(await client.getGuild(guild.id))
  }, [guild.id])
  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="ar-pane__body">
      <div className="axi-page axi-page--narrow flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {!guild.active ? (
              <button
                onClick={async () => {
                  await client.setActiveGuild(guild.id)
                  onChanged()
                }}
                className="axi-btn"
              >
                Make active
              </button>
            ) : (
              <span className="axi-chip axi-chip--ok">Active</span>
            )}
          </div>
          {(() => {
            const action = guildRemoveAction(role, isWeb(), guild.name)
            if (!action) return null
            if (action.requireName) {
              return (
                <button
                  onClick={() => {
                    setConfirmName('')
                    setConfirmingDelete(true)
                  }}
                  className="axi-btn ar-btn--danger"
                  title={action.title}
                >
                  <Trash2 size={14} /> {action.label}
                </button>
              )
            }
            return (
              <button
                onClick={async () => {
                  if (confirm(action.confirmText)) {
                    await client.removeGuild(guild.id)
                    onRemoved()
                  }
                }}
                className="axi-btn ar-btn--danger"
                title={action.title}
              >
                <Trash2 size={14} /> {action.label}
              </button>
            )
          })()}
        </div>

        {confirmT.mounted && (
          <div
            className={`axi-scrim grid place-items-center p-4 transition-opacity duration-150 ease-out ${
              confirmT.shown ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {/* An irreversible action, so the danger ink is asserted as a solid
                cap across the head of the sheet rather than a tinted border. */}
            <div
              className={`ar-modal__sheet ar-sheet--danger max-w-md transition duration-150 ease-out ${
                confirmT.shown ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <div className="ar-modal__head">
                <Trash2 className="ar-ink-danger" size={15} />
                <h3 className="ar-title">Delete “{guild.name}”</h3>
              </div>
              <div className="ar-modal__body flex flex-col gap-3">
                <p className="ar-note">
                  Permanently delete <span className="ar-ink">{guild.name}</span>{' '}
                  and ALL its data (roster, notes, members, invites, audit log) for every member.
                  This cannot be undone.
                </p>
                <label className="ar-label">
                  Type <span className="ar-mono">{guild.name}</span> to confirm
                </label>
                <input
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  className="axi-input"
                />
              </div>
              <div className="ar-modal__foot">
                <button onClick={() => setConfirmingDelete(false)} className="axi-btn">
                  Cancel
                </button>
                <button
                  disabled={confirmName !== guild.name}
                  onClick={async () => {
                    setConfirmingDelete(false)
                    await client.removeGuild(guild.id)
                    onRemoved()
                  }}
                  className="axi-btn ar-btn--danger"
                >
                  Delete guild
                </button>
              </div>
            </div>
          </div>
        )}

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
          <div className="ar-note--faint grid place-items-center py-16">
            <Loader2 size={20} className="ar-work" />
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
    const result = await client.upsertGuild(buildInput())
    const outcome = saveOutcome(result)
    toast(outcome.message, outcome.variant)
    if (outcome.ok) onDone()
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
    <section className="axi-panel flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <ShieldCheck className="ar-ink-accent" size={18} />
        <h2 className="ar-title">{initial ? 'Connection' : 'Add a guild'}</h2>
      </div>

      <Labeled label="Guild name">
        <input
          value={name}
          onChange={(e) => {
            markEdited()
            setName(e.target.value)
          }}
          placeholder="Defaults to the GW2 guild name"
          className="axi-input"
        />
      </Labeled>

      {/* GW2 */}
      <div className="ar-section flex flex-col gap-3">
        <div className="ar-section__title flex items-center gap-2">
          <Swords size={14} /> Guild Wars 2
        </div>
        {sharedGw2 ? (
          <div className="flex flex-col gap-2">
            <div className="ar-tile">{gw2GuildName || 'Shared GW2 guild'}</div>
            <div className="ar-note--faint">
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
                className="axi-input ar-mono flex-1"
              />
              <button onClick={() => validateGw2(gw2Key)} disabled={!gw2Key || gw2Busy} className="axi-btn">
                <RefreshCw size={14} className={gw2Busy ? 'ar-work' : ''} /> Validate
              </button>
            </div>
            {gw2Guilds.length > 0 && (
              <Picker
                value={gw2GuildId}
                onChange={pickGw2Guild}
                className="w-full"
                options={[
                  { value: '', label: 'Select GW2 guild…' },
                  ...gw2Guilds.map((g) => ({
                    value: g.id,
                    label: `[${g.tag}] ${g.name}${g.leader ? ' (leader)' : ''}`
                  }))
                ]}
              />
            )}
            {gw2Account && <div className="ar-note--faint">Account: {gw2Account}</div>}
            {gw2Msg && <div className="axi-chip axi-chip--warn self-start">{gw2Msg}</div>}
          </>
        )}
      </div>

      {/* Discord */}
      <div className="ar-section flex flex-col gap-3">
        <div className="ar-section__title flex items-center gap-2">
          <MessageSquare size={14} /> Discord (AxiTools)
        </div>
        {sharedAxi ? (
          <div className="ar-note--faint">
            AxiTools key is shared by the workspace owner (read-only).
          </div>
        ) : (
          <>
            {sharedGw2 && (
              <div className="ar-note--faint">Add your own AxiTools key for Discord features.</div>
            )}
            <div className="flex gap-2">
              <input
                value={axiKey}
                onChange={(e) => {
                  markEdited()
                  setAxiKey(e.target.value)
                }}
                placeholder="AxiTools key (axt1.…)"
                className="axi-input ar-mono flex-1"
              />
              <button onClick={() => validateAxi(axiKey)} disabled={!axiKey || axiBusy} className="axi-btn">
                <RefreshCw size={14} className={axiBusy ? 'ar-work' : ''} /> Validate
              </button>
            </div>
          </>
        )}
        {servers.length > 0 && (
          <Picker
            value={discordGuildId}
            onChange={pickServer}
            className="w-full"
            options={[
              { value: '', label: 'Select Discord server…' },
              ...servers.map((s) => ({ value: s.id, label: s.name }))
            ]}
          />
        )}
        {roles.length > 0 && (
          <div>
            <div className="axi-eyebrow mb-2">Guild-member role (anchors the roster)</div>
            <Picker
              value={memberRoleId}
              onChange={(v) => {
                markEdited()
                setMemberRoleId(v)
              }}
              disabled={!canEditConfig}
              className="w-full"
              options={[
                { value: '', label: 'No member role (show all)' },
                ...roles.map((r) => ({ value: r.id, label: r.name }))
              ]}
            />
          </div>
        )}
        {axiMsg && <div className="axi-chip axi-chip--warn self-start">{axiMsg}</div>}
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
          className="ar-textarea ar-mono"
        />
        {sharedGw2 && !canEditConfig && (
          <div className="ar-note--faint mt-2">
            Shared config is read-only — only write members can edit it.
          </div>
        )}
      </Labeled>

      {/* A setting's state is asserted by a filled track, not by a tick in a
          box: rule 5 in a slot. */}
      <div className="ar-switch-row">
        <span className="ar-note">Enable Retention radar (uses WvW attendance history)</span>
        <button
          type="button"
          role="switch"
          aria-checked={retentionEnabled}
          aria-label="Enable Retention radar"
          disabled={!canEditConfig}
          onClick={() => {
            markEdited()
            setRetentionEnabled(!retentionEnabled)
          }}
          className="axi-switch"
        >
          <span className="axi-switch__knob" />
        </button>
      </div>

      <div className="ar-switch-row">
        <span className="ar-note">Enable Recruitment pipeline</span>
        <button
          type="button"
          role="switch"
          aria-checked={pipelineEnabled}
          aria-label="Enable Recruitment pipeline"
          disabled={!canEditConfig}
          onClick={() => {
            markEdited()
            setPipelineEnabled(!pipelineEnabled)
          }}
          className="axi-switch"
        >
          <span className="axi-switch__knob" />
        </button>
      </div>

      {embedded ? (
        <div className="axi-legend__key">
          {autoSaving ? (
            <>
              <Loader2 size={13} className="ar-work" /> Saving…
            </>
          ) : (
            <>
              <Check className="ar-ink-ok" size={13} /> Changes save automatically
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={!canSave} className="axi-btn axi-btn--primary">
            <Check size={15} /> Create guild
          </button>
          <button onClick={onCancel} className="axi-btn">
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
      <div className="axi-eyebrow" style={{ marginBottom: 8 }}>
        {label}
      </div>
      {children}
    </div>
  )
}
