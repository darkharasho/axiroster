# Release Notes

Version v1.1.6 — July 27, 2026

## Fixes

**Member notes and manual account links could sync into the wrong guild's workspace.**
Cloud sync could attach to a workspace that wasn't your active guild, and the one-time upload of existing local notes and links didn't check which guild they actually belonged to — so one guild's member notes and account links could end up visible to another guild's officers. Sync now only attaches to your actual active guild, and the upload only includes notes/links that resolve to that guild's own roster; anything it can't match stays local until you edit it (which still shares it normally).

**Retention history is now stored per guild.**
All guilds used to share one retention history file, so a guild's snapshots could ride along with another guild's cloud backfill. Each guild now keeps its own file, so that's no longer possible.

**Roster members from a previous guild could stick around after switching workspaces.**
Switching guilds didn't always clear members synced in from the one you just left, so they could keep appearing in the roster until you restarted the app. The synced roster now clears immediately on every guild switch and sign-out.
