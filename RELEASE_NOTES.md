# Release Notes

Version v1.1.8 — July 28, 2026

## Guild Log Detail Cards

Audit log entries used to cut off their details, sometimes down to a raw, unreadable fragment — a message edit might show "Before: ```" and nothing else. Entries now show a short one-line preview of what changed (a message edit shows something like “test” → “test 2”), and you can click any entry to expand it into a full detail card:
- Message edits show the full before and after text (before in red, after in green); deleted messages and kick reasons show their full content too.
- Role and emoji changes list exactly what was added and removed.
- Setting changes show the old value → the new value.
- Guild Wars 2 message-of-the-day updates now show the full message text the same way.

Expanding works from the keyboard, not just the mouse. Joins and leaves are unchanged since there's nothing extra to show for those.
