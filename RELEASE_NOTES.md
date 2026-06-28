# Release Notes

Version v0.5.1 — June 27, 2026

## Fixes

No more getting kicked back to the login screen. If you left the app running for a while or reopened it later, your Discord session could silently go stale and log you out. It now keeps the session refreshed in the background and remembers the latest credentials across restarts, so you stay signed in.

---

Version v0.5.0 — June 27, 2026

## Recruitment pipeline (new)

A **Recruitment** kanban for running trials. Drag recruits through stages — Applied → Trialing → Review → Accepted → Passed — with lightweight **officer voting** (yes / no / abstain, with a live tally) in the Review stage. Add an existing member *or* a manual prospect from a single typeahead, **bulk-add everyone in a Discord role** at once, and see **how many days** each card has sat in its current stage. Turn it on per guild in Settings.

## Retention radar (new)

A **Retention** view that ranks members by churn risk from real per-raid attendance trends — recent attendance, decay, absence streak, days since last seen, and engagement — into an at-risk / watch / healthy tier with plain-language reasons. Enable it per guild in Settings; it needs AxiBridge **2.13.0+** publishing the new attendance data.

## Bulk tag actions (new)

Multi-select members in the roster (checkboxes, shift-click, and select-all-filtered) and **add or remove a tag across the whole selection** in one go.

## Under the hood

- Member-notes editor upgraded to the latest BlockNote.
