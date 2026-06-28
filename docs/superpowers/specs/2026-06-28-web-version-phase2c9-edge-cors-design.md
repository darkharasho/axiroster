# Web Version — Phase 2c-9: Edge Function CORS

**Date:** 2026-06-28
**Status:** Approved (sensible-defaults run)

## Problem
The Supabase Edge Functions were written for the Electron desktop app, which is
NOT subject to browser CORS. From the web build, the browser blocks every
function call (`axitools`, `refresh-roster`, `list-invites`, `respond-invite`,
…): the functions send no `Access-Control-Allow-Origin` header and don't answer
the preflight `OPTIONS` request. (Direct Supabase REST/auth/table calls work —
Supabase sends CORS on those; only our custom functions don't.)

## Fix
Add a shared CORS helper and apply it to **all 9 functions**:
`supabase/functions/_shared/cors.ts`:
```ts
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
}
/** Answer the browser's preflight; null for a real request. */
export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders }) : null
}
```

Per function `index.ts`:
1. `import { corsHeaders, preflight } from '../_shared/cors.ts'`.
2. First line inside `Deno.serve(async (req) => {`:
   `const pre = preflight(req); if (pre) return pre`.
3. Add `...corsHeaders` to the `headers` of **every** `Response` the function
   returns — success AND error paths. For a `json()` helper, merge `corsHeaders`
   into its headers (covers all callers); for inline `new Response(...)`, spread
   `...corsHeaders` alongside the existing `Content-Type`.

`Access-Control-Allow-Origin: *` is safe here: the functions authorize via the
Supabase JWT (`auth.getUser`), not the origin, and the anon key is public. (A
later hardening could restrict to `roster.axi.link`/localhost, but `*` is the
standard Supabase template and fine for now.)

## Gate
- `_shared/cors.ts` `preflight` is unit-tested (OPTIONS → 200 + CORS headers;
  POST → null). The `index.ts` edits are untested glue — verified by diff review.
- **Real-run (USER):** `supabase functions deploy` (all functions), then reload
  the web app — the CORS errors disappear and `list-invites`/`axitools`/
  `refresh-roster` return data.

## Out of scope
- Restricting the origin allowlist; any handler-logic change. CORS headers only.
