# Releasing AxiRoster

AxiRoster ships signed, auto-updating desktop builds. A push of a `v*` tag runs
`.github/workflows/release.yml`, which builds Linux/Windows/macOS artifacts,
publishes them to a GitHub Release, fills the notes from `RELEASE_NOTES.md`, and
(optionally) posts to Discord. The app auto-updates from that release via
`electron-updater`.

## Cutting a release

1. **Bump the version** in `package.json` (no git tag yet):
   ```bash
   npm version patch --no-git-tag-version   # or minor / major
   ```
2. **Write the release notes.** Ask Claude to write `RELEASE_NOTES.md` for the
   new version — it reads the commits/diff since the last tag and writes the
   `Version v<version> — <date>` section by hand. (No AI/network call lives in
   the build; the notes are authored at release time.)
3. **Tag + push** (this is the trigger):
   ```bash
   npm run release
   ```
   `scripts/release.mjs` verifies `RELEASE_NOTES.md` has a section for the
   current version, commits it if changed, then creates and pushes `v<version>`.
   The tag push starts the build.

`RELEASE_NOTES.md` always contains only the version currently being released —
the workflow extracts the `Version v<tag> — <date>` section for the release body.

## Required secrets / variables (GitHub repo settings)

The macOS signing secrets are **already set** on the repo (loaded once from
1Password via `gh secret set`):

| Name | Type | Purpose |
| --- | --- | --- |
| `CSC_LINK` | secret | base64 of the Developer ID Application `.p12`. |
| `CSC_KEY_PASSWORD` | secret | the `.p12` export password. |
| `APPLE_ID` | secret | Apple ID email (for notarization). |
| `APPLE_APP_SPECIFIC_PASSWORD` | secret | app-specific password (for notarization). |
| `APPLE_TEAM_ID` | secret | Apple Developer Team ID (`YMPSC6RQ4F`). |
| `DISCORD_WEBHOOK_URL` | variable | Optional. If set, posts the release to Discord. |

`GITHUB_TOKEN` is provided automatically. Release notes are written by hand, so
no `OPENAI_API_KEY` is needed.

## macOS signing

The `build-mac` job reads the secrets above from the environment;
electron-builder signs with `CSC_LINK`/`CSC_KEY_PASSWORD` and notarizes with the
`APPLE_*` values (`mac.notarize: true` in `package.json`). The cert is a
Developer ID Application cert for MICHAEL ALLEN STEPHENS (team `YMPSC6RQ4F`),
pulled from the 1Password item `Private/Apple App Specific Password`.

### Re-loading the secrets from 1Password (if they ever change)

```bash
ITEM="op://Private/Apple App Specific Password"
op read "$ITEM/bt4xtlotikkrchkzwd6wdqkru4" | gh secret set CSC_LINK              # Cert Base64 (SAI section)
op read "$ITEM/etntefqzgenf3zb2egcwgqpetu" | gh secret set CSC_KEY_PASSWORD      # Cert Password (SAI section)
op read "$ITEM/username"                    | gh secret set APPLE_ID
op read "$ITEM/password"                    | gh secret set APPLE_APP_SPECIFIC_PASSWORD
op read "$ITEM/juapwaxqpqluusuqhjaax6im2i"  | gh secret set APPLE_TEAM_ID
```

> The same item also has a `Cert2 (TAI)` section — a second, equally valid
> Developer ID Application cert for the same team. Either works; we use the SAI one.
> To ship unsigned mac builds, set `mac.notarize` to `false` and clear the env —
> but auto-update won't work on macOS for unsigned apps.

## What the workflow does

- **test** — `npm ci`, typecheck, unit tests.
- **build** (matrix: linux AppImage, win nsis, mac dmg+zip) — `npm run build`
  then `electron-builder … --publish always` uploads to a **draft** GitHub
  release for the tag. The mac job signs + notarizes.
- **publish** — sets the release body from `RELEASE_NOTES.md`, flips the release
  out of draft, and posts to Discord if `DISCORD_WEBHOOK_URL` is set.
