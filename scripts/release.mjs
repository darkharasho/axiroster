import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

// Cuts a release: validates that RELEASE_NOTES.md has a section for the current
// package.json version, then commits it (if changed), tags v<version>, and pushes
// the tag — which triggers .github/workflows/release.yml.
//
// The release notes themselves are written by hand (by Claude) into
// RELEASE_NOTES.md before running this; there is no AI/network call here.

const exec = (cmd) =>
  execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: process.env }).trim()

const rootDir = process.cwd()
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
const version = pkg?.version || '0.0.0'
const nextTag = `v${version}`
const notesPath = path.join(rootDir, 'RELEASE_NOTES.md')

const notes = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, 'utf8') : ''
if (!new RegExp(`^Version ${nextTag.replace('.', '\\.')}\\b`, 'm').test(notes)) {
  console.error(
    `RELEASE_NOTES.md has no "Version ${nextTag} — <date>" section.\n` +
      `Write the notes for ${nextTag} into RELEASE_NOTES.md first, then re-run.`
  )
  process.exit(1)
}

try {
  if (
    exec('git status --porcelain')
      .split('\n')
      .some((l) => l.includes('RELEASE_NOTES.md'))
  ) {
    exec('git add RELEASE_NOTES.md')
    exec(`git commit -m "Release notes ${nextTag}"`)
    exec('git push')
    console.log('Committed and pushed RELEASE_NOTES.md.')
  } else {
    console.log('RELEASE_NOTES.md already committed.')
  }
} catch (err) {
  console.error('Failed to commit/push RELEASE_NOTES.md:', err?.message || err)
  process.exit(1)
}

try {
  if (
    exec('git tag')
      .split('\n')
      .map((t) => t.trim())
      .includes(nextTag)
  ) {
    console.log(`Tag ${nextTag} already exists. Skipping tag creation.`)
  } else {
    exec(`git tag ${nextTag}`)
    exec(`git push origin ${nextTag}`)
    console.log(`Created and pushed tag ${nextTag} — the release workflow will build artifacts.`)
  }
} catch (err) {
  console.error(`Failed to create/push tag ${nextTag}:`, err?.message || err)
  process.exit(1)
}
