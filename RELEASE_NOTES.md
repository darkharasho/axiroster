# Release Notes

Version v1.1.7 — July 28, 2026

## Fixes

**Audit and retention history could silently fail to back up to the cloud on a workspace's first connect.**
If the one-time upload of your local GW2/Discord audit log and retention history failed right away (a network hiccup, a permissions error), it used to mark itself done anyway — so that history would never reach the shared cloud store, with nothing to tell you it was missing. It now only marks itself done once the upload is confirmed, so a failed attempt just retries on the next connect.

NOTE: this only prevents the problem going forward — a workspace that already hit this before today is still marked as migrated and won't automatically retry.
