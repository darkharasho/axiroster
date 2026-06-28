import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { client } from '../lib/client'

// Manual "check for updates" with status feedback. Auto-update still runs on its
// own; this lets the user force a check and see the result.
export function CheckForUpdates(): JSX.Element {
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const offs = [
      client.onUpdateStatus((s) => {
        if (s === 'checking') setStatus('Checking…')
        else if (s === 'none') {
          setStatus("You're on the latest version.")
          setBusy(false)
        }
      }),
      client.onUpdateAvailable((i) => {
        setStatus(`Update available (v${i.version}) — downloading…`)
        setBusy(false)
      }),
      client.onUpdateDownloaded(() => {
        setStatus('Update downloaded — restart to install.')
        setBusy(false)
      }),
      client.onUpdateError((e) => {
        setStatus(`Update error: ${e.message}`)
        setBusy(false)
      })
    ]
    return () => offs.forEach((o) => o())
  }, [])

  const check = async (): Promise<void> => {
    setBusy(true)
    setStatus('Checking…')
    const r = await client.checkForUpdate()
    if (!r.ok) {
      setStatus(r.error ?? 'Update check failed.')
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button onClick={() => void check()} disabled={busy} className="btn">
        <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
        Check for updates
      </button>
      {status && <span className="text-xs text-ink-dim">{status}</span>}
    </div>
  )
}
