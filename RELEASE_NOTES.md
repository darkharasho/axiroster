# Release Notes

Version v0.1.1 — June 26, 2026

## Sign in with Discord now works in the installed app
The v0.1.0 builds shipped without the bundled Supabase config, so "Sign in with
Discord" did nothing once installed (it only worked when running from source).
The release build now bakes the config in, so sign-in, claiming a guild, invites,
and live sync all work in the packaged Windows/macOS/Linux apps.

If you grabbed v0.1.0, update to this build — auto-update will pull it in.
