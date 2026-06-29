# Release Notes

Version v0.6.0 — June 29, 2026

## Audit log + retention history now sync across officers

Both the **audit log** and **retention history** are now backed by a shared Supabase workspace. Multiple officers see the same data in real time — no more each person having their own local-only copy. The app backfills your existing local history on first connect, so nothing is lost.

## QoL Improvements

- Guild settings save now shows an error if the save actually failed (e.g. invalid API keys or permission issues), instead of silently doing nothing.
- Roster refresh surfaces failures — if the GW2 or Discord fetch errors out, you'll see a message rather than a stale roster with no explanation.

## Under the hood

- Pure roster/bridge/GW2 logic relocated to a shared module (internal refactor, no user-facing change).
- Groundwork for the companion web app (roster.axi.link).
