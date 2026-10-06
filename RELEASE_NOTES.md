# Release Notes

Version v1.5.0 — October 5, 2026

## Access check

AxiRoster now checks a public access list when it starts and every few hours. Access to the Axi apps can be revoked for accounts, guilds or Discord servers that violate the terms of use, and a revoked install shows a block screen instead of the app.

The list is downloaded from `config.axi.link` and holds only one-way hashes. AxiRoster checks your GW2 accounts and guilds and your Discord user ID against it on your device and never sends them anywhere. To find a key's account and guilds, it asks the official Guild Wars 2 API using that key.

If the list can't be reached, AxiRoster keeps working as before. The README has a new **Access** section that spells out exactly what is checked and how to appeal.

Version v1.4.3 — October 4, 2026

## Fixes
- Fixed members getting signed out of Discord for no reason. A brief network drop while the app renewed your login, for example right after your computer woke from sleep, signed you out and threw away the saved login. Now the app only signs you out if Discord actually rejects the login. Otherwise it keeps you signed in and reconnects when the network is back.
- Shared guilds now tell you when you're signed out. Being signed out quietly switched the guild to local-only (your changes didn't sync and voting was off), which looked like your access had been cut to read-only. A notice now explains this, with a Sign in button right there.
- Sync now reconnects on its own if the app starts while offline, instead of staying local-only until you restart.

NOTE: Anyone already signed out (shown as read-only) just needs to sign in once more. After that, it should stick.
