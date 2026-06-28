// supabase/functions/_shared/axivaleKey.ts
// AxiTools keys are minted per Discord server as:
//   axt1.<base64url(base URL, no padding)>.<secret>
// The whole key is sent as the bearer token; the middle part decodes to the
// bot's API base URL. Deno + Node safe (atob/TextDecoder; no Node Buffer).
// Port of src/main/axivaleKey.ts.
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
    decoded = b64urlToUtf8(parts[1])
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

function b64urlToUtf8(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad) // throws on invalid base64 chars
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}
