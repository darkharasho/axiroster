import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs'
import { dirname } from 'path'

export type SecretKey = 'gw2Keys' | 'axitoolsKeys' | 'syncToken'

export type SettingKey =
  // GW2
  | 'gw2ActiveKey'
  | 'gw2GuildId'
  | 'gw2GuildName'
  | 'gw2AccountName'
  // AxiTools / Discord
  | 'axitoolsActiveKey'
  | 'discordGuildId'
  | 'discordGuildName'
  /** JSON map of Discord guild id -> guild-member role id; anchors the reconciled
   *  roster per server (each connected server has its own roles). */
  | 'discordMemberRoleByGuild'
  // AxiBridge (WvW combat reports published to GitHub)
  | 'axibridgeRepos'
  // Sync (Supabase-backed shared workspace)
  | 'syncEnabled'
  | 'syncUrl'
  | 'syncAnonKey'
  | 'syncWorkspaceId'
  | 'syncRole'
  // UI
  | 'windowBounds'

/** Services that hold a ring of labeled keys with one active. */
export type KeyService = 'gw2' | 'axitools'

/** Resolved identity for a key (e.g. the Discord server an AxiTools key binds to),
 *  cached so the keyring can show which server/account each key talks to. */
export interface KeyMeta {
  name?: string
  id?: string
}

export interface KeyLabel {
  label: string
  active: boolean
  meta?: KeyMeta
}

interface StoredKey {
  label: string
  key: string
  meta?: KeyMeta
}

const RING_SECRET: Record<KeyService, SecretKey> = {
  gw2: 'gw2Keys',
  axitools: 'axitoolsKeys'
}
const ACTIVE_SETTING: Record<KeyService, SettingKey> = {
  gw2: 'gw2ActiveKey',
  axitools: 'axitoolsActiveKey'
}

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

  // --- keyrings: labeled keys per service, one active ---------------------

  private readRing(service: KeyService): StoredKey[] {
    const raw = this.getSecret(RING_SECRET[service])
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as StoredKey[]
        if (Array.isArray(parsed)) return parsed
      } catch {
        // fall through to empty
      }
    }
    return []
  }

  private writeRing(service: KeyService, ring: StoredKey[]): void {
    this.setSecret(RING_SECRET[service], JSON.stringify(ring))
  }

  private activeLabel(service: KeyService, ring: StoredKey[]): string | null {
    const wanted = this.getSetting(ACTIVE_SETTING[service])
    if (wanted && ring.some((k) => k.label === wanted)) return wanted
    return ring[0]?.label ?? null
  }

  getActiveLabel(service: KeyService): string | null {
    return this.activeLabel(service, this.readRing(service))
  }

  listKeyLabels(service: KeyService): KeyLabel[] {
    const ring = this.readRing(service)
    const active = this.activeLabel(service, ring)
    return ring.map((k) => ({ label: k.label, active: k.label === active, meta: k.meta }))
  }

  addKey(service: KeyService, label: string, key: string): void {
    // Re-adding an existing label replaces its key; carry no stale meta forward.
    const ring = this.readRing(service).filter((k) => k.label !== label)
    ring.push({ label, key })
    this.writeRing(service, ring)
  }

  removeKey(service: KeyService, label: string): void {
    const ring = this.readRing(service).filter((k) => k.label !== label)
    this.writeRing(service, ring)
    if (this.getSetting(ACTIVE_SETTING[service]) === label) {
      const next = ring[0]?.label
      this.setSetting(ACTIVE_SETTING[service], next ?? '')
    }
  }

  setActiveKey(service: KeyService, label: string): void {
    this.setSetting(ACTIVE_SETTING[service], label)
  }

  setKeyMeta(service: KeyService, label: string, meta: KeyMeta): void {
    const ring = this.readRing(service)
    const entry = ring.find((k) => k.label === label)
    if (!entry) return
    entry.meta = meta
    this.writeRing(service, ring)
  }

  /** The active key's material — for main-process consumers only. */
  getActiveKey(service: KeyService): string | null {
    const ring = this.readRing(service)
    const active = this.activeLabel(service, ring)
    return ring.find((k) => k.label === active)?.key ?? null
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
