/**
 * AxiTools keys are minted by the AxiTools bot per Discord server:
 *   axt1.<base64url(base URL, no padding)>.<secret>
 * The whole key is sent as the bearer token; the URL part tells us where the
 * bot's API lives, so users never configure an address by hand. AxiRoster reuses
 * the same key format AxiVale uses, so a guild's existing key works here too.
 */
export interface ParsedAxitoolsKey {
  baseUrl: string
  token: string
}

export function parseAxitoolsKey(raw: string): ParsedAxitoolsKey | null {
  const key = raw.trim()
  const parts = key.split('.')
  if (parts.length !== 3 || parts[0] !== 'axt1' || parts[2] === '') return null
  let decoded: string
  try {
    decoded = Buffer.from(parts[1], 'base64url').toString('utf-8')
  } catch {
    return null
  }
  let url: URL
  try {
    url = new URL(decoded)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return { baseUrl: decoded.replace(/\/+$/, ''), token: key }
}
