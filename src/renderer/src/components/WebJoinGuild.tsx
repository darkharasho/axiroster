// src/renderer/src/components/WebJoinGuild.tsx
// Web-only onboarding for a signed-in member with no guild yet: redeem an invite
// code to join. Creating a NEW guild needs a GW2 leader key (desktop / the
// sidebar "Add a guild"), so this focuses on the common member path.
import { useState } from 'react'
import { Link2, Loader2, ShieldCheck, Info } from 'lucide-react'
import { client } from '../lib/client'

export function redeemErrorMessage(res: { ok: boolean; error?: string }): string | null {
  return res.ok ? null : res.error ?? 'Could not redeem that code'
}

export default function WebJoinGuild({
  onJoined
}: {
  onJoined: (workspaceId?: string) => void
}): JSX.Element {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const redeem = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const res = await client.redeemInvite(code)
    setBusy(false)
    const msg = redeemErrorMessage(res)
    if (msg) {
      setError(msg)
      return
    }
    onJoined(res.workspaceId)
  }

  return (
    <div className="grid flex-1 place-items-center px-8 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        <div className="ar-detail__avatar">
          <ShieldCheck className="ar-ink-accent" size={26} />
        </div>
        <div>
          <h1 className="ar-title">You&apos;re in — now join a guild</h1>
          <p className="ar-note mt-2">
            Ask your guild lead for an invite code, then drop it in below.
          </p>
        </div>

        <div className="axi-panel w-full text-left">
          <h2 className="axi-eyebrow flex items-center gap-2">
            <Link2 size={14} /> Redeem an invite code
          </h2>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) void redeem()
              }}
              placeholder="e.g.  K7P2-9XQM"
              className="axi-input ar-mono min-w-0 flex-1"
            />
            <button
              onClick={() => void redeem()}
              disabled={busy}
              className="axi-btn axi-btn--primary shrink-0"
            >
              {busy ? <Loader2 size={14} className="ar-work" /> : 'Join'}
            </button>
          </div>
          {error && <p className="axi-chip axi-chip--danger mt-3">{error}</p>}
          <p className="ar-note--faint mt-3">
            Already invited? Pending invites show in the left sidebar — accept one there.
          </p>
        </div>

        <p className="ar-note--faint flex items-start justify-center gap-2 text-left">
          <Info size={14} className="mt-px shrink-0" />
          <span>
            Setting up a <em>new</em> guild uses your GW2 leader API key — do that in the desktop app (or via
            "Add a guild" if you have the key).
          </span>
        </p>
      </div>
    </div>
  )
}
