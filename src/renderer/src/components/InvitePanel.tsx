import { useEffect, useState } from 'react'
import { Copy, RefreshCw, UserPlus, X } from 'lucide-react'
import { RoleToggle, type ToggleRole } from './RoleToggle'
import { useDiscordRoster } from './discordRoster'
import type { SentInvite } from '../../../preload/index.d'

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
    void window.axiroster
      .pendingSentInvites()
      .then(setSent)
      .catch(() => setSent([]))
  }
  useEffect(loadSent, [])

  const handleRevoke = async (id: string): Promise<void> => {
    await window.axiroster.revokeInvite(id)
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
      const result = await window.axiroster.createInvite(payload)
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
    <div className="space-y-3">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">Invite</div>

      {/* Role picker */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-dim">Role</span>
        <RoleToggle value={role} onChange={setRole} disabled={busy} />
      </div>

      {/* Invite by username or id */}
      <div className="space-y-1">
        <div className="text-xs text-ink-dim">Invite a Discord member</div>
        <div className="flex gap-2">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Discord username or user ID"
            list="discord-roster"
            className="field flex-1 text-xs"
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
            className="btn btn-accent"
          >
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <UserPlus size={14} />}
            Invite
          </button>
        </div>
        <div className="text-[11px] text-ink-faint">
          Type a username (autocompletes from the guild roster) or paste a raw 18-digit ID.
        </div>
      </div>

      {/* Generate code */}
      <div className="space-y-1">
        <div className="text-xs text-ink-dim">Or generate a shareable invite code</div>
        <button onClick={() => void handleGenerateCode()} disabled={busy} className="btn">
          {busy ? <RefreshCw size={14} className="animate-spin" /> : <UserPlus size={14} />}
          Generate code
        </button>
      </div>

      {/* Generated code display */}
      {generatedCode && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-900/20 px-3 py-2">
          <span className="flex-1 font-mono text-xs text-emerald-300">{generatedCode}</span>
          <button onClick={() => void copyCode()} className="btn px-2 text-emerald-400" title="Copy code">
            <Copy size={12} />
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}

      {error && <div className="text-xs text-red-400">{error}</div>}

      {/* Pending invites this owner has sent — with revoke */}
      {sent.length > 0 && (
        <div className="space-y-1 border-t border-panel-line pt-3">
          <div className="text-xs text-ink-dim">Pending invites</div>
          {sent.map((inv) => {
            const info = inv.discordId ? infoFor(inv.discordId) : null
            const label = inv.code
              ? `Code: ${inv.code}`
              : info?.displayName || info?.name || inv.discordId || 'Unknown'
            return (
              <div
                key={inv.id}
                className="flex items-center gap-2 rounded-md border border-panel-line bg-panel px-3 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{label}</span>
                <span className="chip px-1.5 py-0 capitalize text-emerald-400">{inv.role}</span>
                <button
                  onClick={() => void handleRevoke(inv.id)}
                  className="btn px-1.5 text-ink-faint hover:text-red-400"
                  title="Revoke invite"
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
