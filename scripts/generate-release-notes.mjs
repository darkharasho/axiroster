import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

// Generates human-style release notes for the current package.json version using
// the OpenAI Responses API, writes RELEASE_NOTES.md, commits it, then creates and
// pushes the v<version> tag — which triggers .github/workflows/release.yml.
// Ported from AxiBridge. Requires OPENAI_API_KEY (read from env or .env).

const exec = (cmd) =>
  execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: process.env }).trim()

const rootDir = process.cwd()
const packageJsonPath = path.join(rootDir, 'package.json')
const releaseNotesPath = path.join(rootDir, 'RELEASE_NOTES.md')

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return
  fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!match) return
      let value = match[2] ?? ''
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (process.env[match[1]] === undefined) process.env[match[1]] = value
    })
}

loadEnvFile(path.join(rootDir, '.env'))

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) {
  console.error('OPENAI_API_KEY is not set (env or .env). Aborting release notes generation.')
  process.exit(1)
}

const model = process.env.OPENAI_MODEL || 'gpt-5-mini'
const org = process.env.OPENAI_ORG
const project = process.env.OPENAI_PROJECT

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
const version = packageJson?.version || '0.0.0'
const nextTag = `v${version}`

let lastTag = ''
try {
  lastTag =
    exec('git tag --sort=-v:refname')
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)
      .find((t) => t !== nextTag) || ''
} catch {
  lastTag = ''
}

const range = lastTag ? `${lastTag}..HEAD` : ''
let commits = ''
try {
  commits = exec(`git log ${range} --no-merges --pretty=format:%s`)
} catch {
  commits = ''
}

const ignoreCommitPatterns = [
  /release notes/i,
  /update release notes/i,
  /bump version/i,
  /^chore:/i,
  /^build:/i,
  /dependency/i,
  /dependencies/i
]
const commitLines = commits
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .filter((line) => !ignoreCommitPatterns.some((p) => p.test(line)))

let diffStat = ''
let diffPatch = ''
try {
  diffStat = exec(`git diff ${range} --stat`)
} catch {
  /* ignore */
}
try {
  diffPatch = exec(`git diff ${range} --unified=2 --no-color`)
} catch {
  /* ignore */
}

const ignoreDiffFiles = new Set(['RELEASE_NOTES.md', 'package.json', 'package-lock.json'])
const filteredDiffPatch = diffPatch
  .split('\n')
  .reduce(
    (acc, line) => {
      if (line.startsWith('diff --git ')) {
        const m = line.match(/^diff --git a\/([^\s]+) b\/([^\s]+)/)
        acc.skip = ignoreDiffFiles.has(m?.[1] || '')
      }
      if (!acc.skip) acc.lines.push(line)
      return acc
    },
    { lines: [], skip: false }
  )
  .lines.join('\n')

const maxPatchChars = 12000
const trimmedPatch =
  filteredDiffPatch.length > maxPatchChars
    ? `${filteredDiffPatch.slice(0, maxPatchChars)}\n... (diff truncated)`
    : filteredDiffPatch

const prompt = [
  `Write release notes for this AxiRoster update (v${version}) in a direct, human, product-focused style.`,
  ``,
  `You are writing like the developer of the app, not like a marketing team and not like a git changelog.`,
  ``,
  `Goal:`,
  `- Explain what changed in a way that users immediately understand.`,
  `- Focus on what users can now do, see, or feel.`,
  `- Prioritize major features and visible improvements first.`,
  `- Mention important caveats when something is limited or not retroactive.`,
  `- Keep it concise, readable, and natural.`,
  ``,
  `Voice:`,
  `- Sound like an indie developer writing update notes by hand.`,
  `- Slightly casual, but still clear and intentional. Plain language over jargon.`,
  `- Do not use corporate/product-marketing phrasing.`,
  ``,
  `Hard rules:`,
  `- Use ONLY the commit summary and diff below; do not invent features.`,
  `- Do not sound like a commit log. Do not list implementation details unless they matter to users.`,
  `- Avoid version bumps, release chores, dependency updates, or build metadata unless they affect users.`,
  `- Do not say "This release introduces...", "Enhanced...", "Refactored...", or "Improved architecture...".`,
  ``,
  `Structure:`,
  `- Use short markdown section titles (## Heading), most important first.`,
  `- Each section: 1 heading + 1-3 short sentences or bullets.`,
  `- Group small polish into one "QoL Improvements" section and small fixes into "Fixes".`,
  `- For a caveat, add a line starting with "NOTE:".`,
  ``,
  `Output requirements: polished release notes only. No preamble, no summary section, no raw commit list.`,
  '',
  `Commit summary since ${lastTag || 'project start'}:`,
  commitLines.length ? commitLines.map((l) => `- ${l}`).join('\n') : '- No commits found.',
  '',
  `Diff summary:`,
  diffStat || 'No diff stats found.',
  '',
  `Code changes:`,
  trimmedPatch || 'No diff found.'
].join('\n')

const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
if (org) headers['OpenAI-Organization'] = org
if (project) headers['OpenAI-Project'] = project

const response = await fetch('https://api.openai.com/v1/responses', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: 'You write release notes like a human developer: product-focused, concise, user-facing, and natural. Turn technical diffs into clear user impact without inventing features.'
          }
        ]
      },
      { role: 'user', content: [{ type: 'input_text', text: prompt }] }
    ],
    text: { format: { type: 'text' } }
  })
})

if (!response.ok) {
  console.error(`OpenAI API error (${response.status}): ${await response.text()}`)
  process.exit(1)
}

const data = await response.json()
let outputText = data.output_text
if (!outputText && Array.isArray(data.output)) {
  outputText = data.output
    .filter((item) => item?.type === 'message' && Array.isArray(item.content))
    .flatMap((item) => item.content)
    .filter((c) => c?.type === 'output_text' && c.text)
    .map((c) => c.text)
    .join('\n')
    .trim()
}
if (!outputText) {
  console.error('OpenAI API returned no usable output for release notes.')
  process.exit(1)
}

const dateLabel = new Date().toLocaleDateString('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric'
})
const newSection = [`Version v${version} — ${dateLabel}`, ``, outputText.trim()].join('\n')
fs.writeFileSync(releaseNotesPath, `# Release Notes\n\n${newSection.trim()}\n`, 'utf8')
console.log(`Release notes written to ${releaseNotesPath}`)

try {
  if (exec('git status --porcelain').split('\n').some((l) => l.includes('RELEASE_NOTES.md'))) {
    exec('git add RELEASE_NOTES.md')
    exec(`git commit -m "Update release notes ${nextTag}"`)
    exec('git push')
    console.log('Committed and pushed RELEASE_NOTES.md.')
  }
} catch (err) {
  console.error('Failed to commit/push RELEASE_NOTES.md:', err?.message || err)
  process.exit(1)
}

try {
  if (exec('git tag').split('\n').map((t) => t.trim()).includes(nextTag)) {
    console.log(`Tag ${nextTag} already exists. Skipping tag creation.`)
  } else {
    exec(`git tag ${nextTag}`)
    exec(`git push origin ${nextTag}`)
    console.log(`Created and pushed tag ${nextTag} — release workflow will build artifacts.`)
  }
} catch (err) {
  console.error(`Failed to create/push tag ${nextTag}:`, err?.message || err)
  process.exit(1)
}
