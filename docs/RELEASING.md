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
2. **Generate notes + tag + push** (this is the trigger):
   ```bash
   npm run release
   ```
   `scripts/generate-release-notes.mjs` writes `RELEASE_NOTES.md` for the new
   version (AI-written from the commits/diff since the last tag), commits it,
   then creates and pushes `v<version>`. The tag push starts the build.

`RELEASE_NOTES.md` always contains only the version currently being released —
the workflow extracts the `Version v<tag> — <date>` section for the release body.

## Required secrets / variables (GitHub repo settings)

| Name | Type | Purpose |
| --- | --- | --- |
| `OP_SERVICE_ACCOUNT_TOKEN` | secret | 1Password service-account token used to fetch the macOS signing credentials during the mac build. |
| `DISCORD_WEBHOOK_URL` | variable | Optional. If set, the workflow posts the release to Discord. |

`GITHUB_TOKEN` is provided automatically.

For the release-notes script (run locally), set `OPENAI_API_KEY` in your `.env`
(optionally `OPENAI_MODEL`, default `gpt-5-mini`).

## macOS signing via 1Password

The mac build job pulls signing/notarization secrets from 1Password using
`1password/load-secrets-action`. Create a 1Password item the references resolve
to (edit `release.yml` if you use different names). Default references:

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
