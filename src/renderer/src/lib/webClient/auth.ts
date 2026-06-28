// src/renderer/src/lib/webClient/auth.ts
// Web auth, mirroring the desktop auth:status / effectiveWorkspace flow but with
// a browser OAuth redirect. Helpers take an injected SupabaseClient for testing.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthStatus, AuthSignInResult } from '../../../../preload/index.d'
import type { WebSettings } from './settings'

export async function resolveEffectiveWorkspace(
  sb: SupabaseClient,
  settings: WebSettings,
  userId: string
): Promise<{ workspaceId: string; role: string } | null> {
  const { data } = await sb
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', userId)
  const memberships = (data ?? []) as { workspace_id: string; role: string }[]
  if (memberships.length === 0) return null
  const active = settings.get('activeGuildId')
  const chosen = (active && memberships.find((m) => m.workspace_id === active)) || memberships[0]
  return { workspaceId: String(chosen.workspace_id), role: String(chosen.role) }
}

export async function webAuthStatus(sb: SupabaseClient, settings: WebSettings): Promise<AuthStatus> {
  try {
    const {
      data: { session }
    } = await sb.auth.getSession()
    if (!session) return { signedIn: false }
    const {
      data: { user }
    } = await sb.auth.getUser()
    const userId = user?.id
    if (!userId) return { signedIn: false }
    let ws: { workspaceId: string; role: string } | null = null
    try {
      ws = await resolveEffectiveWorkspace(sb, settings, userId)
    } catch {
      ws = null // a transient membership read shouldn't crash auth; degrade to no-workspace
    }
    return { signedIn: true, role: ws?.role, workspaceId: ws?.workspaceId, userId }
  } catch {
    return { signedIn: false }
  }
}

export async function webSignIn(
  sb: SupabaseClient,
  redirectTo: string
): Promise<AuthSignInResult | null> {
  // Browser OAuth: this navigates the page away; the post-redirect load resolves
  // status via webAuthStatus, so there is no synchronous result to return.
  await sb.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo } })
  return null
}

export async function webSignOut(sb: SupabaseClient): Promise<void> {
  await sb.auth.signOut()
}
