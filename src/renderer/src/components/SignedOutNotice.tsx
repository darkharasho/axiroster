import { useState } from 'react'
import { LogIn } from 'lucide-react'
import { client } from '../lib/client'

/**
 * Shown over a shared guild while its Discord session is gone. Signed out, the
 * app quietly drops to local-only — edits stop syncing and voting is off — and
 * nothing else on screen says why, so it read as a role downgrade.
 */
export default function SignedOutNotice({ onSignedIn }: { onSignedIn: () => void }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const signIn = async (): Promise<void> => {
    setBusy(true)
    try {
      await client.authSignIn()
      onSignedIn()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="axi-notice axi-notice--warn mx-5 mt-4 items-center">
      <div className="axi-notice__icon">
        <LogIn size={14} />
      </div>
      <p className="flex-1">
        <b>Signed out of Discord.</b> Your changes won&apos;t sync to the guild and voting is off
        until you sign back in.
      </p>
      <button className="axi-btn axi-btn--primary ar-sm" disabled={busy} onClick={() => void signIn()}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </div>
  )
}
