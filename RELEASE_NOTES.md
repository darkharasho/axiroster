# Release Notes

Version v1.7.1 — October 12, 2026

## Discord role hierarchy

AxiTools runs Discord actions as the bot, so Discord only ever checked the bot's rank. That meant someone with a lower Discord role could add or remove roles on, kick, ban, time out or rename members ranked above them, or edit and delete higher roles. No more: AxiRoster now checks your own Discord rank first.

- You can only manage roles below your highest role, and members whose highest role is below yours.
- Nobody but the server owner can act on the owner.
- Refused actions show a plain error message.

On the web this is enforced server-side and is already live. On desktop it applies when you're using a workspace's shared AxiTools key.

