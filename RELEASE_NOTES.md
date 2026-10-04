# Release Notes

Version v1.4.1 — October 4, 2026

## Fixes
- Fixed the recruitment pipeline and its comments bleeding between guilds when you switch guilds. Your board could briefly end up in the wrong guild's workspace, or the old guild's comments could land in the new guild's data. Switching now cleanly detaches from the old guild first.
- Retention and Recruitment toggles now follow the workspace owner. Members see the owner's settings live, so the window refreshes right away instead of waiting for a restart. Only owners can flip the toggles (desktop and web); members see a note explaining why.
- Fixed Settings looking up the wrong role when checking who can change those toggles.

NOTE: If a guild already has stray pipeline cards or comments from a past switch, the sync cleans up leftovers that also live in another guild's data, but it won't touch anything unique to that guild.
