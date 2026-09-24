import { useEffect, useState } from 'react'
import { RefreshCw, Download } from 'lucide-react'
import { client } from '../lib/client'

// Small auto-update status chip in the titlebar: downloading(%) -> "Restart to
// update". Hidden when there's nothing to show. An update ready to install is
// something to act on, so it is the accent chip; one still downloading is a
// fact in progress, so it stays neutral and reports liveness by blinking the
// glyph's opacity (rule 11) rather than spinning it.
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
        className="axi-chip axi-chip--accent no-drag"
        title="Restart to install the update"
      >
        <Download size={12} /> Restart to update
      </button>
    )
  }

  if (available || percent !== null) {
    return (
      <div
        className="axi-chip no-drag"
        title="Downloading update…"
      >
        <RefreshCw size={12} className="ar-work" />
        {percent !== null ? `${Math.round(percent)}%` : 'Updating…'}
      </div>
    )
  }

  return null
}
