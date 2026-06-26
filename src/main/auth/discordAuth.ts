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

export async function exchangeCode(
  client: SupabaseClient,
  code: string,
  verifier: string
): Promise<Session> {
  const { data, error } = await client.auth.exchangeCodeForSession(code)
  if (error || !data.session) throw new Error(error?.message ?? 'no session')
  void verifier
  return data.session
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

  /** Returns the URL to open in the system browser + the verifier to keep. */
  startSignIn(): { url: string; verifier: string } {
    return buildAuthUrl(this.supabaseUrl, this.redirectUri)
  }

  /** Called when the axiroster://auth-callback?code=... deep link fires. */
  async completeSignIn(code: string, verifier: string): Promise<Session> {
    const session = await exchangeCode(this.client, code, verifier)
    this.store.setSecret('discordSession', JSON.stringify(session))
    return session
  }

  async restoreSession(): Promise<Session | null> {
    const raw = this.store.getSecret('discordSession')
    if (!raw) return null
    const session = JSON.parse(raw) as Session
    const { data } = await this.client.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token
    })
    if (data.session) this.store.setSecret('discordSession', JSON.stringify(data.session))
    return data.session ?? null
  }

  signOut(): void {
    this.store.setSecret('discordSession', '')
  }

  authedClient(): SupabaseClient {
    return this.client
  }
}
