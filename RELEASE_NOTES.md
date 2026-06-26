# Release Notes

Version v0.1.14 — June 26, 2026

## Real Discord names in the Members list
The member-management list now shows each person's Discord display name (with
their @username underneath) instead of a raw Discord id. Names are saved on the
membership record from the trustworthy Discord login, so they no longer depend on
the AxiTools bot being able to look the person up.

When the owner opens the app, it backfills names for everyone already in the
workspace — existing members don't need to do anything. New members get their
name the moment they accept an invite.
