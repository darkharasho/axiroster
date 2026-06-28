import { useEffect, useState } from 'react'
import App from '../renderer/src/App'
import { client } from '../renderer/src/lib/client'
import type { AuthStatus } from '../preload/index.d'
import Landing from './Landing'
import { chooseView } from './authGate'

// Web entry gate: resolve auth once on load, then show the signed-out Landing or
// the full App. Keeps the shared App untouched — this lives only in the web build.
export default function WebRoot(): JSX.Element {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    client
      .authStatus()
      .then((s) => {
        if (alive) setStatus(s)
      })
      .catch(() => {
        if (alive) setStatus({ signedIn: false })
      })
    return () => {
      alive = false
    }
  }, [])

  const view = chooseView(status)
  if (view === 'loading') {
    return <div className="grid min-h-screen place-items-center bg-panel text-ink-faint">Loading…</div>
  }
  if (view === 'app') return <App />
  return (
    <Landing
      busy={busy}
      onSignIn={() => {
        setBusy(true)
        void client.authSignIn()
      }}
    />
  )
}
