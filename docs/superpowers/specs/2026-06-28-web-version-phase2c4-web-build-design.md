# Web Version — Phase 2c-4: Runnable Web Build + Entry

**Date:** 2026-06-28
**Status:** Approved (sensible-defaults run)

## Goal
A minimal standalone Vite **web build** of the existing renderer that installs the
`WebAxiClient` and runs in a browser — so the auth + Discord/GW2 methods can be
verified against live Supabase. Reuses the same `App` and components (they already
talk to the injected `client` seam); only the entry + build wiring is new.

## Files (all new except the tsconfig/package edits)
- `src/web/index.html` — web document; loads `./main-web.tsx`.
- `src/web/main-web.tsx` — entry: builds a browser Supabase client from
  `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (undefined when
  absent → client runs signed-out), `setClient(createWebClient({ supabase }))`,
  then renders `<App/>` (imported from `../renderer/src/App`) with `index.css`.
- `vite.web.config.ts` — standalone Vite config: `root: src/web`,
  `@vitejs/plugin-react`, build to `dist-web/`, dev server on port 5293. (No
  `@renderer` alias needed — the renderer uses relative imports. Tailwind/PostCSS
  are picked up from the repo-root configs.)
- `tsconfig.web.json` — add `src/web/**/*` to `include` so the entry typechecks.
- `package.json` — `dev:web` (`vite --config vite.web.config.ts`) and `build:web`
  (`vite build --config vite.web.config.ts`).
- `.env.web.example` — documents the two `VITE_SUPABASE_*` vars.

## Decisions (sensible defaults, flagged)
- Standalone `vite.web.config.ts` (not electron-vite) — the web build is a plain
  SPA. [DECISION]
- Env via Vite `VITE_*` vars; the **same** Supabase URL/anon key the desktop uses
  (public anon key — safe in a client). User supplies real values in `.env` on
  their run. [DECISION]
- Output `dist-web/` — what Cloudflare Pages will deploy (2c-5). [DECISION]
- No What's New / auto-update on web (already stubbed in the client).

## Gate
- `npm run build:web` succeeds (bundles the whole renderer headlessly — catches
  import/resolution problems) AND `npm run typecheck` clean.
- **Real-run (user):** `VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… npm run dev:web`,
  open `http://localhost:5293`, sign in with Discord, confirm the roster shell
  loads and `authStatus` resolves the workspace.

## Out of scope
- The Cloudflare Pages deploy + `roster.axi.link` (2c-5, uses the `cloudflare` skill).
- The not-yet-implemented data methods (roster/members/CRUD/invites still throw
  `notImplemented` — the shell renders; those panels error until later slices).
