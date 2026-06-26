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

| Name | Type | Purpose |
| --- | --- | --- |
| `OP_SERVICE_ACCOUNT_TOKEN` | secret | 1Password service-account token the `op` CLI uses to fetch the macOS signing credentials during the mac build. |
| `DISCORD_WEBHOOK_URL` | variable | Optional. If set, the workflow posts the release to Discord. |

`GITHUB_TOKEN` is provided automatically. Release notes are written by hand, so
no `OPENAI_API_KEY` is needed.

## macOS signing via the 1Password CLI

The `build-mac` job installs the 1Password CLI (`1password/install-cli-action`)
and runs the build under `op run`, which resolves the `op://` env references to
their secret values for that command only (and masks them in logs). Auth is the
`OP_SERVICE_ACCOUNT_TOKEN` secret. Create a 1Password item the references
resolve to (edit `release.yml` if you use different names). Default references:

```
op://AxiRoster/macOS Signing/certificate_base64       # base64 of the Developer ID Application .p12
op://AxiRoster/macOS Signing/certificate_password     # the .p12 export password
op://AxiRoster/macOS Signing/apple_id                 # Apple ID email
op://AxiRoster/macOS Signing/app_specific_password    # app-specific password for notarization
op://AxiRoster/macOS Signing/team_id                  # Apple Developer Team ID
```

To produce `certificate_base64`: export your **Developer ID Application**
certificate + private key from Keychain as a `.p12`, then
`base64 -i cert.p12 | pbcopy` and store it in that field. electron-builder reads
it as `CSC_LINK`, `CSC_KEY_PASSWORD` (the `.p12` password), and notarizes with
the `APPLE_*` values (`mac.notarize: true` in `package.json`).

> Without these, the mac job fails to sign. To ship unsigned/un-notarized mac
> builds temporarily, set `mac.notarize` to `false` and remove the signing step —
> but auto-update won't work on macOS for unsigned apps.

## What the workflow does

- **test** — `npm ci`, typecheck, unit tests.
- **build** (matrix: linux AppImage, win nsis, mac dmg+zip) — `npm run build`
  then `electron-builder … --publish always` uploads to a **draft** GitHub
  release for the tag. The mac job signs + notarizes.
- **publish** — sets the release body from `RELEASE_NOTES.md`, flips the release
  out of draft, and posts to Discord if `DISCORD_WEBHOOK_URL` is set.
