# Release Notes

Version v1.1.2 — June 30, 2026

## Improvements

**Retention and Recruitment toggles now sync to everyone.**
If an owner or write member enables (or disables) Retention Radar or the Recruitment pipeline for a shared guild, all other members will see that change on desktop within about 20 seconds and on web on next load. Previously, a member who joined a shared guild or had a flag toggled on their behalf might never see the Retention tab — or would have to sign out and back in to pick it up.

**Guild Log (audit log) is more readable.**
Every audit row now shows a clear action verb (e.g. "kicked", "updated", "created"), a cleanly-formatted actor name, and resolved `#channel` names instead of raw Discord IDs. Old rows stored before this release display gracefully with whatever data was saved.

NOTE: The richest audit data (structured fields) requires the AxiTools bot to be redeployed on your server. Without it, the improvements above still apply — rows just fall back to the previous level of detail.
