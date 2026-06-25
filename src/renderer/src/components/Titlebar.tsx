import { useEffect, useState } from 'react'
import { ShieldCheck, Minus, Square, Copy, X } from 'lucide-react'

// Custom titlebar for the frameless window — consistent across macOS/Windows/Linux.
// The bar is the OS drag handle (.drag); the controls opt out (.no-drag).
export default function Titlebar(): JSX.Element {
  const [max, setMax] = useState(false)
  const [mac, setMac] = useState(false)

  useEffect(() => {
    window.axiroster.windowIsMaximized().then(setMax)
    window.axiroster.platform().then((p) => setMac(p === 'darwin'))
    return window.axiroster.onWindowMaximized(setMax)
  }, [])

  return (
    <div className="drag flex h-8 shrink-0 select-none items-center justify-between border-b border-panel-line bg-panel">
      <div
        className={`flex items-center gap-2 text-xs font-medium text-ink-dim ${
          // leave room on macOS in case the user re-enables traffic lights later
          mac ? 'px-3' : 'px-3'
        }`}
      >
        <ShieldCheck size={13} className="text-accent" />
        AxiRoster
      </div>
      <div className="no-drag flex h-full">
        <button onClick={() => window.axiroster.windowMinimize()} className="titlebar-btn" title="Minimize">
          <Minus size={14} />
        </button>
        <button
          onClick={async () => setMax(await window.axiroster.windowMaximizeToggle())}
          className="titlebar-btn"
          title={max ? 'Restore' : 'Maximize'}
        >
          {max ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          onClick={() => window.axiroster.windowClose()}
          className="titlebar-btn hover:bg-red-600 hover:text-white"
          title="Close"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
