# Release Notes

Version v0.4.0 — June 26, 2026

## Member notes are now a block editor

Notes on the member detail panel are now a full block editor (powered by BlockNote)
instead of a plain text field. You can write with headers, bullet lists, and inline
formatting — Notion-style. Existing plain-text notes are automatically migrated the
first time you open them, so nothing gets lost.

## Color-coded tags

Tags now have colors. When you add a tag in the member detail panel, you can pick a
color from a palette or recolor an existing tag at any time from the same popover.
Colors are saved globally, so a tag always looks the same no matter which member
it's on.

## Fixes

- Fixed a bug where unsaved notes could be lost if you navigated away before the
  autosave debounce fired — notes now flush immediately on close.
- Clicking the guild name or the Roster nav item now reliably returns you to the
  member list if you're in a member detail view.
