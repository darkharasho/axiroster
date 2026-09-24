import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import logoUrl from '../assets/axiroster-logo.svg'
import { client } from '../lib/client'
import { isWeb } from '../lib/runtime'
import UpdatePill from './UpdatePill'
import WebAccountMenu from './WebAccountMenu'

// Custom titlebar for the frameless window — consistent across macOS/Windows/Linux.
// .axi-titlebar is the OS drag handle (the class carries -webkit-app-region:
// drag); .axi-titlebar__btns opts back out.
export default function Titlebar(): JSX.Element {
  const [max, setMax] = useState(false)
  const [version, setVersion] = useState('')

  useEffect(() => {
    client.windowIsMaximized().then(setMax)
    client.appVersion().then(setVersion)
    return client.onWindowMaximized(setMax)
  }, [])

  return (
    <div className="axi-titlebar">
      <span
        className="ar-brandmark h-4 w-4"
        style={{ '--ar-mark': `url(${logoUrl})` } as React.CSSProperties}
      />
      <span className="ar-ink">
        Axi<span className="ar-ink-accent">Roster</span>
      </span>
      {version && <span>v{version}</span>}

      {/* Kept out of .axi-titlebar__btns: that block's last child gets the
          destructive hover, which belongs to Close and nothing else. */}
      <div className="ar-titlebar__aux no-drag flex h-full items-center gap-2 pr-2">
        <UpdatePill />
        {isWeb() && <WebAccountMenu />}
      </div>

      {/* Window controls are Electron-only; the browser provides its own chrome. */}
      {!isWeb() && (
        <div className="axi-titlebar__btns">
          <button onClick={() => client.windowMinimize()} title="Minimize">
            <Minus size={14} />
          </button>
          <button
            onClick={async () => setMax(await client.windowMaximizeToggle())}
            title={max ? 'Restore' : 'Maximize'}
          >
            {max ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button onClick={() => client.windowClose()} title="Close">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
