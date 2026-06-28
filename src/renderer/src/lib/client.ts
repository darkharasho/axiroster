// src/renderer/src/lib/client.ts
// The renderer's single data-layer seam. Components talk to `client`, a typed
// handle that forwards to whichever implementation was installed via setClient().
// Electron installs the bridge via setClient (see main.tsx); the web build (Phase 2b/2c)
// installs its own. The contract is identical to the preload bridge, so there is
// one source of truth and nothing to keep in sync.
import type { AxiRosterApi } from '../../../preload/index.d'

export type AxiClient = AxiRosterApi

let impl: AxiClient | null = null

/** Install the active implementation. Must run before any client.* call. */
export function setClient(c: AxiClient): void {
  impl = c
}

/** The active implementation, or throw if none is installed yet. */
export function getClient(): AxiClient {
  if (!impl) throw new Error('AxiClient not initialized — call setClient() first')
  return impl
}

/** Typed handle that forwards every access to the active implementation, so call
 *  sites read `client.foo(...)`. Resolves lazily per access (safe to import
 *  before setClient runs; only throws if a method is *called* before init). */
export const client: AxiClient = new Proxy({} as AxiClient, {
  get(_t, prop) {
    return Reflect.get(getClient() as object, prop)
  }
}) as AxiClient
