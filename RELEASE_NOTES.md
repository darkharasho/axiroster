# Release Notes

Version v1.2.0 — August 7, 2026

## Attendance time window

Roster and Member Detail now share a time-window strip — All time, Last 30 days, Last 90 days, or a specific month — that re-scopes attendance everywhere it shows up.

- **Roster.** The Attendance column, its sort, and the Avg attendance stat card all recompute for whichever window you pick. The stat card now shows how many raids that average covers, and each row shows the raw fraction (e.g. 62% (8/13)) next to the percentage.
- **Member Detail.** Gets the same time-window strip, plus a windowed attendance stat, an attended/missed timeline, and a raid log with date, attendance, and combat/squad time for every raid in the window. Raid log rows now link to the hosted AxiBridge report for that raid. The attendance stat also now shows for members AxiBridge has no combat metrics for, as long as the guild publishes attendance data.
- Attendance is now fetched for any guild with AxiBridge report repos configured, not just guilds with Retention turned on — the Retention toggle now only gates the Retention view itself.

NOTE: If your guild doesn't have AxiBridge report repos configured, none of this changes anything for you.
