// src/renderer/src/lib/webClient/supabaseClient.ts
// The browser Supabase client. Unlike the desktop (persistSession:false, manual
// tokens), the web SPA persists the session in localStorage and auto-detects the
// OAuth callback in the URL — the standard Supabase browser setup.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function createBrowserSupabase(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  })
}
