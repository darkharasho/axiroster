# Release Notes

Version v0.1.11 — June 26, 2026

## Fixes the "nothing syncs for officers" bug
Officers weren't receiving any synced data — manual links, notes, the member-role
anchor, or AxiBridge config — because the app queried the database a split second
before its login finished, so the server returned nothing. It now waits for login
first, so officers actually get the shared roster, links, and config.

NOTE: both the owner and officers should be on this version, and the owner should
open the app once so the guild config publishes.

## Revoked officers lose the cached data
When you revoke someone, their locally cached notes/links/roster are now cleared,
not just hidden.
