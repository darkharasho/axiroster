import { useEffect, useState } from 'react'
import { Copy, RefreshCw, UserPlus, X } from 'lucide-react'
import { RoleToggle, type ToggleRole } from './RoleToggle'
import { useDiscordRoster } from './discordRoster'
import type { SentInvite } from '../../../preload/index.d'
import { client } from '../lib/client'
import Tooltip from './Tooltip'

export function InvitePanel(): JSX.Element {
  const [target, setTarget] = useState('')
  const [role, setRole] = useState<ToggleRole>('read')
  const [generatedCode, setGeneratedCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { members, infoFor } = useDiscordRoster()
  const [sent, setSent] = useState<SentInvite[]>([])

  const loadSent = (): void => {
    void client
      .pendingSentInvites()
      .then(setSent)
      .catch(() => setSent([]))
  }
  useEffect(() => {
    loadSent()
    // Live refresh when an invite is created / revoked / accepted elsewhere.
    return client.onWorkspaceChanged(loadSent)
  }, [])

  const handleRevoke = async (id: string): Promise<void> => {
    await client.revokeInvite(id)
    loadSent()
  }

  const invite = async (payload: {
    discordId?: string
    code?: string
    role?: string
  }): Promise<boolean> => {
    setBusy(true)
    setError(null)
    setGeneratedCode(null)
    try {
      const result = await client.createInvite(payload)
      if (result.error) {
        setError(result.error)
        return false
      }
      if (result.code) setGeneratedCode(result.code)
      loadSent()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invite failed')
      return false
    } finally {
      setBusy(false)
    }
  }

  // Accept a raw snowflake id, or resolve a username/display name from the roster.
  const resolveDiscordId = (raw: string): string | null => {
    const v = raw.trim()
    if (/^\d{17,20}$/.test(v)) return v
    const lower = v.toLowerCase()
    const match = members.find(
      (m) => m.name.toLowerCase() === lower || m.displayName.toLowerCase() === lower
    )
    return match?.id ?? null
  }

  const handleInvite = async (): Promise<void> => {
    if (!target.trim()) return
    const discordId = resolveDiscordId(target)
    if (!discordId) {
      setError(`No guild member matches "${target.trim()}". Use a username from the roster or a raw 18-digit ID.`)
      return
    }
    if (await invite({ discordId, role })) setTarget('')
  }

  const handleGenerateCode = async (): Promise<void> => {
    await invite({ role })
  }

  const copyCode = async (): Promise<void> => {
    if (!generatedCode) return
    await navigator.clipboard.writeText(generatedCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="ar-field gap-4">
      <div className="axi-eyebrow">Invite</div>

      {/* Role picker */}
      <div className="flex items-center gap-3">
        <span className="ar-label">Role</span>
        <RoleToggle value={role} onChange={setRole} disabled={busy} />
      </div>

      {/* Invite by username or id */}
      <div className="flex flex-col gap-2">
        <div className="axi-eyebrow">Invite a Discord member</div>
        <div className="flex gap-2">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Discord username or user ID"
            list="discord-roster"
            className="axi-input flex-1"
            onKeyDown={(e) => e.key === 'Enter' && void handleInvite()}
          />
          <datalist id="discord-roster">
            {members.map((m) => (
              <option key={m.id} value={m.displayName || m.name} />
            ))}
          </datalist>
          <button
            onClick={() => void handleInvite()}
            disabled={busy || !target.trim()}
            className="axi-btn axi-btn--primary"
          >
            {busy ? <RefreshCw size={14} className="ar-work" /> : <UserPlus size={14} />}
            Invite
          </button>
        </div>
        <div className="ar-note--faint">
          Type a username (autocompletes from the guild roster) or paste a raw 18-digit ID.
        </div>
      </div>

      {/* Generate code */}
      <div className="flex flex-col items-start gap-2">
        <div className="axi-eyebrow">Or generate a shareable invite code</div>
        <button onClick={() => void handleGenerateCode()} disabled={busy} className="axi-btn">
          {busy ? <RefreshCw size={14} className="ar-work" /> : <UserPlus size={14} />}
          Generate code
        </button>
      </div>

      {/* Generated code display */}
      {generatedCode && (
        <div className="ar-tile items-center">
          <span className="ar-mono ar-ink-accent flex-1">
            {generatedCode}
          </span>
          <Tooltip text="Copy code">
            <button onClick={() => void copyCode()} className="axi-btn ar-sm">
              <Copy size={12} />
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </Tooltip>
        </div>
      )}

      {error && <div className="axi-chip axi-chip--danger self-start">{error}</div>}

      {/* Pending invites this owner has sent — with revoke */}
      {sent.length > 0 && (
        <div className="ar-pop__foot flex-col items-stretch gap-2">
          <div className="axi-eyebrow">Pending invites</div>
          {sent.map((inv) => {
            const info = inv.discordId ? infoFor(inv.discordId) : null
            const label = inv.code
              ? `Code: ${inv.code}`
              : info?.displayName || info?.name || inv.discordId || 'Unknown'
            return (
              <div key={inv.id} className="ar-tile items-center">
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <span className="axi-chip">{inv.role}</span>
                <Tooltip text="Revoke invite">
                  <button
                    onClick={() => void handleRevoke(inv.id)}
                    className="ar-icon-btn ar-icon-btn--danger"
                    style={{ width: 22, height: 22 }}
                  >
                    <X size={12} />
                  </button>
                </Tooltip>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
