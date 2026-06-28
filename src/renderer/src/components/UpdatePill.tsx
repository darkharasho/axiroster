import { useEffect, useState } from 'react'
import { RefreshCw, Download } from 'lucide-react'
import { client } from '../lib/client'

// Small auto-update status pill in the titlebar (AxiBridge's UX, emerald accent):
// downloading(%) -> "Restart to update". Hidden when there's nothing to show.
export default function UpdatePill(): JSX.Element | null {
  const [percent, setPercent] = useState<number | null>(null)
  const [available, setAvailable] = useState(false)
  const [downloaded, setDownloaded] = useState(false)

  useEffect(() => {
    const offs = [
      client.onUpdateAvailable(() => setAvailable(true)),
      client.onUpdateProgress((i) => setPercent(i.percent)),
      client.onUpdateDownloaded(() => setDownloaded(true)),
      client.onUpdateStatus((s) => {
        if (s === 'none') {
          setAvailable(false)
          setPercent(null)
        }
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  if (downloaded) {
    return (
      <button
        onClick={() => void client.restartToUpdate()}
        className="no-drag mr-2 flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-accent/25"
        title="Restart to install the update"
      >
        <Download size={12} /> Restart to update
      </button>
    )
  }

  if (available || percent !== null) {
    return (
      <div
        className="no-drag mr-2 flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300"
        title="Downloading update…"
      >
        <RefreshCw size={12} className="animate-spin" />
        {percent !== null ? `${Math.round(percent)}%` : 'Updating…'}
      </div>
    )
  }

  return null
}
