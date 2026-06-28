import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import logoUrl from '../assets/axiroster-logo.svg'
import { client } from '../lib/client'
import UpdatePill from './UpdatePill'

// Custom titlebar for the frameless window — consistent across macOS/Windows/Linux.
// The bar is the OS drag handle (.drag); the controls opt out (.no-drag).
export default function Titlebar(): JSX.Element {
  const [max, setMax] = useState(false)
  const [mac, setMac] = useState(false)
  const [version, setVersion] = useState('')

  useEffect(() => {
    client.windowIsMaximized().then(setMax)
    client.platform().then((p) => setMac(p === 'darwin'))
    client.appVersion().then(setVersion)
    return client.onWindowMaximized(setMax)
  }, [])

  return (
    <div className="drag flex h-9 shrink-0 select-none items-center justify-between border-b border-panel-line bg-panel">
      <div className={`flex items-center gap-2 px-3 text-xs font-semibold tracking-wide text-ink-dim`}>
        <img src={logoUrl} alt="" className="h-4 w-4" />
        <span className="text-ink">AxiRoster</span>
        {version && <span className="text-[11px] font-normal text-ink-faint">v{version}</span>}
      </div>
      <div className="flex h-full items-center">
        <UpdatePill />
        <div className="no-drag flex h-full">
          <button onClick={() => client.windowMinimize()} className="titlebar-btn" title="Minimize">
          <Minus size={14} />
        </button>
        <button
          onClick={async () => setMax(await client.windowMaximizeToggle())}
          className="titlebar-btn"
          title={max ? 'Restore' : 'Maximize'}
        >
          {max ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          onClick={() => client.windowClose()}
          className="titlebar-btn hover:bg-red-600 hover:text-white"
          title="Close"
        >
          <X size={15} />
        </button>
        </div>
      </div>
    </div>
  )
}
