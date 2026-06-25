import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs'
import { dirname } from 'path'

// Encrypted blobs (base64 of cipher bytes). The full set of guild profiles —
// each carrying its GW2 + AxiTools keys — lives in the 'guilds' secret.
export type SecretKey = 'guilds' | 'syncToken'

export type SettingKey =
  /** The selected guild profile (see GuildStore). Each profile bundles its own
   *  GW2 key+guild and AxiTools key+server — the roster reads from the active one. */
  | 'activeGuildId'
  // Sync (Supabase-backed shared workspace)
  | 'syncEnabled'
  | 'syncUrl'
  | 'syncAnonKey'
  | 'syncWorkspaceId'
  | 'syncRole'
  // UI
  | 'windowBounds'

export interface Cipher {
  encrypt(plain: string): Buffer
  decrypt(encrypted: Buffer): string
}

interface FileShape {
  secrets: Partial<Record<SecretKey, string>> // base64 of encrypted bytes
  settings: Partial<Record<SettingKey, string>>
}

export class SettingsStore {
  constructor(
    private readonly path: string,
    private readonly cipher: Cipher
  ) {}

  private read(): FileShape {
    if (!existsSync(this.path)) return { secrets: {}, settings: {} }
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as FileShape
    } catch {
      // Corrupt/truncated file (interrupted write, manual edit): start fresh
      // rather than wedging every settings access.
      return { secrets: {}, settings: {} }
    }
  }

  private write(data: FileShape): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(data, null, 2), { mode: 0o600 })
    chmodSync(this.path, 0o600)
  }

  setSecret(key: SecretKey, value: string): void {
    const data = this.read()
    data.secrets[key] = this.cipher.encrypt(value).toString('base64')
    this.write(data)
  }

  getSecret(key: SecretKey): string | null {
    const stored = this.read().secrets[key]
    if (!stored) return null
    return this.cipher.decrypt(Buffer.from(stored, 'base64'))
  }

  setSetting(key: SettingKey, value: string): void {
    const data = this.read()
    data.settings[key] = value
    this.write(data)
  }

  getSetting(key: SettingKey): string | null {
    return this.read().settings[key] ?? null
  }
}

/** Production cipher backed by Electron safeStorage. Imported lazily so tooling
 *  (plain node) never loads the electron module. */
export async function electronCipher(): Promise<Cipher> {
  const { safeStorage } = await import('electron')
  return {
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (buf) => safeStorage.decryptString(buf)
  }
}
