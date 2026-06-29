# Release Notes

Version v1.0.0 — June 29, 2026

## AxiRoster 1.0 🎉

The first stable release. AxiRoster is a complete WvW guild roster manager for Guild Wars 2 leadership — and as of 1.0 it runs both as a desktop app and in your browser at [roster.axi.link](https://roster.axi.link).

## Highlights

- **Now on the web.** Everything you do in the desktop app — sign in with Discord, view and manage your roster, audit log, and retention history — now works in the browser too, backed by the same shared workspace. Desktop and web stay in lockstep at version 1.0.
- **Shared workspace for your whole team.** Audit log and retention history sync across officers in real time through a shared Supabase workspace. Everyone sees the same data; your existing local history is backfilled on first connect.
- **Roster management built for guild leads.** Pull your roster from the GW2 API and Discord, track who's active, and keep leadership on the same page.
- **AxiOM ready.** AxiRoster now ships in the AxiOM launcher alongside the rest of the Axi suite — install and update it in one click.

## QoL Improvements

- Guild settings save surfaces real errors (invalid API keys, permission issues) instead of silently doing nothing.
- Roster refresh reports GW2/Discord fetch failures instead of leaving a stale roster with no explanation.

## Under the hood

- Core roster/bridge/GW2 logic lives in a shared module powering both desktop and web from one codebase.

---

Version v0.6.0 — June 29, 2026

## Audit log + retention history now sync across officers

Both the **audit log** and **retention history** are now backed by a shared Supabase workspace. Multiple officers see the same data in real time — no more each person having their own local-only copy. The app backfills your existing local history on first connect, so nothing is lost.

## QoL Improvements

- Guild settings save now shows an error if the save actually failed (e.g. invalid API keys or permission issues), instead of silently doing nothing.
- Roster refresh surfaces failures — if the GW2 or Discord fetch errors out, you'll see a message rather than a stale roster with no explanation.

## Under the hood

- Pure roster/bridge/GW2 logic relocated to a shared module (internal refactor, no user-facing change).
- Groundwork for the companion web app (roster.axi.link).
