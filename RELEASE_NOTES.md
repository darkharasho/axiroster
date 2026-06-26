# Release Notes

Version v0.2.0 — June 26, 2026

## Guild-scoped navigation
Each guild is now its own space. Pick a guild in the sidebar and it expands into
Roster, Sharing, and Settings — everything you see belongs to that guild, so
running more than one guild no longer blurs together. Each guild shows your role
at a glance (Owner / Write / Read, or Local), and your Discord login plus app
updates moved into a settings cog at the bottom of the sidebar.

## What's New, in the app
After an update, AxiRoster now shows a "What's New" panel with the release notes
for the new version. You can reopen it anytime from the settings cog.

## Settings autosave
Editing a guild's connection now saves automatically — no more wondering whether
the Save button did anything. Notes, tags, account links, and Discord role changes
show a small confirmation toast when they save.

## Fewer AxiTools timeouts
Switching guilds or refreshing could kick off several roster rebuilds at once,
each hammering the AxiTools bot and stacking up timeouts. The roster now builds
once per change, so a slow bot is far less painful, and loading spinners were
added throughout so the app no longer looks frozen while it works.

## Fixes
The Sharing tab could show another guild's shared status on a guild that's
actually local — it now reflects only the guild you're looking at.
