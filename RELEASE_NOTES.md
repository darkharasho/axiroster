# Release Notes

Version v1.4.3 — October 4, 2026

## Fixes
- Fixed members getting signed out of Discord for no reason. A brief network drop while the app renewed your login, for example right after your computer woke from sleep, signed you out and threw away the saved login. Now the app only signs you out if Discord actually rejects the login. Otherwise it keeps you signed in and reconnects when the network is back.
- Shared guilds now tell you when you're signed out. Being signed out quietly switched the guild to local-only (your changes didn't sync and voting was off), which looked like your access had been cut to read-only. A notice now explains this, with a Sign in button right there.
- Sync now reconnects on its own if the app starts while offline, instead of staying local-only until you restart.

NOTE: Anyone already signed out (shown as read-only) just needs to sign in once more. After that, it should stick.
