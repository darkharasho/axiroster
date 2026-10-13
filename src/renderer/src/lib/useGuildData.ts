// The one way a guild view loads its data. A view mounts per guild (App keys
// it by guild id), so this only ever loads for one guild: once on mount, then
// in the background on the client events it names, coalesced by a trailing
// debounce. Only the latest request's result is applied, and nothing is
// applied after unmount — the two ways the previous guild's data used to land
// under the new one.
import { useCallback, useEffect, useRef, useState } from 'react'
import { client } from './client'
import { toast } from './toast'

export type GuildEvent = 'sync' | 'audit' | 'workspace'
export const EVENT_DEBOUNCE_MS = 200

const SUBSCRIBE: Record<GuildEvent, (cb: () => void) => () => void> = {
  sync: (cb) => client.onSyncChanged(cb),
  audit: (cb) => client.onAuditUpdated(cb),
  workspace: (cb) => client.onWorkspaceChanged(cb)
}

export interface GuildData<T> {
  data: T | null
  /** True until the first load settles (and again on a retry with no data). */
  loading: boolean
  /** A background reload is in flight; the data on screen stays. */
  refreshing: boolean
  /** Set only when there is no data to show. */
  error: unknown
  /** Resolves when this reload settles. Never rejects. */
  reload: () => Promise<void>
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function useGuildData<T>(
  load: () => Promise<T>,
  opts: { on?: GuildEvent[]; deps?: readonly unknown[] } = {}
): GuildData<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<unknown>(null)

  // Held in a ref so callers needn't memoise it, and so a new closure (fresh
  // filters, fresh props) is what the next request runs.
  const loadRef = useRef(load)
  loadRef.current = load
  const seq = useRef(0)
  const alive = useRef(false)
  const hasData = useRef(false)

  const run = useCallback((): Promise<void> => {
    const id = ++seq.current
    if (hasData.current) setRefreshing(true)
    const current = (): boolean => alive.current && id === seq.current
    return loadRef.current().then(
      (next) => {
        if (!current()) return
        hasData.current = true
        setData(next)
        setError(null)
        setLoading(false)
        setRefreshing(false)
      },
      (e: unknown) => {
        if (!current()) return
        if (hasData.current) toast(`Couldn't refresh: ${errorMessage(e)}`, 'error')
        else setError(e)
        setLoading(false)
        setRefreshing(false)
      }
    )
  }, [])

  const onKey = (opts.on ?? []).join(',')
  useEffect(() => {
    alive.current = true
    void run()
    let timer: ReturnType<typeof setTimeout> | null = null
    const kick = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void run()
      }, EVENT_DEBOUNCE_MS)
    }
    const offs = onKey ? (onKey.split(',') as GuildEvent[]).map((e) => SUBSCRIBE[e](kick)) : []
    return () => {
      alive.current = false
      if (timer) clearTimeout(timer)
      for (const off of offs) off()
    }
  }, [run, onKey])

  // A change in deps (a filter, a search) refetches in the background. The
  // mount's own load already covers the initial deps, so only a change counts.
  const depsKey = JSON.stringify(opts.deps ?? [])
  const lastDeps = useRef(depsKey)
  useEffect(() => {
    if (lastDeps.current === depsKey) return
    lastDeps.current = depsKey
    void run()
  }, [depsKey, run])

  const reload = useCallback((): Promise<void> => {
    if (!hasData.current) {
      setLoading(true)
      setError(null)
    }
    return run()
  }, [run])

  return { data, loading, refreshing, error, reload }
}
