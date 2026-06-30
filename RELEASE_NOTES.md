# Release Notes

Version v1.1.1 — June 30, 2026

## Fixes

**Invited and shared guilds now sync to desktop automatically.**
If you accepted a Discord invite to a new guild on the web (or another device), the desktop app will now pick it up within about 20 seconds — no sign-out required. Previously, the app only ever adopted the guild you were already active in, so newly joined guilds were invisible on desktop until you manually signed out and back in.

**Fixed: app appeared to close immediately on relaunch, and roster could get stuck loading.**
If AxiRoster was already running and you launched it again (e.g. from the taskbar or a shortcut), it looked like it opened and closed — the already-running window now comes to the front correctly instead. Separately, if one of the upstream data sources (GW2 API, AxiTools, or AxiBridge) was slow or unreachable, the roster could hang on "Building roster…" indefinitely; it now times out after 20 seconds and shows a warning banner instead.

## Polish

**Transparent app icon.**
The app icon and favicon are now the shield mark on a transparent background — no more dark rounded square. Matches how AxiForge presents its icon.
