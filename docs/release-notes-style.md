# Release Notes Style Guide

Style rules for the release notes the `release-builder` agent writes into
`RELEASE_NOTES.md`. These notes are also what ships in-app via the "What's New"
modal, so they're read by guild leaders, not just developers.

## Voice & Tone
- Write like the developer of the app, not a marketing team or a git changelog.
- Slightly casual, but clear and intentional. Plain language over jargon.
- Mildly opinionated is fine when it aids clarity ("the old timeout was too aggressive"), but don't overdo it.
- No corporate/product-marketing phrasing.

## Content Rules
- Use ONLY the commit summaries and diff data; do not invent features.
- Don't read like a commit log or list implementation details unless they matter to users.
- Skip version bumps, release chores, dependency updates, and build/publish metadata unless they affect users.
- Avoid "This release introduces...", "Enhanced...", "Refactored...", "Improved architecture...".
- No filler.

## Structure
- Short markdown section titles (`## Heading`).
- Each section: 1 heading + 1–3 short sentences or bullets.
- Most important items first.
- Group small polish into one "QoL Improvements" section.
- Group small bug fixes into one "Fixes" section unless a fix is big enough to stand alone.
- For a caveat, add a line starting with "NOTE:".

## Priority Order
1. New screens, features, or integrations (GW2 / Discord / AxiBridge / sync)
2. Big UX improvements
3. Visual/theme updates
4. Performance improvements users will feel
5. QoL improvements
6. Fixes

## Good Phrasing
- "Now shows...", "You can now...", "No more...", "Fixed...", "This won't apply retroactively..."

## How to Rewrite Changes
- Convert technical changes into user-facing outcomes, and say why it matters.
- Give concrete examples of what users can now see or do.
- If something only affects future syncs/rosters, say so explicitly.
- Combine related changes into one section.

## File Format
```
# Release Notes

Version v<VERSION> — <Month Day, Year>

<notes>
```

Written to `RELEASE_NOTES.md` at the project root. AxiRoster currently keeps only
the latest version's section in this file (it's replaced each release), but the
in-app extractor supports multiple accumulated sections if you ever keep history.

## Commit Filtering
When gathering commits, ignore noise (case-insensitive):
- `release notes`, `update release notes`, `bump version`
- Prefixes: `chore:`, `build:`
- Contains: `dependency`, `dependencies`
