# AxiRoster

A dedicated **Guild Wars 2 WvW guild roster management** desktop app for guild
leadership. Electron + Vite + React + Tailwind. Inspired by AxiVale's roster
feature, but built as a focused, robust, shareable roster tool.

## What it does

- **Auto-pull GW2 guilds** — add a GW2 API key, pick your guild from a dropdown.
- **Auto-pull Discord rosters** — connect your guild's AxiTools bot (`axt1.…`
  key) to load Discord members + their linked GW2 accounts.
- **Reconcile identities** — folds in-game GW2 accounts, Discord members, manual
  links, and auto-links into one row per person (see `rosterReconcile.ts`).
- **Annotate** — nicknames, tags, freeform notes, manual Discord↔GW2 links.
- **WvW activity** — overlays AxiBridge combat reports (main class, class spread,
  raid attendance, time in raids, last seen).
- **Discord management** — role changes and member actions via AxiTools.
- **Shared sync** — leadership share one workspace; tags/notes/links sync live
  across officers (Supabase-backed, see [docs/SUPABASE.md](docs/SUPABASE.md)).

## Architecture

```
src/
  main/                Electron main process
    index.ts           window + IPC handlers + roster orchestration + sync wiring
    secrets.ts         encrypted settings + keyrings (gw2 / axitools)
    gw2Client.ts       GW2 API (account, guilds, members)
    axitoolsClient.ts  Discord via the AxiTools bot HTTP API
    axibridgeClient.ts WvW report metrics (read-only from GitHub)
    rosterStore.ts     local annotations (tags/notes/nickname) — synced mirror
    linkStore.ts       local manual Discord↔GW2 links — synced mirror
    rosterReconcile.ts pure identity-merge function
    sync/              SyncProvider seam (LocalSyncProvider + SupabaseSyncProvider)
  preload/             typed contextBridge surface (window.axiroster)
  renderer/            React + Tailwind UI (roster list, member detail, settings)
```

**Sync is local-first.** All edits write to local JSON immediately and always
work offline; when a workspace is configured, the `SyncProvider` mirrors them to
Supabase and streams remote changes back. The backend is swappable behind the
`SyncProvider` interface — nothing in the renderer or IPC layer imports Supabase.

## Develop

```bash
npm install
npm run dev          # electron-vite dev (renderer on :5293)
npm run typecheck
npm run build        # production build into out/
npm run dist:mac     # package (also :win, :linux)
```

## Status

Scaffold + vertical slice complete: GW2 guild pull, Discord roster pull,
reconcile, annotations/links UI, AxiBridge metrics overlay, and the Supabase
sync seam. See open work in the project plan.
