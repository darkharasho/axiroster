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
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-panel-line bg-panel-raised shadow-raise">
          <ShieldCheck size={26} className="text-emerald-400" />
        </div>
        <h1 className="mb-1.5 text-lg font-semibold text-white">You&apos;re in — now join a guild</h1>
        <p className="mb-6 text-sm leading-relaxed text-ink-dim">
          Ask your guild lead for an invite code, then drop it in below.
        </p>

        <div className="rounded-xl border border-panel-line bg-panel-raised/60 p-5 text-left shadow-raise">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-dim">
            <Link2 size={14} className="text-emerald-400" /> Redeem an invite code
          </h2>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) void redeem()
              }}
              placeholder="e.g.  K7P2-9XQM"
              className="min-w-0 flex-1 rounded-lg border border-panel-line2 bg-panel-sunk px-3 py-2.5 font-mono text-[13px] tracking-wide text-ink shadow-sunk outline-none placeholder:font-sans placeholder:text-ink-faint focus:border-accent"
            />
            <button
              onClick={() => void redeem()}
              disabled={busy}
              className="btn btn-accent shrink-0 px-5"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : 'Join'}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-faint">
            Already invited? Pending invites show in the left sidebar — accept one there.
          </p>
        </div>

        <p className="mt-4 flex items-start justify-center gap-2 px-1 text-left text-xs leading-relaxed text-ink-faint">
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
