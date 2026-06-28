import { useEffect, useState } from 'react'
import { RefreshCw, Check, ShieldCheck, MessageSquare, Ticket, Loader2 } from 'lucide-react'
import type { AuthStatus, GuildSummary } from '../../../preload/index.d'
import { client } from '../lib/client'
import { MemberAccessPanel } from './MemberAccessPanel'
import { InvitePanel } from './InvitePanel'

// The per-guild Sharing tab. Everything here is scoped to the *active* guild
// (== the selected guild) — claim, officers, invites, role, sync status. The
// account itself (sign-in) lives in the app-settings cog; when signed out this
// tab just nudges the user there.
export default function GuildSharing({
  guild,
  onOpenAppSettings
}: {
  guild: GuildSummary
  onOpenAppSettings: () => void
}): JSX.Element {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [syncStatus, setSyncStatus] = useState('disabled')
  // Role for THIS guild specifically — keyed by gw2GuildId, not auth:status's
  // effectiveWorkspace (which falls back to the user's first membership and would
  // bleed another workspace's role onto a local guild).
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)
  const [redeemCode, setRedeemCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemError, setRedeemError] = useState<string | null>(null)

  const loadStatus = async (): Promise<void> => {
    const [auth, sync, roleMap] = await Promise.all([
      client.authStatus(),
      client.syncStatus(),
      client.listWorkspaceRoles()
    ])
    setAuthStatus(auth)
    setSyncStatus(sync)
    setRole(roleMap[guild.gw2GuildId] ?? null)
  }

  useEffect(() => {
    let cancelled = false
    const sync = async (): Promise<void> => {
      // Pick up the workspace's guild (and any AxiTools-sharing change) live.
      await client.adoptSharedKeys().catch(() => {})
      await loadStatus()
      if (!cancelled) setLoading(false)
    }
    void sync()
    const off = client.onWorkspaceChanged(() => void sync())
    return () => {
      cancelled = true
      off()
    }
    // Re-run when the selected guild changes.
  }, [guild.id])

  const handleClaimGuild = async (): Promise<void> => {
    setClaiming(true)
    setClaimError(null)
    try {
      const result = await client.claimGuild()
      if (result.ok) await loadStatus()
      else setClaimError(result.error ?? 'Unknown error')
    } finally {
      setClaiming(false)
    }
  }

  const handleRedeemCode = async (): Promise<void> => {
    if (!redeemCode.trim()) return
    setRedeeming(true)
    setRedeemError(null)
    try {
      const result = await client.redeemInvite(redeemCode.trim())
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
      const result = await client.refreshRoster()
      setRefreshMsg(`Synced ${result.count} members`)
      setTimeout(() => setRefreshMsg(null), 4000)
    } finally {
      setRefreshing(false)
    }
  }

  const signedIn = Boolean(authStatus?.signedIn)
  const isOwner = role === 'owner'
  const isMember = signedIn && role !== null
  const guildLabel = guild.gw2GuildName || guild.name

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 px-8 py-8">
        <div>
          <h1 className="text-lg font-semibold text-white">Sharing</h1>
          <p className="text-sm text-ink-dim">
            Share <span className="text-ink">{guildLabel}</span> with your officers — tags, notes
            &amp; links sync live.
          </p>
        </div>

        {loading ? (
          <div className="grid place-items-center py-16 text-ink-faint">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : !authStatus?.signedIn ? (
          <section className="rounded-lg border border-dashed border-panel-line px-6 py-10 text-center">
            <ShieldCheck size={22} className="mx-auto mb-3 text-ink-faint" />
            <p className="text-sm text-ink-dim">
              Sign in with Discord to share this guild and sync with your officers.
            </p>
            <button onClick={onOpenAppSettings} className="btn btn-accent mx-auto mt-4">
              <MessageSquare size={14} /> Sign in with Discord
            </button>
          </section>
        ) : (
          <div className="space-y-4">
            {/* Pending invites now surface as placeholder "invited" guilds in the
                rail (see App.tsx), so they no longer render inside Sharing. */}

            {/* Claim/redeem — signed in but not yet a member of THIS guild */}
            {!isMember && (
              <section className="space-y-2 rounded-lg border border-panel-line bg-panel-raised/40 p-5">
                <p className="text-xs text-ink-dim">
                  Claim <span className="text-ink">{guildLabel}</span> as a shared workspace to
                  enable multi-officer sync.
                </p>
                <button onClick={handleClaimGuild} disabled={claiming} className="btn btn-accent">
                  {claiming ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <ShieldCheck size={14} />
                  )}
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
                  above. Otherwise, enter the invite code they gave you.
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
              </section>
            )}

            {/* Shared + member: status + refresh */}
            {isMember && (
              <>
                <div className="flex items-center gap-2 rounded-lg border border-panel-line bg-panel-sunk px-4 py-3 text-sm text-ink-dim">
                  <span className="led" style={{ background: '#22c55e' }} />
                  <span className="text-ink">This guild is shared.</span> You're the{' '}
                  <span className="capitalize text-emerald-400">{role}</span> · sync: {syncStatus}
                </div>

                <div className="flex items-center gap-3">
                  <button onClick={handleRefreshRoster} disabled={refreshing} className="btn">
                    <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Refreshing…' : 'Refresh roster'}
                  </button>
                  {refreshMsg && (
                    <span className="flex items-center gap-1 text-xs text-emerald-400">
                      <Check size={12} /> {refreshMsg}
                    </span>
                  )}
                </div>
              </>
            )}

            {isOwner && (
              <>
                <MemberAccessPanel />
                <InvitePanel />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
