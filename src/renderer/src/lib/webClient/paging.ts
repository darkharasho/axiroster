// src/renderer/src/lib/webClient/paging.ts
//
// PostgREST caps every read at max_rows (1000, supabase/config.toml). Tables that
// can outgrow that are read page by page; `page` must apply a stable ORDER BY
// on a unique key so pages don't overlap or skip rows.
export const PAGE_SIZE = 1000

type PageResult = { data: unknown[] | null; error: unknown }

/** Every row across pages, or `{ error }` from the first failing page. */
export async function fetchAllPages<T = Record<string, unknown>>(
  page: (from: number, to: number) => PromiseLike<PageResult>
): Promise<{ data: T[]; error: unknown }> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) return { data: out, error }
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE_SIZE) return { data: out, error: null }
  }
}
