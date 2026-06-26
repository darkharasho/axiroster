import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, RefreshCw, Check, Pencil, ShieldCheck, Swords, MessageSquare, Ticket } from 'lucide-react'
import type {
  DiscordGuild,
  DiscordRole,
  GuildProfile,
  GuildProfileInput,
  GuildSummary,
  GuildRef,
  AuthStatus
} from '../../../preload/index.d'
import { MemberAccessPanel } from './MemberAccessPanel'
import { InvitePanel } from './InvitePanel'
import { PendingInvites } from './PendingInvites'
import { CheckForUpdates } from './CheckForUpdates'

export default function SettingsView(): JSX.Element {
  const [guilds, setGuilds] = useState<GuildSummary[]>([])
  const [editing, setEditing] = useState<GuildProfile | 'new' | null>(null)

  const refresh = useCallback(async () => {
    setGuilds(await window.axiroster.listGuilds())
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])

  const edit = async (id: string): Promise<void> => {
    const full = await window.axiroster.getGuild(id)
    if (full) setEditing(full)
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 px-8 py-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white">Guilds</h1>
            <p className="text-sm text-ink-dim">
              Each guild bundles a GW2 API key + guild and its 1:1 Discord server (via AxiTools).
            </p>
          </div>
          {editing === null && (
            <button onClick={() => setEditing('new')} className="btn btn-accent">
              <Plus size={15} /> Add new
            </button>
          )}
        </header>

        {editing !== null ? (
          <GuildEditor
            initial={editing === 'new' ? null : editing}
            onDone={async () => {
              setEditing(null)
              await refresh()
            }}
            onCancel={() => setEditing(null)}
          />
        ) : guilds.length === 0 ? (
          <div className="rounded-lg border border-dashed border-panel-line px-6 py-10 text-center text-sm text-ink-faint">
            No guilds yet. Click <span className="text-ink">Add new</span> to connect one.
          </div>
        ) : (
          <div className="space-y-2">
            {guilds.map((g) => (
              <GuildCard
                key={g.id}
                g={g}
                onEdit={() => edit(g.id)}
                onChange={refresh}
              />
            ))}
          </div>
        )}

        <SyncSection />

        <section className="rounded-lg border border-panel-line bg-panel-raised/40 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white">Updates</h2>
          <CheckForUpdates />
        </section>
      </div>
    </div>
  )
}

function GuildCard({
  g,
  onEdit,
  onChange
}: {
  g: GuildSummary
  onEdit: () => void
  onChange: () => void
}): JSX.Element {
  return (
    <div
      className={`rounded-lg border p-4 ${
        g.active ? 'border-accent/50 bg-accent/5' : 'border-panel-line bg-panel-raised/40'
      }`}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={async () => {
            await window.axiroster.setActiveGuild(g.id)
            onChange()
          }}
          className="led h-3 w-3"
          style={{ background: g.active ? '#22c55e' : '#78716c' }}
          title={g.active ? 'Active' : 'Make active'}
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white">{g.name}</span>
            {g.active && <span className="chip px-1.5 py-0 text-green-400">active</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-dim">
            <span className="flex items-center gap-1">
              <Swords size={12} /> {g.gw2GuildName || 'no GW2 guild'}
              {g.hasGw2Key ? '' : ' (no key)'}
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare size={12} /> {g.discordGuildName || 'no Discord server'}
              {g.hasAxitoolsKey ? '' : ' (no key)'}
            </span>
          </div>
        </div>
        <button onClick={onEdit} className="btn px-2" title="Edit">
          <Pencil size={14} />
        </button>
        <button
          onClick={async () => {
            if (confirm(`Remove guild "${g.name}"? Its keys and selections are deleted.`)) {
              await window.axiroster.removeGuild(g.id)
              onChange()
            }
          }}
          className="btn px-2 text-ink-faint hover:text-red-400"
          title="Remove"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

// ---- the add/edit form -----------------------------------------------------

function GuildEditor({
  initial,
  onDone,
  onCancel
}: {
  initial: GuildProfile | null
  onDone: () => void
  onCancel: () => void
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
  // Shared guilds: the GW2 key + guild come from the workspace owner and are
  // read-only here; the member only fills in their own AxiTools key.
  const sharedGw2 = Boolean(initial?.shared)

  // Re-validate stored keys on open so the dropdowns are populated for editing.
  useEffect(() => {
    if (initial?.gw2ApiKey) validateGw2(initial.gw2ApiKey)
    if (initial?.axitoolsKey) validateAxi(initial.axitoolsKey, initial.discordGuildId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const validateGw2 = async (key: string): Promise<void> => {
    setGw2Busy(true)
    setGw2Msg(null)
    const res = await window.axiroster.gw2AccountInfo(key)
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
    const res = await window.axiroster.axitoolsListGuilds(key)
    setAxiBusy(false)
    if (!res.ok) return setAxiMsg(res.error)
    setServers(res.data)
    if (preselectDiscord) loadRoles(preselectDiscord, key)
  }

  const loadRoles = async (discordId: string, key: string): Promise<void> => {
    const res = await window.axiroster.discordOverview(discordId, false, key)
    if (res.ok) {
      const ov = res.data as { roles?: DiscordRole[] }
      setRoles((ov.roles ?? []).filter((r) => r.name !== '@everyone'))
    }
  }

  const pickGw2Guild = (id: string): void => {
    const g = gw2Guilds.find((x) => x.id === id)
    setGw2GuildId(id)
    setGw2GuildName(g ? `[${g.tag}] ${g.name}` : '')
    if (!name && g) setName(g.name)
  }

  const pickServer = async (id: string): Promise<void> => {
    const s = servers.find((x) => x.id === id)
    setDiscordGuildId(id)
    setDiscordGuildName(s?.name ?? '')
    setMemberRoleId('')
    loadRoles(id, axiKey)
    // 1:1 tie: if AxiTools binds this server to a GW2 guild, auto-select it.
    const bound = await window.axiroster.boundGw2Guilds(id, axiKey)
    if (bound.ok && bound.data.length && gw2Guilds.some((g) => g.id === bound.data[0])) {
      pickGw2Guild(bound.data[0])
    }
  }

  const canSave = Boolean(gw2Key && gw2GuildId) || Boolean(axiKey && discordGuildId)

  const save = async (): Promise<void> => {
    const bridgeRepos = reposText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [owner, repo] = l.split('/')
        return owner && repo ? { owner, repo } : null
      })
      .filter((r): r is { owner: string; repo: string } => r !== null)

    const input: GuildProfileInput = {
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
      shared: initial?.shared ?? false
    }
    await window.axiroster.upsertGuild(input)
    onDone()
  }

  return (
    <section className="space-y-5 rounded-lg border border-panel-line bg-panel-raised/40 p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} className="text-accent" />
        <h2 className="text-sm font-semibold text-white">
          {initial ? 'Edit guild' : 'Add a guild'}
        </h2>
      </div>

      <Labeled label="Guild name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
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
                onChange={(e) => setGw2Key(e.target.value)}
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
        <div className="flex gap-2">
          <input
            value={axiKey}
            onChange={(e) => setAxiKey(e.target.value)}
            placeholder="AxiTools key (axt1.…)"
            className="field flex-1 font-mono text-xs"
          />
          <button
            onClick={() => validateAxi(axiKey)}
            disabled={!axiKey || axiBusy}
            className="btn"
          >
            <RefreshCw size={14} className={axiBusy ? 'animate-spin' : ''} /> Validate
          </button>
        </div>
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
              onChange={(e) => setMemberRoleId(e.target.value)}
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
        {axiMsg && <div className="text-xs text-amber-300">{axiMsg}</div>}
      </div>

      {/* Bridge */}
      <Labeled label="AxiBridge report repos (owner/repo per line)">
        <textarea
          value={reposText}
          onChange={(e) => setReposText(e.target.value)}
          placeholder="myguild/wvw-reports"
          rows={2}
          className="field resize-y font-mono text-xs"
        />
      </Labeled>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={!canSave} className="btn btn-accent">
          <Check size={15} /> Save guild
        </button>
        <button onClick={onCancel} className="btn">
          Cancel
        </button>
      </div>
    </section>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</div>
      {children}
    </div>
  )
}

// ---- Sync / Auth (global, not per-guild) ------------------------------------

function SyncSection(): JSX.Element {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [syncStatus, setSyncStatus] = useState('disabled')
  const [signingIn, setSigningIn] = useState(false)
  const [activeGuildName, setActiveGuildName] = useState<string | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)
  const [redeemCode, setRedeemCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemError, setRedeemError] = useState<string | null>(null)
  const [keysShared, setKeysShared] = useState(false)
  const [togglingShare, setTogglingShare] = useState(false)

  const loadStatus = async (): Promise<void> => {
    const [auth, sync, guildsArr, share] = await Promise.all([
      window.axiroster.authStatus(),
      window.axiroster.syncStatus(),
      window.axiroster.listGuilds(),
      window.axiroster.sharedKeysStatus()
    ])
    setAuthStatus(auth)
    setSyncStatus(sync)
    setKeysShared(share.shared)
    const active = guildsArr.find((g) => g.active)
    setActiveGuildName(active?.gw2GuildName ?? active?.name ?? null)
  }

  const handleToggleShare = async (): Promise<void> => {
    setTogglingShare(true)
    try {
      const r = await window.axiroster.setSharedKeys(!keysShared)
      if (r.ok) setKeysShared(Boolean(r.shared))
    } finally {
      setTogglingShare(false)
    }
  }

  useEffect(() => {
    void (async () => {
      // Invited members pick up the workspace's shared keys (if any) as a guild.
      await window.axiroster.adoptSharedKeys().catch(() => {})
      await loadStatus()
    })()
    // The workspace follows the active guild — reload when it switches.
    return window.axiroster.onWorkspaceChanged(() => void loadStatus())
  }, [])

  const handleSignIn = async (): Promise<void> => {
    setSigningIn(true)
    try {
      await window.axiroster.authSignIn()
      await loadStatus()
    } finally {
      setSigningIn(false)
    }
  }

  const handleSignOut = async (): Promise<void> => {
    await window.axiroster.authSignOut()
    setAuthStatus(null)
    setSyncStatus('disabled')
  }

  const handleClaimGuild = async (): Promise<void> => {
    setClaiming(true)
    setClaimError(null)
    try {
      const result = await window.axiroster.claimGuild()
      if (result.ok) {
        await loadStatus()
      } else {
        setClaimError(result.error ?? 'Unknown error')
      }
    } finally {
      setClaiming(false)
    }
  }

  const handleRedeemCode = async (): Promise<void> => {
    if (!redeemCode.trim()) return
    setRedeeming(true)
    setRedeemError(null)
    try {
      const result = await window.axiroster.redeemInvite(redeemCode.trim())
      if (result.ok) {
        setRedeemCode('')
        await loadStatus()
      } else {
        setRedeemError(result.error ?? 'Could not redeem code')
      }
    } finally {
      setRedeeming(false)
    }
  }

  const handleRefreshRoster = async (): Promise<void> => {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const result = await window.axiroster.refreshRoster()
      setRefreshMsg(`Synced ${result.count} members`)
      setTimeout(() => setRefreshMsg(null), 4000)
    } finally {
      setRefreshing(false)
    }
  }

  const isOwner = authStatus?.role === 'owner'
  const isMember = authStatus?.signedIn && (authStatus.role === 'owner' || authStatus.role === 'write' || authStatus.role === 'read')
  const isClaimed = Boolean(authStatus?.workspaceId)

  return (
    <section className="rounded-lg border border-panel-line bg-panel-raised/40 p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Shared sync</h2>
        <p className="mt-0.5 text-xs text-ink-dim">
          Leadership share one workspace — tags, notes &amp; links sync live across officers.
        </p>
      </div>

      {!authStatus?.signedIn ? (
        <button
          onClick={handleSignIn}
          disabled={signingIn}
          className="btn btn-accent"
        >
          {signingIn ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <MessageSquare size={14} />
          )}
          {signingIn ? 'Signing in…' : 'Sign in with Discord'}
        </button>
      ) : (
        <div className="space-y-4">
          {/* Signed-in header */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-sm text-ink">
                <ShieldCheck size={14} className="text-emerald-400" />
                <span>Signed in</span>
                <span className="chip px-1.5 py-0 text-emerald-400 capitalize">
                  {authStatus.role ?? 'unknown'}
                </span>
              </div>
              <div className="text-xs text-ink-dim">Sync status: {syncStatus}</div>
            </div>
            <button onClick={handleSignOut} className="btn text-xs text-ink-faint hover:text-red-400">
              Sign out
            </button>
          </div>

          {/* Invites pushed to this user's Discord account — accept or reject */}
          <PendingInvites onChange={loadStatus} />

          {/* Claim guild button — shown when signed in but not yet a member / no workspace claimed */}
          {!isMember && !isClaimed && (
            <div className="space-y-2">
              <p className="text-xs text-ink-dim">
                Claim{activeGuildName ? ` "${activeGuildName}"` : ' your active guild'} as a shared workspace to enable multi-officer sync.
              </p>
              <button
                onClick={handleClaimGuild}
                disabled={claiming}
                className="btn btn-accent"
              >
                {claiming ? <RefreshCw size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                {claiming ? 'Claiming…' : 'Claim this guild'}
              </button>
              {claimError && <div className="text-xs text-red-400">{claimError}</div>}

              <div className="flex items-center gap-3 pt-1">
                <div className="h-px flex-1 bg-panel-line" />
                <span className="text-[11px] uppercase tracking-wide text-ink-faint">or</span>
                <div className="h-px flex-1 bg-panel-line" />
              </div>

              <p className="text-xs text-ink-dim">
                Were you invited? If an officer invited your Discord account, the invite appears
                above to accept. Otherwise, enter the invite code they gave you.
              </p>
              <div className="flex gap-2">
                <input
                  value={redeemCode}
                  onChange={(e) => setRedeemCode(e.target.value)}
                  placeholder="Invite code"
                  className="field flex-1 font-mono text-xs"
                  onKeyDown={(e) => e.key === 'Enter' && void handleRedeemCode()}
                />
                <button
                  onClick={() => void handleRedeemCode()}
                  disabled={redeeming || !redeemCode.trim()}
                  className="btn"
                >
                  {redeeming ? <RefreshCw size={14} className="animate-spin" /> : <Ticket size={14} />}
                  {redeeming ? 'Joining…' : 'Join'}
                </button>
              </div>
              {redeemError && <div className="text-xs text-red-400">{redeemError}</div>}
            </div>
          )}

          {/* Refresh roster — visible to any signed-in member */}
          {isMember && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleRefreshRoster}
                disabled={refreshing}
                className="btn"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'Refreshing…' : 'Refresh roster'}
              </button>
              {refreshMsg && (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <Check size={12} /> {refreshMsg}
                </span>
              )}
            </div>
          )}

          {isOwner && (
            <>
              <MemberAccessPanel />
              <InvitePanel />

              <div className="space-y-1.5 rounded-md border border-panel-line bg-panel p-3">
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={keysShared}
                    disabled={togglingShare}
                    onChange={() => void handleToggleShare()}
                    className="h-4 w-4 accent-emerald-500"
                  />
                  <span className="text-sm text-ink">Share GW2 key &amp; guild with officers</span>
                </label>
                <p className="text-xs text-ink-faint">
                  Invited officers get this guild automatically (read-only) so they can see the
                  roster without their own GW2 key. The GW2 key is read-only, so the risk is low.
                  Each officer still adds their <span className="text-ink-dim">own</span> AxiTools
                  key for Discord features.
                </p>
              </div>
            </>
          )}

          {isMember && !isOwner && (
            <div className="text-sm text-ink-dim">
              Your role:{' '}
              <span className="text-ink capitalize">{authStatus.role ?? 'unknown'}</span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
