import { AlertTriangle, RefreshCw } from 'lucide-react'
import { errorMessage } from '../lib/useGuildData'

// A view's first load failed, so there is nothing to show but the failure.
// A refresh that fails over data already on screen toasts instead (see
// useGuildData) — this pane never replaces data the reader can still use.
export default function LoadError({
  title,
  error,
  onRetry
}: {
  title: string
  error: unknown
  onRetry: () => void
}): JSX.Element {
  return (
    <div className="ar-pane__body grid place-items-center p-6">
      <section className="ar-empty" role="alert">
        <AlertTriangle size={22} className="ar-ink-danger" />
        <p className="ar-ink">{title}</p>
        {error != null && <p className="ar-note">{errorMessage(error)}</p>}
        <button onClick={onRetry} className="axi-btn">
          <RefreshCw size={14} /> Retry
        </button>
      </section>
    </div>
  )
}
