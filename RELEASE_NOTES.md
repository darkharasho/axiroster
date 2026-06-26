# Release Notes

Version v0.1.16 — June 26, 2026

## More patience for the AxiTools bot
Fetching the Discord roster could time out after 8 seconds and report the bot as
down even when it was online — a full member fetch on a larger server can take
longer than that. Read requests now wait up to 20 seconds and retry once before
giving up, so a single slow response no longer looks like an outage. (Role/kick
actions still run once, so nothing is double-applied.)

If it still can't reach the bot, the dev console now logs which host it tried,
to make a misconfigured AxiTools key easy to spot.
