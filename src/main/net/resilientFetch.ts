// Shared fetch wrapper: every client gets a request deadline so a slow or hung
// host can't wedge the UI. Retries are opt-in and apply ONLY to thrown
// network/timeout errors — an HTTP response (any status) is returned as-is so
// callers keep ownership of status handling.

export interface ResilientFetchOptions extends RequestInit {
  /** Per-attempt deadline. Default 10s. */
  timeoutMs?: number
  /** Extra attempts after the first. Default 0. Use >0 only for idempotent GETs. */
  retries?: number
  /** Backoff base; delay before attempt n is backoffBaseMs * 2^(n-1). Default 500. */
  backoffBaseMs?: number
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>
}

export class FetchTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`)
    this.name = 'FetchTimeoutError'
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function resilientFetch(
  url: string,
  opts: ResilientFetchOptions = {}
): Promise<Response> {
  const {
    timeoutMs = 10_000,
    retries = 0,
    backoffBaseMs = 500,
    sleep = defaultSleep,
    signal: callerSignal,
    ...init
  } = opts

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(backoffBaseMs * 2 ** (attempt - 1))
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal
    try {
      return await fetch(url, { ...init, signal })
    } catch (err) {
      if (callerSignal?.aborted) throw err
      lastError =
        err instanceof DOMException && err.name === 'TimeoutError'
          ? new FetchTimeoutError(url, timeoutMs)
          : err
    }
  }
  throw lastError
}
