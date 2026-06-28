// src/renderer/src/lib/webClient/crud.ts
// Direct Supabase CRUD for the roster: the tag registry (a reserved meta:tags
// annotation row), member annotations (notes/tags/nickname/etc., with the
// desktop's merge+prune), and account links. No Edge Functions — direct tables.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RosterAnnotation, RosterAnnotationPatch, RosterLink } from '../../../../preload/index.d'
import type { WebSettings } from './settings'
import { activeWorkspaceId } from './discordGw2'

const ANN = 'roster_annotations'
const LINK = 'roster_links'
const TAGS_KEY = 'meta:tags'
const now = (): string => new Date().toISOString()

function cleanList(xs: unknown): string[] {
  if (!Array.isArray(xs)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs) {
    const s = String(x).trim()
    if (s && !seen.has(s)) {
      seen.add(s)
      out.push(s)
    }
  }
  return out
}

function isEmpty(a: RosterAnnotation): boolean {
  return (
    !a.nickname.trim() &&
    a.aliases.length === 0 &&
    !a.notes.trim() &&
    a.tags.length === 0 &&
    !a.mainAccount.trim()
  )
}

function annRowToAnnotation(r: Record<string, unknown> | null, memberId: string): RosterAnnotation {
  return {
    memberId,
    nickname: typeof r?.nickname === 'string' ? r.nickname : '',
    aliases: Array.isArray(r?.aliases) ? (r!.aliases as string[]) : [],
    notes: typeof r?.notes === 'string' ? r.notes : '',
    tags: Array.isArray(r?.tags) ? (r!.tags as string[]) : [],
    mainAccount: typeof r?.main_account === 'string' ? r.main_account : '',
    createdAt: typeof r?.created_at === 'string' ? r.created_at : now(),
    updatedAt: typeof r?.updated_at === 'string' ? r.updated_at : now()
  }
}

function annotationToRow(ws: string, a: RosterAnnotation): Record<string, unknown> {
  return {
    workspace_id: ws,
    member_id: a.memberId,
    nickname: a.nickname,
    aliases: a.aliases,
    notes: a.notes,
    tags: a.tags,
    main_account: a.mainAccount,
    created_at: a.createdAt,
    updated_at: a.updatedAt
  }
}

export async function webGetTagRegistry(
  sb: SupabaseClient,
  settings: WebSettings
): Promise<Record<string, string>> {
  try {
    const ws = await activeWorkspaceId(sb, settings)
    if (!ws) return {}
    const { data } = await sb
      .from(ANN)
      .select('notes')
      .eq('workspace_id', ws)
      .eq('member_id', TAGS_KEY)
      .maybeSingle()
    const notes = (data as { notes?: unknown } | null)?.notes
    if (typeof notes !== 'string') return {}
    const m = JSON.parse(notes)
    return m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export async function webSetTagRegistry(
  sb: SupabaseClient,
  settings: WebSettings,
  map: Record<string, string>
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  await sb.from(ANN).upsert(
    { workspace_id: ws, member_id: TAGS_KEY, notes: JSON.stringify(map ?? {}), updated_at: now() },
    { onConflict: 'workspace_id,member_id' }
  )
}

export async function webUpsertAnnotation(
  sb: SupabaseClient,
  settings: WebSettings,
  memberId: string,
  patch: RosterAnnotationPatch
): Promise<RosterAnnotation | null> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return null
  const { data } = await sb.from(ANN).select('*').eq('workspace_id', ws).eq('member_id', memberId).maybeSingle()
  const rec = annRowToAnnotation((data ?? null) as Record<string, unknown> | null, memberId)
  if (patch.nickname !== undefined) rec.nickname = patch.nickname.trim()
  if (patch.aliases !== undefined) rec.aliases = cleanList(patch.aliases)
  if (patch.notes !== undefined) rec.notes = patch.notes
  if (patch.tags !== undefined) rec.tags = cleanList(patch.tags)
  if (patch.mainAccount !== undefined) rec.mainAccount = patch.mainAccount.trim()
  rec.updatedAt = now()
  if (isEmpty(rec)) {
    await sb.from(ANN).delete().eq('workspace_id', ws).eq('member_id', memberId)
    return null
  }
  await sb.from(ANN).upsert(annotationToRow(ws, rec), { onConflict: 'workspace_id,member_id' })
  return rec
}

export async function webRemoveAnnotation(
  sb: SupabaseClient,
  settings: WebSettings,
  memberId: string
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  await sb.from(ANN).delete().eq('workspace_id', ws).eq('member_id', memberId)
}

export async function webSetLink(
  sb: SupabaseClient,
  settings: WebSettings,
  accountName: string,
  memberId: string
): Promise<RosterLink> {
  const createdAt = now()
  const ws = await activeWorkspaceId(sb, settings)
  if (ws) {
    await sb.from(LINK).upsert(
      { workspace_id: ws, account_name: accountName, member_id: memberId, created_at: createdAt },
      { onConflict: 'workspace_id,account_name' }
    )
  }
  return { accountName, memberId, createdAt }
}

export async function webRemoveLink(
  sb: SupabaseClient,
  settings: WebSettings,
  accountName: string
): Promise<void> {
  const ws = await activeWorkspaceId(sb, settings)
  if (!ws) return
  await sb.from(LINK).delete().eq('workspace_id', ws).eq('account_name', accountName)
}
