import { useState } from 'react'
import { Copy, RefreshCw, UserPlus } from 'lucide-react'

type InviteRole = 'read' | 'write'

export function InvitePanel(): JSX.Element {
  const [discordId, setDiscordId] = useState('')
  const [role, setRole] = useState<InviteRole>('read')
  const [generatedCode, setGeneratedCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invite = async (payload: { discordId?: string; code?: string; role?: string }): Promise<void> => {
    setBusy(true)
    setError(null)
    setGeneratedCode(null)
    try {
      const result = await window.axiroster.createInvite(payload)
      if (result.code) {
        setGeneratedCode(result.code)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invite failed')
    } finally {
      setBusy(false)
    }
  }

  const handleInviteByDiscordId = async (): Promise<void> => {
    if (!discordId.trim()) return
    await invite({ discordId: discordId.trim(), role })
    setDiscordId('')
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
        <span className="text-xs text-ink-dim">Role:</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as InviteRole)}
          className="field py-0.5 text-xs"
        >
          <option value="read">read</option>
          <option value="write">write</option>
        </select>
      </div>

      {/* Invite by Discord ID */}
      <div className="space-y-1">
        <div className="text-xs text-ink-dim">Invite by Discord user ID</div>
        <div className="flex gap-2">
          <input
            value={discordId}
            onChange={(e) => setDiscordId(e.target.value)}
            placeholder="Discord user ID (18-digit snowflake)"
            className="field flex-1 font-mono text-xs"
          />
          <button
            onClick={() => void handleInviteByDiscordId()}
            disabled={busy || !discordId.trim()}
            className="btn btn-accent"
          >
            {busy ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <UserPlus size={14} />
            )}
            Invite
          </button>
        </div>
      </div>

      {/* Generate code */}
      <div className="space-y-1">
        <div className="text-xs text-ink-dim">Or generate a shareable invite code</div>
        <button
          onClick={() => void handleGenerateCode()}
          disabled={busy}
          className="btn"
        >
          {busy ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <UserPlus size={14} />
          )}
          Generate code
        </button>
      </div>

      {/* Generated code display */}
      {generatedCode && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-900/20 px-3 py-2">
          <span className="flex-1 font-mono text-xs text-emerald-300">{generatedCode}</span>
          <button
            onClick={() => void copyCode()}
            className="btn px-2 text-emerald-400"
            title="Copy code"
          >
            <Copy size={12} />
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}

      {error && (
        <div className="text-xs text-red-400">{error}</div>
      )}
    </div>
  )
}
