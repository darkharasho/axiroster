// supabase/functions/_shared/crypto.ts
// AES-GCM via WebCrypto. `secret` is base64 of 32 raw bytes. Payload is
// base64(iv).base64(ciphertext).
function b64ToBytes(b: string): Uint8Array { return Uint8Array.from(atob(b), (c) => c.charCodeAt(0)) }
function bytesToB64(u: Uint8Array): string { return btoa(String.fromCharCode(...u)) }

async function importKey(base64Secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64ToBytes(base64Secret), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptKey(plain: string, base64Secret: string): Promise<string> {
  const key = await importKey(base64Secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)))
  return `${bytesToB64(iv)}.${bytesToB64(ct)}`
}

export async function decryptKey(payload: string, base64Secret: string): Promise<string> {
  const [ivB64, ctB64] = payload.split('.')
  const key = await importKey(base64Secret)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(ivB64) }, key, b64ToBytes(ctB64))
  return new TextDecoder().decode(pt)
}
