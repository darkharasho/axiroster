# Release Notes

Version v1.2.5 — September 5, 2026

## Fixed: one guild's recruitment pipeline showing up in another

If you manage more than one guild in AxiRoster, the Recruitment board was mixing them together. Prospects you added under one guild appeared on another guild's board, the "N in pipeline" count included people from every guild, and — less visibly — opening the Recruitment tab could copy one guild's stage placements into the other guild's shared workspace.

The cause was that recruitment data (the board, prospects, votes, and card comments) was kept in a single machine-wide store with no guild attached, even though notes about individual players are meant to be shared across guilds. Recruitment state is now stored per guild, so each guild's board only ever reads and writes its own.

Two things to know after updating:

- Recruitment data already on this machine cannot be attributed to a guild after the fact, so it is set aside into `rosterAnnotations.json.legacy-reserved.json` next to your settings, and each shared guild re-downloads its own board on the next sync. If a guild is not connected to a shared workspace, its board will be empty and can be restored from that file.
- Boards that were already mixed clean themselves up: the first time you open Recruitment, any card that belongs to a different guild is removed from that guild's board. The previous version of the board is saved to `pipeline-prune-backup-<guild>.json` first. This only runs once your roster has loaded, so a failed roster fetch can't wipe a board.

Version v1.2.4 — September 1, 2026

## Smoother transitions throughout

The app now animates instead of snapping between states in a bunch of places. On a member's page, their name and class icon slide into the sticky header as you scroll past the big header. Modals and popovers (recruit cards, delete confirmations, stage settings, add-prospect) now fade and scale in and back out instead of popping. Switching between the roster list and a member's detail page animates as a smooth swap, sidebar sub-tabs expand like an accordion, and the roster list gently fades when you change views, filters, or time windows (typing in search stays instant). If you have "reduce motion" turned on at the OS level, all of this is skipped automatically.
