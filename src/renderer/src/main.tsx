import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { setClient } from './lib/client'
import { applyTheme, readAccent } from './themes/applyTheme'
import '@axiapps/axi-design/axi.css'
import '@axiapps/axi-design/accents.css'
import './index.css'

// Electron: the data-layer client is the preload bridge. The web build installs
// its own implementation at its own entry point (Phase 2b/2c).
setClient(window.axiroster)

// Put the remembered accent on <html> before the first render.
applyTheme(readAccent())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
