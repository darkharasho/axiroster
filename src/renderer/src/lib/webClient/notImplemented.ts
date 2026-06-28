// src/renderer/src/lib/webClient/notImplemented.ts
// A loud placeholder for AxiClient methods a later 2b-3 slice will implement.
// Returns a function that throws, so the skeleton conforms to AxiClient without
// silently returning undefined.
export function notImplemented(name: string): (...args: never[]) => never {
  return () => {
    throw new Error(`${name}: not implemented on web yet`)
  }
}
