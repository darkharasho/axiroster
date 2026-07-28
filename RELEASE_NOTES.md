# Release Notes

Version v1.1.5 — July 27, 2026

## Fixes

**Guild Log entries could leak between guilds.**
A guild that hadn't claimed its own cloud workspace could quietly attach to a different guild's — pulling that guild's log history into the wrong place, and breaking that other guild's own log sync in the process. Guild data now only ever uses a workspace connection that actually matches that guild; otherwise it stays local.

**Switching guilds could stall log sync or leave stale rows on screen.**
An in-progress sync could still write its results into the guild you'd just switched away from, and the Log view could keep showing the previous guild's entries until new events came in. Both are fixed — switching guilds now stops the old sync cleanly and the log view refreshes immediately.

NOTE: If your guild's log history was ever affected by the bug above, it'll quietly repair itself the next time you open the app — this only runs once per guild and won't create duplicate entries.
