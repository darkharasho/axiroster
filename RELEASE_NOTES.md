# Release Notes

Version v0.1.12 — June 26, 2026

## Read-only members can no longer edit
Members with **read** access now see the roster in a true view-only state. Nicknames,
tags, notes, manual GW2↔Discord links, "set main account", and Discord role/kick
controls are all disabled or hidden for them, and a "Read-only" banner explains why.
Write members and the owner are unaffected.

## Live updates and revoke
Read members now refresh live as write members make changes, and the read-only
state re-applies immediately when the owner changes someone's role. Combined with
the v0.1.11 sync fix, edits propagate across the workspace and revoked users are
dropped without a restart.

NOTE: everyone in the workspace should be on v0.1.12 (or at least v0.1.11) for
sync and revoke to behave correctly.
