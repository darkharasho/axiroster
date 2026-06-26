# Release Notes

Version v0.3.0 — June 26, 2026

## Guild Log

Each guild now has a Log tab showing a unified, chronological view of activity
across both GW2 and Discord. GW2 guild-log events (invites, kicks, rank changes,
treasury deposits, etc.) are pulled live from the GW2 API; Discord audit events
come from the AxiTools bot. The two streams are merged and stored locally per
guild — nothing is synced to Supabase.

A status strip at the top shows each source as idle / syncing / ok / error, with
running event totals. Days with activity get prominent Today / Yesterday headers
so it's easy to scan what happened recently. When a Discord account is linked to a
GW2 account, events from that person show a single identity chip instead of two
separate names.

NOTE: On first open the log back-fills recent history from both sources (the GW2
guild log and recent Discord events within the bot's 30-day window), then keeps
accumulating going forward and stores it locally per guild.

## Pending guild invites in the sidebar

If you've been invited to a guild workspace you haven't accepted yet, it now shows
up as a dashed placeholder in the guild rail rather than being invisible. Selecting
it opens an accept/reject card. Accepting populates the real guild and drops you
in; rejecting removes the placeholder.
