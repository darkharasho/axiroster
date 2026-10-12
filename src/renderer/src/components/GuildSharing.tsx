import { useState } from 'react'
import { RefreshCw, Check, ShieldCheck, MessageSquare, Ticket } from 'lucide-react'
import type { AuthStatus, GuildSummary } from '../../../preload/index.d'
import { client } from '../lib/client'
import { MemberAccessPanel } from './MemberAccessPanel'
import { InvitePanel } from './InvitePanel'
import LoadError from './LoadError'
import { SharingSkeleton } from './skeletons/PageSkeletons'
import { useGuildData } from '../lib/useGuildData'

interface SharingData {
  auth: AuthStatus
  sync: string
  role: string | null
}

// The per-guild Sharing tab. Everything here is scoped to the *active* guild
// (== the selected guild) — claim, officers, invites, role, sync status. The
// account itself (sign-in) lives in the app-settings cog; when signed out this
// tab just nudges the user there.
export default function GuildSharing(props: {
  guild: GuildSummary
  onOpenAppSettings: () => void
}): JSX.Element {
  const q = useGuildData<SharingData>(
    async () => {
      // Pick up the workspace's guild (and any AxiTools-sharing change) live.
      await client.adoptSharedKeys().catch(() => {})
      const [auth, sync, roleMap] = await Promise.all([
        client.authStatus(),
        client.syncStatus(),
        client.listWorkspaceRoles()
      ])
      // Role for THIS guild specifically — keyed by gw2GuildId, not auth:status's
      // effectiveWorkspace (which falls back to the user's first membership and
      // would bleed another workspace's role onto a local guild).
      return { auth, sync, role: roleMap[props.guild.gw2GuildId] ?? null }
    },
    { on: ['workspace'] }
  )
  if (q.loading) return <SharingSkeleton />
  if (!q.data) {
    return <LoadError title="Couldn't load sharing" error={q.error} onRetry={() => void q.reload()} />
  }
  return <SharingBody {...props} data={q.data} reload={q.reload} />
}

function SharingBody({
  guild,
  onOpenAppSettings,
  data,
  reload
}: {
  guild: GuildSummary
  onOpenAppSettings: () => void
  data: SharingData
  reload: () => Promise<void>
}): JSX.Element {
  const authStatus = data.auth
  const syncStatus = data.sync
  const role = data.role
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)
  const [redeemCode, setRedeemCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemError, setRedeemError] = useState<string | null>(null)

  const handleClaimGuild = async (): Promise<void> => {
    setClaiming(true)
    setClaimError(null)
    try {
      const result = await client.claimGuild()
      if (result.ok) await reload()
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
        await reload()
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
    } catch (e) {
      setRefreshMsg(`Refresh failed: ${e instanceof Error ? e.message : 'unknown error'}`)
      setTimeout(() => setRefreshMsg(null), 6000)
    } finally {
      setRefreshing(false)
    }
  }

  const signedIn = Boolean(authStatus.signedIn)
  const isOwner = role === 'owner'
  const isMember = signedIn && role !== null
  const guildLabel = guild.gw2GuildName || guild.name

  return (
    <div className="ar-pane__body">
      <div className="axi-page axi-page--narrow flex flex-col gap-5">
        <div>
          <h1 className="ar-title">Sharing</h1>
          <p className="ar-note mt-2">
            Share <span className="ar-ink">{guildLabel}</span> with your officers — tags, notes
            &amp; links sync live.
          </p>
        </div>

        {!authStatus.signedIn ? (
          <section className="ar-empty">
            <ShieldCheck size={22} />
            <p className="ar-note">
              Sign in with Discord to share this guild and sync with your officers.
            </p>
            <button onClick={onOpenAppSettings} className="axi-btn axi-btn--primary">
              <MessageSquare size={14} /> Sign in with Discord
            </button>
          </section>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Pending invites now surface as placeholder "invited" guilds in the
                rail (see App.tsx), so they no longer render inside Sharing. */}

            {/* Claim/redeem — signed in but not yet a member of THIS guild */}
            {!isMember && (
              <section className="ar-field items-start gap-3">
                <p className="ar-note">
                  Claim <span className="ar-ink">{guildLabel}</span> as a shared
                  workspace to enable multi-officer sync.
                </p>
                <button onClick={handleClaimGuild} disabled={claiming} className="axi-btn axi-btn--primary">
                  {claiming ? (
                    <RefreshCw size={14} className="ar-work" />
                  ) : (
                    <ShieldCheck size={14} />
                  )}
                  {claiming ? 'Claiming…' : 'Claim this guild'}
                </button>
                {claimError && <div className="axi-chip axi-chip--danger">{claimError}</div>}

                <div className="ar-or">
                  <span className="ar-label">or</span>
                </div>

                <p className="ar-note">
                  Were you invited? If an officer invited your Discord account, the invite appears
                  above. Otherwise, enter the invite code they gave you.
                </p>
                <div className="flex w-full gap-2">
                  <input
                    value={redeemCode}
                    onChange={(e) => setRedeemCode(e.target.value)}
                    placeholder="Invite code"
                    className="axi-input ar-mono flex-1"
                    onKeyDown={(e) => e.key === 'Enter' && void handleRedeemCode()}
                  />
                  <button
                    onClick={() => void handleRedeemCode()}
                    disabled={redeeming || !redeemCode.trim()}
                    className="axi-btn"
                  >
                    {redeeming ? <RefreshCw size={14} className="ar-work" /> : <Ticket size={14} />}
                    {redeeming ? 'Joining…' : 'Join'}
                  </button>
                </div>
                {redeemError && <div className="axi-chip axi-chip--danger">{redeemError}</div>}
              </section>
            )}

            {/* Shared + member: status + refresh.
                Three cards down one column — workspace, members, invite —
                each taking the panel weight, because with nothing between the
                sections but an eyebrow the eye cannot find where one ends and
                the next begins (the same reason the member detail is drawn
                this way). Not .axi-card: none of this is a thing you press. */}
            {isMember && (
              <section className="ar-field gap-3">
                <div className="axi-eyebrow">Workspace</div>
                <div className="ar-tile items-center">
                  <span className="axi-diamond axi-diamond--ok" />
                  <span>
                    <span className="ar-ink">This guild is shared.</span>{' '}
                    You&apos;re the {role} · sync: {syncStatus}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <button onClick={handleRefreshRoster} disabled={refreshing} className="axi-btn">
                    <RefreshCw size={14} className={refreshing ? 'ar-work' : ''} />
                    {refreshing ? 'Refreshing…' : 'Refresh roster'}
                  </button>
                  {refreshMsg && (
                    <span className="axi-legend__key ar-ink-ok">
                      <Check size={12} /> {refreshMsg}
                    </span>
                  )}
                </div>
              </section>
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
