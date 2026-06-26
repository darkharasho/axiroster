import { createHash, randomBytes } from 'crypto'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import type { SettingsStore } from '../secrets'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function buildAuthUrl(
  supabaseUrl: string,
  redirectUri: string
): { url: string; verifier: string } {
  const verifier = base64url(randomBytes(48))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const params = new URLSearchParams({
    provider: 'discord',
    redirect_to: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  })
  return { url: `${supabaseUrl}/auth/v1/authorize?${params.toString()}`, verifier }
}

export interface PkceTokens {
  access_token: string
  refresh_token: string
  expires_in?: number
  token_type?: string
}

export async function exchangeCode(
  supabaseUrl: string,
  anonKey: string,
  code: string,
  verifier: string,
  fetchFn: typeof fetch = fetch
): Promise<PkceTokens> {
  const resp = await fetchFn(`${supabaseUrl}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`
    },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier })
  })
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>
  if (!resp.ok) {
    throw new Error(
      (data.error_description as string) ?? (data.msg as string) ?? `token exchange failed (HTTP ${resp.status})`
    )
  }
  if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
    throw new Error('token exchange returned no session')
  }
  return data as unknown as PkceTokens
}

export class DiscordAuth {
  private client: SupabaseClient
  constructor(
    private readonly supabaseUrl: string,
    private readonly anonKey: string,
    private readonly store: SettingsStore,
    private readonly redirectUri = 'axiroster://auth-callback'
  ) {
    this.client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, flowType: 'pkce' }
    })
  }

  /** Returns the URL to open in the system browser + the verifier to keep.
   *  Pass a redirect target (e.g. a loopback http://127.0.0.1:<port> URL);
   *  defaults to the configured custom-scheme URI. */
  startSignIn(redirectTo: string = this.redirectUri): { url: string; verifier: string } {
    return buildAuthUrl(this.supabaseUrl, redirectTo)
  }

  /** Called when the axiroster://auth-callback?code=... deep link fires. */
  async completeSignIn(code: string, verifier: string): Promise<Session> {
    const tokens = await exchangeCode(this.supabaseUrl, this.anonKey, code, verifier)
    const { data, error } = await this.client.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token
    })
    if (error || !data.session) throw new Error(error?.message ?? 'failed to hydrate session')
    this.store.setSecret('discordSession', JSON.stringify(data.session))
    return data.session
  }

  async restoreSession(): Promise<Session | null> {
    const raw = this.store.getSecret('discordSession')
    if (!raw) return null
    try {
      const session = JSON.parse(raw) as Session
      const { data, error } = await this.client.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token
      })
      if (error || !data.session) {
        await this.signOut()
        return null
      }
      this.store.setSecret('discordSession', JSON.stringify(data.session))
      return data.session
    } catch {
      await this.signOut()
      return null
    }
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut().catch(() => {})
    this.store.setSecret('discordSession', '')
  }

  authedClient(): SupabaseClient {
    return this.client
  }
}
