// src/renderer/src/lib/webClient/settings.ts
// Device-local settings for the web build. On web the desktop's encrypted-file
// SettingsStore becomes localStorage; only genuinely device-local settings live
// here (activeGuildId, lastSeenVersion). Storage is injectable for tests.
export interface WebSettings {
  get(key: string): string | null
  set(key: string, value: string): void
}

const PREFIX = 'axiroster:setting:'

export function createWebSettings(storage: Storage = globalThis.localStorage): WebSettings {
  return {
    get: (key) => storage.getItem(PREFIX + key),
    set: (key, value) => storage.setItem(PREFIX + key, value)
  }
}
