# Release Notes

Version v0.1.13 — June 26, 2026

## Live updates now actually arrive
Edits made by other officers (notes, tags, links, roster changes) now show up
live again — including while you're viewing a single member. The realtime
connection was logging in for the first data load but not for the ongoing change
stream, so the database was silently dropping every live update. It now
authenticates the realtime stream too, so changes propagate in real time across
everyone in the workspace.

NOTE: everyone in the workspace should be on v0.1.13 for live sync to work.
