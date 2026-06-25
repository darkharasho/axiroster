import type { DiscordRole } from '../../../preload/index.d'

// Presentation for Discord roles. Lives in the renderer (not main) so tweaking
// colors/icons hot-reloads — the raw role fields are already in the payload.

/** Normalized hex color for a role, or null for "no color" (default role). */
export function roleColor(role: DiscordRole | undefined): string | null {
  if (!role) return null
  const raw = role.colorRaw
  let hex: string | null = null
  if (typeof raw === 'number' && raw > 0) {
    hex = `#${raw.toString(16).padStart(6, '0')}`
  } else if (typeof raw === 'string' && /^#?[0-9a-f]{6}$/i.test(raw)) {
    hex = raw.startsWith('#') ? raw : `#${raw}`
  }
  // Discord color 0 / #000000 means "no color" (default role) — not black.
  if (hex && /^#0{6}$/i.test(hex)) hex = null
  return hex
}

/** A role glyph: unicode emoji, a custom-icon CDN url, or null. */
export function roleIcon(role: DiscordRole | undefined): string | null {
  if (!role) return null
  if (role.emoji) return role.emoji
  if (role.iconHash) return `https://cdn.discordapp.com/role-icons/${role.id}/${role.iconHash}.png`
  return null
}
