import { createHash, randomBytes } from 'crypto'
import {
  createClient,
  isAuthApiError,
  isAuthRetryableFetchError,
  type Session,
  type SupabaseClient
} from '@supabase/supabase-js'
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

/** Errors worth retrying rather than signing out over. */
export function isTransientAuthError(error: unknown): boolean {
  if (!error) return false
  if (isAuthRetryableFetchError(error)) return true
  if (isAuthApiError(error)) return error.status === 429 || error.status >= 500
  // Anything that isn't a Supabase auth error (fetch threw, DNS, …) is a
  // transport problem, not a verdict on the session.
  return !(error && typeof error === 'object' && '__isAuthError' in error)
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
      auth: { persistSession: false, autoRefreshToken: true, flowType: 'pkce' }
    })
    // We disable supabase-js's own storage (persistSession: false) so it never
    // touches localStorage in the main process — but that means we own keeping
    // the stored session current. autoRefreshToken rotates the access/refresh
    // tokens in the background; persist each rotation so a relaunch restores the
    // *latest* refresh token (a stale one would be rejected → spurious logout).
    this.client.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN')) {
        this.store.setSecret('discordSession', JSON.stringify(session))
      }
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

  /** True when the last restore couldn't reach Supabase — the stored session
   *  is kept and the user is still signed in, just offline for now. */
  unreachable = false

  async restoreSession(): Promise<Session | null> {
    this.unreachable = false
    // Already hydrated: autoRefreshToken keeps the in-memory session current.
    // Re-sending the stored tokens on every status check raced those refreshes.
    const live = await this.client.auth.getSession()
    if (live.data.session) return live.data.session
    if (live.error) return this.failRestore(live.error)

    const raw = this.store.getSecret('discordSession')
    if (!raw) return null
    let stored: Session
    try {
      stored = JSON.parse(raw) as Session
    } catch {
      await this.signOut() // unreadable — nothing to retry with
      return null
    }
    const { data, error } = await this.client.auth
      .setSession({ access_token: stored.access_token, refresh_token: stored.refresh_token })
      .catch((e: unknown) => ({ data: { session: null }, error: e }))
    if (error || !data.session) return this.failRestore(error)
    this.store.setSecret('discordSession', JSON.stringify(data.session))
    return data.session
  }

  /** Sign out only when Supabase rejected the session. A network failure, rate
   *  limit or server error keeps the stored session for the next attempt —
   *  wiping it there logged people out over a blip (e.g. waking from sleep). */
  private async failRestore(error: unknown): Promise<null> {
    if (isTransientAuthError(error)) {
      this.unreachable = true
      return null
    }
    await this.signOut()
    return null
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut().catch(() => {})
    this.store.setSecret('discordSession', '')
  }

  authedClient(): SupabaseClient {
    return this.client
  }
}
