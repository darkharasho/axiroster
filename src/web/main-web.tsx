import React from 'react'
import ReactDOM from 'react-dom/client'
import { setClient } from '../renderer/src/lib/client'
import { createWebClient } from '../renderer/src/lib/webClient/webClient'
import { createBrowserSupabase } from '../renderer/src/lib/webClient/supabaseClient'
import WebRoot from './WebRoot'
import { setWeb } from '../renderer/src/lib/runtime'
import '../renderer/src/index.css'

// Mark the runtime as web so renderer components hide Electron-only chrome
// (window controls, etc.).
setWeb(true)

// Web entry: install the browser AxiClient before the first render. The Supabase
// URL + anon key come from Vite env (VITE_SUPABASE_*); when absent the client
// runs signed-out (auth methods report "not configured" / signed-out) so the
// shell still loads for local smoke without secrets.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const supabase = url && anonKey ? createBrowserSupabase(url, anonKey) : undefined

setClient(createWebClient({ supabase }))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WebRoot />
  </React.StrictMode>
)
