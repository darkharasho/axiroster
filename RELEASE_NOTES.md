# Release Notes

Version v0.1.8 — June 26, 2026

## Your notes, links, and guild config now actually sync
A leader's existing notes and manual Discord-GW2 links weren't reaching officers
because sync only pulled down, never pushed your existing work up. Fixed — they
upload when you connect, so the whole workspace sees them.

## The whole guild is shared now
Officers automatically get the guild's GW2 key, AxiTools key, the member-role
anchor, and the AxiBridge report repos — no per-person setup. Read/write is the
gate: write officers can edit the shared config (member role, report repos) and it
updates for everyone live; read officers see it but can't change it.
