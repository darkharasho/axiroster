# Guild-switch loading states: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a guild responds at once with a skeleton shaped like the target tab, and the previous guild's data never shows under the new one.

**Architecture:**
- `@axiapps/axi-design` gains a `.axi-skeleton` primitive.
- AxiRoster's `App` tracks an in-flight switch, renders a per-tab skeleton until `setActiveGuild` resolves, then mounts the views keyed by guild id.
- Each view loads through one shared hook, `useGuildData`. Views render their own skeleton until the first load settles, and a `LoadError` if it fails.

**Tech Stack:** React 18, TypeScript, Electron, Vite, vitest 2. New dev dependencies: `jsdom` and `@testing-library/react` (React 18 component tests). axi-design is plain CSS with `.mjs` vitest tests.

**Spec:** `docs/superpowers/specs/2026-10-12-guild-switch-loading-design.md`

## Global Constraints

- **vitest:**
  - Always run with at most 2 workers. In AxiRoster use `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 <path>`, or `npm test` for everything.
  - In `../axi-design` use `npx vitest run --maxWorkers=2 <path>`.
- **Commits:**
  - Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never bypass commit signing (no `--no-gpg-sign`, no `-c commit.gpgsign=false`). If 1Password fails to sign, stop and ask the user to unlock it.
- **Ask first:**
  - Do not push, merge, tag-push or publish anything without asking.
  - The axi-design `npm publish` is held for the user's explicit approval (Task 13).
- **Untracked file:** do not touch `rollup-time-window-alltime.png` in the AxiRoster root.
- **AxiRoster styling:**
  - App classes use the `ar-` prefix, and package classes come first in a `className`.
  - Use `.ar-sm`/`.ar-md` for sizing and `.ar-ink-*` for colour, never inline colour. Tailwind is for layout only.
  - axi-design knobs (`--axi-skeleton-w`, `--axi-spinner-size`) are set through `style`, as `--axi-pill-fill` already is.
- **axi-design rules** (`../axi-design/docs/RULES.md`):
  - Rule 1: no soft gradients.
  - Rule 2: no saturated ink at partial opacity. A neutral mixed toward transparent is the spinner's precedent.
  - Rule 11: work indicators animate only `transform` and `opacity`.
  - A new component is checked under all three themes (default, `flat`, `glass`), and `dist/axi.css` is rebuilt and committed with the source.
- **Skeleton geometry:**
  - Fixed row counts: 8 for tables and the log, 6 for lists.
  - Bar widths come from a constant array in each file, never `Math.random`.
  - The root has `aria-busy="true"` and `aria-label="Loading <view>…"`.
- **Events:** `on` names map as `sync` → `onSyncChanged`, `audit` → `onAuditUpdated`, `workspace` → `onWorkspaceChanged`, with a 200ms trailing debounce.
- **Main process:** `guilds:setActive` sends `workspace:changed` exactly once and does not send `sync:changed`. `initSync` stays awaited.
- **Web:** no change to `webClient.setActiveGuild`.

## Rulings against the spec

The plan departs from the spec in these places. Each ruling gives the reason and what it costs if it turns out wrong.

1. **The skeleton sweep is a flat, hard-edged band, not a feathered gradient.**
   - Why: axi-design rule 1 has no exception for a soft transition. `.axi-meter--busy` sets the precedent, a flat fill travelling by transform.
   - If wrong: the user may prefer the softer look from the mockup. That is one `background` line in `src/feedback.css` plus an amendment to rule 1.
2. **`RosterView` keeps `resetToken`, but only for the in-guild "back to the list" action** (clicking the Roster sub-tab, or re-clicking the open guild). Guild switches no longer use it, because keyed remounting covers them.
   - Why: removing it outright would stop the Roster sub-tab from leaving a member detail.
   - If wrong: if that action should go too, it is one prop.
3. **`useGuildData` returns two extras: `refreshing: boolean`, and `reload` returns a `Promise<void>`. It also accepts `deps`.**
   - Why:
     - Refresh buttons spin today, and mutations `await load()` before continuing.
     - The Log's source and search filters must refetch without showing the skeleton.
   - If wrong: unused surface on the hook.
4. **Retrying after a failed first load shows the skeleton again** (`loading` returns to `true` when there is no data yet). A reload that already has data never sets `loading`.
5. **Re-clicking the guild that is already open and active does not call `setActiveGuild`.** It only returns to the Roster list.
   - Why: otherwise every re-click re-runs `initSync` behind a skeleton, which is the jank this work removes.
6. **Departed's skeleton uses its real table header with 6 rows.** The spec's "list rows" described the view before it became a table.
7. **The Recruitment skeleton uses `.ar-card`**, the class the real board uses. `.axi-card` does not appear in that view.
8. **The view key is `selected.id`, and views render only when no switch is in flight or failed.**
   - This is the spec's `key={activeGuildId}` without a third id to keep in sync.
   - App still keeps `activeGuildId`, but only for the re-click guard in ruling 5.

## Review Focus

These are the most likely ways the work could hurt a user without any task's tests catching them:

1. **Rapid A→B→C clicks where an earlier switch resolves after a later one.** Only C's views mount, and no skeleton or error reappears afterwards. This is pinned in Task 6.
2. **A background refresh failing while data is on screen.** The data stays, a toast appears, and no full-pane error replaces the view. This is pinned in Task 3 and checked in each view task.
3. **Typing in the Log search or switching its source filter.** It refetches without flashing the skeleton. This is pinned in Task 7.
4. **React 18 StrictMode double-invoking effects in development.** The hook must not leave a stale first result applied, or a listener registered twice. The latest-request id handles the first. This is pinned in Task 3 with a StrictMode wrapper test.
5. **Recruitment's prune running on an empty or foreign roster.** It must run only on the view's own loaded data, at most once per mount. This is pinned in Task 11.

---

## File map

**`../axi-design`:**

| File | Change |
|---|---|
| `src/feedback.css` | Add the `.axi-skeleton` rules |
| `tests/feedback.test.mjs` | Add the skeleton tests |
| `docs/manifest/feedback.mjs` | Add the `skeleton` entry |
| `docs/manifest/knobs.mjs` | Add the `--axi-skeleton-w` knob |
| `docs/RULES.md` | Add a rule-11 note |
| `docs/pages/gallery.html` | Add a Feedback section |
| `dist/axi.css`, `README.md` | Regenerated by `npm run build` |
| `package.json`, `package-lock.json` | Version 1.50.0 |

**AxiRoster:**

| File | Responsibility |
|---|---|
| `package.json`, `vitest.config.ts` | `file:../axi-design` during development; jsdom test dependencies; `*.test.tsx` included |
| `src/renderer/src/test/fakeClient.ts` (new) | Test helper: fake `AxiClient`, event emitter, `deferred`, fixtures |
| `src/renderer/src/lib/useGuildData.ts` (+ `.test.tsx`) (new) | The hook |
| `src/renderer/src/components/LoadError.tsx` (new) | Shared first-load failure pane |
| `src/renderer/src/components/skeletons/*.tsx` (new) | `Bar` and the per-view skeletons, plus `TabSkeleton` |
| `src/main/activateGuild.ts` (+ `.test.ts`) (new) | Pure body of `guilds:setActive` |
| `src/main/index.ts` | The handler calls `activateGuild` |
| `src/renderer/src/App.tsx` (+ `App.test.tsx`) | Switch flow, sidebar skeleton, keyed views |
| `src/renderer/src/index.css` | Remove `.ar-skeleton` and `@keyframes ar-shimmer` |
| The seven view files (+ one `.test.tsx` each) | Adopt the hook and skeleton |

---

### Task 1: `.axi-skeleton` in axi-design

**Repo:** `../axi-design`. Before starting, create a branch: `git -C ../axi-design checkout -b feat/skeleton`.

**Files:**
- Modify: `src/feedback.css` (append after the indeterminate meter block, before `/* ---------- notice status ---------- */`)
- Modify: `tests/feedback.test.mjs`
- Modify: `docs/manifest/feedback.mjs`
- Modify: `docs/manifest/knobs.mjs`
- Modify: `docs/RULES.md`, in the rule 11 section (around lines 531-545)
- Modify: `docs/pages/gallery.html`, a new section between `id="data"` and `id="prose"`
- Regenerate: `dist/axi.css` and `README.md` (`npm run build`)
- Modify: `package.json` and `package-lock.json` (version)

**Interfaces:**
- Produces:
  - Classes: `.axi-skeleton`, `.axi-skeleton--figure`, `.axi-skeleton--chip`, `.axi-skeleton--tile`.
  - Knob: `--axi-skeleton-w`, with fallback `100%`, or `56px` on `--chip`.
  - Package version: `1.50.0`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/feedback.test.mjs`:

```js
describe('the skeleton', () => {
  // The rule block for one selector, from its opening brace to its close.
  const block = (sel) => {
    const start = css.indexOf(`${sel} {`)
    expect(start, `${sel} is not defined`).toBeGreaterThan(-1)
    return css.slice(start, css.indexOf('}', start) + 1)
  }

  it('takes its height from the font of the element it sits in', () => {
    expect(block('.axi-skeleton')).toMatch(/height:\s*\.62em/)
    expect(block('.axi-skeleton')).toMatch(/width:\s*var\(--axi-skeleton-w,\s*100%\)/)
    expect(block('.axi-skeleton--figure')).toMatch(/height:\s*\.78em/)
  })

  it('fills with a neutral, never a saturated ink', () => {
    expect(block('.axi-skeleton')).toMatch(/color-mix\(in srgb,\s*var\(--axi-text\)/)
  })

  // Rule 1 has no exception for a soft transition, so the sweep is a flat
  // band travelling by transform - the indeterminate meter's shape.
  it('sweeps a flat band, not a gradient', () => {
    const after = block('.axi-skeleton::after')
    expect(after).not.toMatch(/gradient\(/)
    expect(after).toMatch(/animation:\s*axi-skeleton-sweep/)
    const frames = css.slice(css.indexOf('@keyframes axi-skeleton-sweep'))
    expect(frames.slice(0, frames.indexOf('}'))).toMatch(/transform:/)
  })

  it('draws no sweep under reduced motion', () => {
    const media = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(media).toMatch(/\.axi-skeleton::after\s*\{\s*display:\s*none;/)
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `cd ../axi-design && npx vitest run --maxWorkers=2 tests/feedback.test.mjs`
Expected: FAIL with `.axi-skeleton is not defined`.

- [ ] **Step 3: Add the CSS.** Insert into `src/feedback.css` after the indeterminate meter's `@media` block:

```css
/* ---------- skeleton ---------- */
/* A placeholder bar standing in for a piece of text or a figure while the
   data behind it loads. It goes inside the real element it stands in for, so
   its height is a fraction of that element's font and the finished text lands
   on the same line box with nothing moving. --axi-skeleton-w sets the length:
   a bar is a guess at the length of what is coming, not a measurement.

   The fill is the reading ink mixed toward transparent - a neutral, which rule
   2 leaves free, the same way the spinner draws its unlit bars. The sweep is
   rule 11's: a band of the same neutral travelling across by transform, which
   the compositor keeps running while the load holds the main thread. It is
   flat rather than feathered because rule 1 has no exception for a soft
   transition; the indeterminate meter travels a hard-edged fill for the same
   reason. Under reduced motion the band is not drawn at all - a still bar
   already says "not here yet". */
@keyframes axi-skeleton-sweep { to { transform: translateX(250%); } }
.axi-skeleton {
  position: relative;
  overflow: hidden;
  display: inline-block;
  vertical-align: middle;
  height: .62em;
  width: var(--axi-skeleton-w, 100%);
  max-width: 100%;
  border-radius: var(--axi-radius-xs);
  background: color-mix(in srgb, var(--axi-text) 14%, transparent);
}
/* 40% wide, from fully left of the bar (-100% of itself) to fully right of it
   (250% of itself is the bar's whole width). */
.axi-skeleton::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 40%;
  background: color-mix(in srgb, var(--axi-text) 10%, transparent);
  transform: translateX(-100%);
  will-change: transform;
  animation: axi-skeleton-sweep 1.6s ease-in-out infinite;
}
/* A figure is set larger than its label, so its bar is taller. */
.axi-skeleton--figure { height: .78em; }
/* A chip's own box, for a cell that will hold one. */
.axi-skeleton--chip { height: 1.4em; width: var(--axi-skeleton-w, 56px); }
/* An icon or avatar tile: a fixed square, not a line of text. */
.axi-skeleton--tile { flex: none; width: 22px; height: 22px; }
@media (prefers-reduced-motion: reduce) {
  .axi-skeleton::after { display: none; }
}
```

- [ ] **Step 4: Run the feedback and motion tests and confirm they pass.**

Run: `npx vitest run --maxWorkers=2 tests/feedback.test.mjs tests/motion.test.mjs`
Expected: PASS.

- [ ] **Step 5: Document the classes and the knob.**

  1. In `docs/manifest/feedback.mjs`, add this entry after `meter-busy`:

```js
  {
    id: 'skeleton',
    name: 'Skeleton',
    layer: 'feedback',
    classes: ['.axi-skeleton', '.axi-skeleton--figure', '.axi-skeleton--chip', '.axi-skeleton--tile'],
    summary: 'A placeholder bar for text or a figure that is still loading. It sits inside the real element, so the finished content lands where the bar was.',
    rules: [1, 2, 11],
    knobs: ['--axi-skeleton-w'],
    aliases: ['placeholder', 'loading', 'shimmer', 'ghost'],
    notes: `Put the bar inside the element it stands in for - a \`.axi-stat__n\`,
a table cell, a row name - never beside it. Its height is a fraction of that
element's font, so when the data lands the text takes the same line box and
nothing below it moves. Keep the surrounding markup real as well: the real
table head, the real stat labels. A skeleton is the finished view with its
data missing, not a drawing of one.

Set the length with \`--axi-skeleton-w\`. Vary it from a fixed list rather than
at random, so a re-render draws the same skeleton instead of a twitching one.

The sweep is a flat band moved by \`transform\` (rule 11), not a feathered
gradient (rule 1). Under \`prefers-reduced-motion\` the band is not drawn and
the bar holds still. Mark the region that holds skeletons with
\`aria-busy="true"\` and a label naming what is loading; the bars themselves
say nothing to a screen reader.`,
    examples: [
      {
        title: 'Each variant',
        html: `<div class="axi-row"><span class="axi-skeleton" style="--axi-skeleton-w: 120px"></span><span class="axi-skeleton axi-skeleton--figure" style="--axi-skeleton-w: 56px"></span><span class="axi-skeleton axi-skeleton--chip"></span><span class="axi-skeleton axi-skeleton--tile"></span></div>`,
      },
      {
        title: 'Inside a stat',
        html: `<div class="axi-stat"><b class="axi-stat__n"><span class="axi-skeleton axi-skeleton--figure" style="--axi-skeleton-w: 56px"></span></b><span class="axi-stat__k">Members</span></div>`,
      },
    ],
  },
```

  2. In `docs/manifest/knobs.mjs`, add this after `--axi-spinner-size`:

```js
  {
    name: '--axi-skeleton-w',
    sets: 'the length of an `.axi-skeleton` bar',
    fallback: '`100%` (`56px` on `.axi-skeleton--chip`)',
    example: '<span class="axi-skeleton" style="--axi-skeleton-w: 96px"></span>',
  },
```

- [ ] **Step 6: Add the rule-11 note.** In `docs/RULES.md`, append this paragraph to the end of rule 11, after "anything that claims to show liveness.":

```markdown
A loading skeleton is an indicator of work too, and it is held to the same
line. `.axi-skeleton`'s sweep is a band moved by `transform`; the bar under it
is static paint. The band is flat rather than feathered, because rule 1's
exceptions are gradients that draw a shape with hard stops, never a soft
transition. Under `prefers-reduced-motion` the band is not drawn at all.
```

- [ ] **Step 7: Add the gallery section.** In `docs/pages/gallery.html`, insert this between the closing `</section>` of `id="data"` and `<section class="docs-section" id="prose">`:

```html
  <section class="docs-section" id="feedback">
    <h2>Feedback</h2>
    <p>Rule 11. A skeleton stands in for content that is still loading. Each bar sits inside the real element it replaces, so the finished text lands on the same line and nothing moves.</p>

    <div class="axi-row" style="margin-bottom: 16px;">
      <span class="axi-skeleton" style="--axi-skeleton-w: 120px"></span>
      <span class="axi-skeleton axi-skeleton--figure" style="--axi-skeleton-w: 56px"></span>
      <span class="axi-skeleton axi-skeleton--chip"></span>
      <span class="axi-skeleton axi-skeleton--tile"></span>
    </div>

    <div class="axi-grid" style="--axi-grid-min: 150px; margin-bottom: 16px;" aria-busy="true" aria-label="Loading stats…">
      <div class="axi-stat"><b class="axi-stat__n"><span class="axi-skeleton axi-skeleton--figure" style="--axi-skeleton-w: 48px"></span></b><span class="axi-stat__k">Fights</span></div>
      <div class="axi-stat"><b class="axi-stat__n"><span class="axi-skeleton axi-skeleton--figure" style="--axi-skeleton-w: 36px"></span></b><span class="axi-stat__k">Won</span></div>
      <div class="axi-stat"><b class="axi-stat__n"><span class="axi-skeleton axi-skeleton--figure" style="--axi-skeleton-w: 36px"></span></b><span class="axi-stat__k">Lost</span></div>
    </div>

    <div class="axi-panel" style="--axi-panel-pad: 18px; margin-bottom: 16px;" aria-busy="true" aria-label="Loading damage…">
      <p class="axi-eyebrow">Top damage</p>
      <table class="axi-table">
        <thead>
          <tr><th>Player</th><th>Damage</th><th>Down contrib.</th><th>Share</th></tr>
        </thead>
        <tbody>
          <tr><td><span class="axi-table__who"><span class="axi-skeleton axi-skeleton--tile"></span><span class="axi-skeleton" style="--axi-skeleton-w: 118px"></span></span></td><td class="axi-table__num"><span class="axi-skeleton" style="--axi-skeleton-w: 64px"></span></td><td><span class="axi-skeleton" style="--axi-skeleton-w: 22px"></span></td><td><span class="axi-skeleton" style="--axi-skeleton-w: 36px"></span></td></tr>
          <tr><td><span class="axi-table__who"><span class="axi-skeleton axi-skeleton--tile"></span><span class="axi-skeleton" style="--axi-skeleton-w: 86px"></span></span></td><td class="axi-table__num"><span class="axi-skeleton" style="--axi-skeleton-w: 64px"></span></td><td><span class="axi-skeleton" style="--axi-skeleton-w: 22px"></span></td><td><span class="axi-skeleton" style="--axi-skeleton-w: 36px"></span></td></tr>
          <tr><td><span class="axi-table__who"><span class="axi-skeleton axi-skeleton--tile"></span><span class="axi-skeleton" style="--axi-skeleton-w: 134px"></span></span></td><td class="axi-table__num"><span class="axi-skeleton" style="--axi-skeleton-w: 64px"></span></td><td><span class="axi-skeleton" style="--axi-skeleton-w: 22px"></span></td><td><span class="axi-skeleton" style="--axi-skeleton-w: 36px"></span></td></tr>
        </tbody>
      </table>
    </div>

    <div class="axi-panel" style="--axi-panel-pad: 12px;" aria-busy="true" aria-label="Loading list…">
      <div class="axi-row" style="margin-bottom: 8px;"><span class="axi-skeleton axi-skeleton--tile"></span><span class="axi-skeleton" style="--axi-skeleton-w: 140px"></span></div>
      <div class="axi-row" style="margin-bottom: 8px;"><span class="axi-skeleton axi-skeleton--tile"></span><span class="axi-skeleton" style="--axi-skeleton-w: 96px"></span></div>
      <div class="axi-row"><span class="axi-skeleton axi-skeleton--tile"></span><span class="axi-skeleton" style="--axi-skeleton-w: 118px"></span></div>
    </div>
  </section>
```

- [ ] **Step 8: Build and run the whole suite.**

Run: `npm run build && npx vitest run --maxWorkers=2`
Expected:
- The build writes `dist/axi.css` and regenerates the README knob table, now including `--axi-skeleton-w`.
- All tests PASS, including `build.test.mjs` (dist matches sources), `manifest.test.mjs` (every class claimed, knob documented) and `tokens.test.mjs` (colour scan).

If a site or gallery test fails because `id="feedback"` collides with a reserved id or route, rename the section id to `feedback-skeleton` and rerun.

- [ ] **Step 9: Check the gallery under every theme.** Run `npm run serve` and open `http://localhost:4173`. Use the theme switcher to view the Feedback section under the default theme, `flat` and `glass`, and the accent switcher on at least two accents. Check:
  - Bars are visible but quieter than text.
  - The band sweeps.
  - On `flat` and `glass` the bars take the theme's `--axi-radius-xs` corner.
  - With the OS "reduce motion" setting on, the band is gone and the bars hold still.

  Stop the server afterwards.

- [ ] **Step 10: Commit the component.**

```bash
cd ../axi-design
git add src/feedback.css tests/feedback.test.mjs docs/manifest/feedback.mjs docs/manifest/knobs.mjs docs/RULES.md docs/pages/gallery.html dist/axi.css README.md
git commit -m "$(printf 'feat(feedback): add .axi-skeleton loading bar\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

- [ ] **Step 11: Bump the version and commit it.**

```bash
npm version 1.50.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "$(printf 'chore(release): 1.50.0\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

Do not tag, push or publish. Publishing is Task 13 and needs approval.

---

### Task 2: Develop AxiRoster against local axi-design, and migrate the sidebar skeleton

**Repo:** AxiRoster, on branch `feat/guild-switch-loading` (created at execution setup).

**Files:**
- Modify: `package.json` and `package-lock.json` (the `@axiapps/axi-design` dependency)
- Modify: `src/renderer/src/App.tsx:220-229`
- Modify: `src/renderer/src/index.css:1606-1619`, removing `@keyframes ar-shimmer` and `.ar-skeleton`

**Interfaces:**
- Consumes: the `.axi-skeleton` classes from Task 1.
- Produces: the AxiRoster build resolves `@axiapps/axi-design` to `../axi-design` (temporarily, until Task 13).

- [ ] **Step 1: Point the dependency at the local build.**

Run: `npm install ../axi-design`
Expected: `package.json` shows `"@axiapps/axi-design": "file:../axi-design"`, and `node_modules/@axiapps/axi-design` is a symlink.

Check: `grep -c "axi-skeleton" node_modules/@axiapps/axi-design/dist/axi.css`. It prints a number greater than 0.

- [ ] **Step 2: Replace the sidebar placeholder.** In `App.tsx`, replace the `[0, 1, 2].map(...)` block inside `{!loaded && guilds.length === 0 && (...)}` with:

```tsx
                <div className="flex flex-col gap-2 p-1" aria-busy="true" aria-label="Loading guilds…">
                  {[96, 72, 112].map((w) => (
                    <div key={w} className="flex items-center gap-2.5">
                      <span className="axi-skeleton axi-skeleton--tile" />
                      <span className="axi-skeleton" style={{ '--axi-skeleton-w': `${w}px` } as React.CSSProperties} />
                    </div>
                  ))}
                </div>
```

- [ ] **Step 3: Delete the old CSS.** In `src/renderer/src/index.css`, delete the `@keyframes ar-shimmer { … }` block and the `.ar-skeleton { … }` rule (around lines 1606-1619). Then confirm nothing else uses them:

Run: `grep -rn "ar-skeleton\|ar-shimmer" src/`
Expected: no output.

- [ ] **Step 4: Typecheck and build.**

Run: `npm run typecheck && npm run build && npm run build:web`
Expected: all three succeed.

- [ ] **Step 5: Commit.**

```bash
git add package.json package-lock.json src/renderer/src/App.tsx src/renderer/src/index.css
git commit -m "$(printf 'feat(ui): sidebar loading uses axi-skeleton\n\nDevelops against ../axi-design until 1.50.0 is published.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 3: Component-test setup, the `useGuildData` hook and `LoadError`

**Files:**
- Modify: `package.json` (dev dependencies) and `vitest.config.ts` (include `.test.tsx`)
- Create: `src/renderer/src/test/fakeClient.ts`
- Create: `src/renderer/src/lib/useGuildData.ts`
- Create: `src/renderer/src/lib/useGuildData.test.tsx`
- Create: `src/renderer/src/components/LoadError.tsx`

**Interfaces:**
- Produces, from `lib/useGuildData.ts`:

```ts
export type GuildEvent = 'sync' | 'audit' | 'workspace'
export const EVENT_DEBOUNCE_MS = 200
export interface GuildData<T> {
  data: T | null
  loading: boolean      // true until the first load settles (and again on a retry with no data)
  refreshing: boolean   // a background reload is in flight
  error: unknown        // set only when there is no data to show
  reload: () => Promise<void>  // resolves when that reload settles; never rejects
}
export function useGuildData<T>(
  load: () => Promise<T>,
  opts?: { on?: GuildEvent[]; deps?: readonly unknown[] }
): GuildData<T>
export function errorMessage(e: unknown): string
```

- Produces, from `components/LoadError.tsx`: `export default function LoadError(props: { title: string; error: unknown; onRetry: () => void }): JSX.Element`
- Produces, from `test/fakeClient.ts`:
  - `fakeClient(overrides?)`, which returns `{ api, emit(name), listenerCount(name) }`
  - `deferred<T>()`
  - `emptyRoster(members?)`
  - `member(key, over?)`
  - `guild(id, over?)`

- [ ] **Step 1: Install the test dependencies and include `.tsx` tests.**

Run: `npm install -D jsdom@^25 @testing-library/react@^16 @testing-library/dom@^10`

In `vitest.config.ts`, change `include` to:

```ts
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'supabase/functions/**/*.test.ts'],
```

Leave `environment: 'node'` as it is. Component tests opt in with a `// @vitest-environment jsdom` first line.

- [ ] **Step 2: Write the test helper** `src/renderer/src/test/fakeClient.ts`:

```ts
// Test-only fake of the renderer's client seam. Every method is a vi.fn; on*
// subscriptions record their callback so a test can emit() the event, and
// return an unsubscribe so listenerCount() can prove cleanup. Anything not
// given a default resolves undefined.
import { vi, type Mock } from 'vitest'
import { setClient, type AxiClient } from '../lib/client'
import type { GuildSummary, ReconciledMember, RosterPayload, SourceStatus } from '../../../preload/index.d'

const SOURCE: SourceStatus = {
  hasKey: false, configured: false, loaded: false, count: 0, guildId: null, guildName: null, error: null
}

export function emptyRoster(members: ReconciledMember[] = []): RosterPayload {
  return {
    members, metrics: {}, attendance: [], discordGuildId: null, discordRoles: [],
    discordCandidates: [], memberRoleId: null, rankOrder: {},
    sources: { gw2: SOURCE, discord: SOURCE, bridge: SOURCE }, warnings: []
  }
}

export function member(key: string, over: Partial<ReconciledMember> = {}): ReconciledMember {
  return {
    memberId: null, annotationKey: key, hasMemberRole: false, roles: [],
    accounts: [{ account_name: `${key}.1234`, characters: [], inGuild: true, manual: false, main: true }],
    linkSource: null, guildLabels: [], linked: false, inGuild: true, status: 'gw2-only' as ReconciledMember['status'],
    nickname: '', aliases: [], notes: '', tags: [], label: key, ...over
  }
}

export function guild(id: string, over: Partial<GuildSummary> = {}): GuildSummary {
  return {
    id, name: `Guild ${id}`, active: false, gw2GuildName: `Guild ${id}`, gw2GuildId: `gw2-${id}`,
    gw2AccountName: '', hasGw2Key: true, discordGuildName: '', discordGuildId: '', hasAxitoolsKey: false,
    memberRoleId: '', bridgeRepos: [], shared: false, axitoolsShared: false,
    retentionEnabled: true, pipelineEnabled: true, ...over
  }
}

export function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const DEFAULTS: Record<string, (...args: never[]) => unknown> = {
  authStatus: async () => ({ signedIn: true, role: 'owner', userId: 'u1' }),
  syncStatus: async () => 'disabled',
  listWorkspaceRoles: async () => ({}),
  listGuilds: async () => [],
  listInvites: async () => [],
  getWhatsNew: async () => ({ version: '1.0.0', releaseNotes: null, lastSeenVersion: '1.0.0' }),
  getTagRegistry: async () => ({}),
  departuresGet: async () => [],
  buildRoster: async () => ({ ok: true, data: emptyRoster() }),
  auditList: async () => ({ events: [], updatedAt: '' }),
  auditStatus: async () => null,
  pipelineGet: async () => ({ stages: undefined, placement: {}, placedAt: {}, prospects: [], votes: [], commentCounts: {} }),
  pipelinePrunePlacements: async () => 0,
  adoptSharedKeys: async () => undefined,
  getGuild: async () => null,
  setActiveGuild: async () => undefined,
  logRetention: async () => undefined
}

export function fakeClient(overrides: Record<string, (...args: never[]) => unknown> = {}): {
  api: Record<string, Mock>
  emit: (name: string) => void
  listenerCount: (name: string) => number
} {
  const listeners = new Map<string, Set<() => void>>()
  const fns = new Map<string, Mock>()
  const impls = { ...DEFAULTS, ...overrides }
  const get = (prop: string): Mock => {
    let fn = fns.get(prop)
    if (fn) return fn
    if (/^on[A-Z]/.test(prop) && !(prop in impls)) {
      fn = vi.fn((cb: () => void) => {
        const set = listeners.get(prop) ?? new Set()
        set.add(cb)
        listeners.set(prop, set)
        return () => { set.delete(cb) }
      })
    } else {
      fn = vi.fn(impls[prop] ?? (async () => undefined))
    }
    fns.set(prop, fn)
    return fn
  }
  const api = new Proxy({} as Record<string, Mock>, { get: (_t, prop: string) => get(prop) })
  setClient(api as unknown as AxiClient)
  return {
    api,
    emit: (name) => { for (const cb of [...(listeners.get(name) ?? [])]) cb() },
    listenerCount: (name) => listeners.get(name)?.size ?? 0
  }
}
```

If `RosterStatus` does not include `'gw2-only'`, use any member of the `RosterStatus` union from `src/preload/index.d.ts`.

- [ ] **Step 3: Write the failing hook tests** `src/renderer/src/lib/useGuildData.test.tsx`:

```tsx
// @vitest-environment jsdom
import { StrictMode, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useGuildData } from './useGuildData'
import { subscribeToast, type ToastInput } from './toast'
import { deferred, fakeClient } from '../test/fakeClient'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useGuildData', () => {
  it('is loading until the first load resolves; a reload with data never sets loading again', async () => {
    fakeClient()
    const first = deferred<string>()
    const second = deferred<string>()
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useGuildData(load))
    expect(result.current).toMatchObject({ loading: true, data: null, refreshing: false })

    await act(async () => first.resolve('a'))
    expect(result.current).toMatchObject({ loading: false, data: 'a', error: null })

    act(() => { void result.current.reload() })
    expect(result.current).toMatchObject({ loading: false, refreshing: true, data: 'a' })
    await act(async () => second.resolve('b'))
    expect(result.current).toMatchObject({ loading: false, refreshing: false, data: 'b' })
  })

  it('keeps the data and toasts when a refresh fails', async () => {
    fakeClient()
    const seen: ToastInput[] = []
    const off = subscribeToast((t) => seen.push(t))
    const load = vi.fn().mockResolvedValueOnce('a').mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useGuildData(load))
    await act(async () => {})
    await act(async () => { await result.current.reload() })
    expect(result.current).toMatchObject({ data: 'a', error: null, loading: false })
    expect(seen).toEqual([{ message: "Couldn't refresh: offline", variant: 'error' }])
    off()
  })

  it('sets error with no data when the first load fails, and a retry shows loading again', async () => {
    fakeClient()
    const seen: ToastInput[] = []
    const off = subscribeToast((t) => seen.push(t))
    const retry = deferred<string>()
    const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockReturnValueOnce(retry.promise)
    const { result } = renderHook(() => useGuildData(load))
    await act(async () => {})
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeNull()
    expect((result.current.error as Error).message).toBe('boom')
    expect(seen).toEqual([])

    act(() => { void result.current.reload() })
    expect(result.current).toMatchObject({ loading: true, error: null })
    await act(async () => retry.resolve('ok'))
    expect(result.current).toMatchObject({ loading: false, data: 'ok', error: null })
    off()
  })

  it('discards an older request that settles after a newer one', async () => {
    fakeClient()
    const older = deferred<string>()
    const newer = deferred<string>()
    const load = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const { result } = renderHook(() => useGuildData(load))
    act(() => { void result.current.reload() })
    await act(async () => newer.resolve('new'))
    await act(async () => older.resolve('old'))
    expect(result.current.data).toBe('new')
  })

  it('coalesces five events within 200ms into exactly one reload', async () => {
    vi.useFakeTimers()
    const fc = fakeClient()
    const load = vi.fn(async () => 'x')
    renderHook(() => useGuildData(load, { on: ['sync', 'audit', 'workspace'] }))
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(1)
    act(() => {
      fc.emit('onSyncChanged')
      fc.emit('onAuditUpdated')
      fc.emit('onWorkspaceChanged')
      fc.emit('onSyncChanged')
      fc.emit('onAuditUpdated')
    })
    act(() => { vi.advanceTimersByTime(199) })
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('removes its listeners and timer on unmount, and applies nothing late', async () => {
    vi.useFakeTimers()
    const fc = fakeClient()
    const pending = deferred<string>()
    const load = vi.fn().mockReturnValueOnce(pending.promise)
    const { result, unmount } = renderHook(() => useGuildData(load, { on: ['sync', 'workspace'] }))
    expect(fc.listenerCount('onSyncChanged')).toBe(1)
    fc.emit('onSyncChanged') // arms the debounce
    const before = result.current
    unmount()
    expect(fc.listenerCount('onSyncChanged')).toBe(0)
    expect(fc.listenerCount('onWorkspaceChanged')).toBe(0)
    await act(async () => pending.resolve('late'))
    vi.advanceTimersByTime(500)
    expect(load).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(before)
  })

  it('reloads in the background when deps change, without showing loading', async () => {
    fakeClient()
    const load = vi.fn(async () => 'x')
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useGuildData(load, { deps: [q] }),
      { initialProps: { q: '' } }
    )
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(1)
    rerender({ q: 'abc' })
    expect(result.current.loading).toBe(false)
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not refetch when the caller passes a new load function each render', async () => {
    fakeClient()
    const calls: string[] = []
    const { rerender } = renderHook(({ n }: { n: number }) =>
      useGuildData(async () => { calls.push(`v${n}`); return n }), { initialProps: { n: 1 } })
    await act(async () => {})
    rerender({ n: 2 })
    await act(async () => {})
    expect(calls).toEqual(['v1'])
  })

  it('under StrictMode applies the latest result and holds one listener per event', async () => {
    const fc = fakeClient()
    let n = 0
    const load = vi.fn(async () => ++n)
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => <StrictMode>{children}</StrictMode>
    const { result } = renderHook(() => useGuildData(load, { on: ['sync'] }), { wrapper })
    await act(async () => {})
    expect(result.current.data).toBe(load.mock.calls.length)
    expect(fc.listenerCount('onSyncChanged')).toBe(1)
  })
})
```

- [ ] **Step 4: Run the tests and confirm they fail.**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/useGuildData.test.tsx`
Expected: FAIL, because `./useGuildData` does not exist.

- [ ] **Step 5: Write the hook** `src/renderer/src/lib/useGuildData.ts`:

```ts
// The one way a guild view loads its data. A view mounts per guild (App keys
// it by guild id), so this only ever loads for one guild: once on mount, then
// in the background on the client events it names, coalesced by a trailing
// debounce. Only the latest request's result is applied, and nothing is
// applied after unmount — the two ways the previous guild's data used to land
// under the new one.
import { useCallback, useEffect, useRef, useState } from 'react'
import { client } from './client'
import { toast } from './toast'

export type GuildEvent = 'sync' | 'audit' | 'workspace'
export const EVENT_DEBOUNCE_MS = 200

const SUBSCRIBE: Record<GuildEvent, (cb: () => void) => () => void> = {
  sync: (cb) => client.onSyncChanged(cb),
  audit: (cb) => client.onAuditUpdated(cb),
  workspace: (cb) => client.onWorkspaceChanged(cb)
}

export interface GuildData<T> {
  data: T | null
  /** True until the first load settles (and again on a retry with no data). */
  loading: boolean
  /** A background reload is in flight; the data on screen stays. */
  refreshing: boolean
  /** Set only when there is no data to show. */
  error: unknown
  /** Resolves when this reload settles. Never rejects. */
  reload: () => Promise<void>
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function useGuildData<T>(
  load: () => Promise<T>,
  opts: { on?: GuildEvent[]; deps?: readonly unknown[] } = {}
): GuildData<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<unknown>(null)

  // Held in a ref so callers needn't memoise it, and so a new closure (fresh
  // filters, fresh props) is what the next request runs.
  const loadRef = useRef(load)
  loadRef.current = load
  const seq = useRef(0)
  const alive = useRef(false)
  const hasData = useRef(false)

  const run = useCallback((): Promise<void> => {
    const id = ++seq.current
    if (hasData.current) setRefreshing(true)
    const current = (): boolean => alive.current && id === seq.current
    return loadRef.current().then(
      (next) => {
        if (!current()) return
        hasData.current = true
        setData(next)
        setError(null)
        setLoading(false)
        setRefreshing(false)
      },
      (e: unknown) => {
        if (!current()) return
        if (hasData.current) toast(`Couldn't refresh: ${errorMessage(e)}`, 'error')
        else setError(e)
        setLoading(false)
        setRefreshing(false)
      }
    )
  }, [])

  const onKey = (opts.on ?? []).join(',')
  useEffect(() => {
    alive.current = true
    void run()
    let timer: ReturnType<typeof setTimeout> | null = null
    const kick = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void run()
      }, EVENT_DEBOUNCE_MS)
    }
    const offs = onKey ? (onKey.split(',') as GuildEvent[]).map((e) => SUBSCRIBE[e](kick)) : []
    return () => {
      alive.current = false
      if (timer) clearTimeout(timer)
      for (const off of offs) off()
    }
  }, [run, onKey])

  // A change in deps (a filter, a search) refetches in the background. The
  // mount's own load already covers the initial deps, so only a change counts.
  const depsKey = JSON.stringify(opts.deps ?? [])
  const lastDeps = useRef(depsKey)
  useEffect(() => {
    if (lastDeps.current === depsKey) return
    lastDeps.current = depsKey
    void run()
  }, [depsKey, run])

  const reload = useCallback((): Promise<void> => {
    if (!hasData.current) {
      setLoading(true)
      setError(null)
    }
    return run()
  }, [run])

  return { data, loading, refreshing, error, reload }
}
```

- [ ] **Step 6: Run the tests and confirm they pass.**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/lib/useGuildData.test.tsx`
Expected: PASS (9 tests).

- [ ] **Step 7: Write `LoadError`** `src/renderer/src/components/LoadError.tsx`:

```tsx
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { errorMessage } from '../lib/useGuildData'

// A view's first load failed, so there is nothing to show but the failure.
// A refresh that fails over data already on screen toasts instead (see
// useGuildData) — this pane never replaces data the reader can still use.
export default function LoadError({
  title,
  error,
  onRetry
}: {
  title: string
  error: unknown
  onRetry: () => void
}): JSX.Element {
  return (
    <div className="ar-pane__body grid place-items-center p-6">
      <section className="ar-empty" role="alert">
        <AlertTriangle size={22} className="ar-ink-danger" />
        <p className="ar-ink">{title}</p>
        {error != null && <p className="ar-note">{errorMessage(error)}</p>}
        <button onClick={onRetry} className="axi-btn">
          <RefreshCw size={14} /> Retry
        </button>
      </section>
    </div>
  )
}
```

- [ ] **Step 8: Typecheck, then run the full suite.**

Run: `npm run typecheck && npm test`
Expected: both PASS.

- [ ] **Step 9: Commit.**

```bash
git add package.json package-lock.json vitest.config.ts src/renderer/src/test/fakeClient.ts src/renderer/src/lib/useGuildData.ts src/renderer/src/lib/useGuildData.test.tsx src/renderer/src/components/LoadError.tsx
git commit -m "$(printf 'feat(ui): useGuildData hook and LoadError pane\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 4: Per-view skeleton components

**Files:**
- Create: `src/renderer/src/components/skeletons/Bar.tsx`
- Create: `src/renderer/src/components/skeletons/RosterSkeleton.tsx`
- Create: `src/renderer/src/components/skeletons/DepartedSkeleton.tsx`
- Create: `src/renderer/src/components/skeletons/LogSkeleton.tsx`
- Create: `src/renderer/src/components/skeletons/RetentionSkeleton.tsx`
- Create: `src/renderer/src/components/skeletons/RecruitmentSkeleton.tsx`
- Create: `src/renderer/src/components/skeletons/PageSkeletons.tsx` (Sharing and Settings)
- Create: `src/renderer/src/components/skeletons/TabSkeleton.tsx`
- Test: `src/renderer/src/components/skeletons/skeletons.test.tsx`

**Interfaces:**
- Produces:
  - Default exports `RosterSkeleton`, `DepartedSkeleton`, `LogSkeleton`, `RetentionSkeleton` and `RecruitmentSkeleton`, each `() => JSX.Element`.
  - Named exports `SharingSkeleton` and `SettingsSkeleton` from `PageSkeletons.tsx`.
  - `export type GuildTab = 'roster' | 'log' | 'departed' | 'sharing' | 'settings' | 'retention' | 'recruitment'` and `export default function TabSkeleton({ tab }: { tab: GuildTab }): JSX.Element` from `TabSkeleton.tsx`.
  - Labels (`aria-label`), used by later tests:

| Skeleton | `aria-label` |
|---|---|
| Roster | `Loading roster…` |
| Departed | `Loading departures…` |
| Log | `Loading log…` |
| Retention | `Loading retention…` |
| Recruitment | `Loading recruitment…` |
| Sharing | `Loading sharing…` |
| Settings | `Loading settings…` |

- [ ] **Step 1: Write the failing test** `skeletons.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import TabSkeleton, { type GuildTab } from './TabSkeleton'

afterEach(cleanup)

const CASES: [GuildTab, string, number][] = [
  // tab, label, rows (tbody tr / log rows / cards / fields)
  ['roster', 'Loading roster…', 8],
  ['departed', 'Loading departures…', 6],
  ['log', 'Loading log…', 8],
  ['retention', 'Loading retention…', 8],
  ['recruitment', 'Loading recruitment…', 0],
  ['sharing', 'Loading sharing…', 0],
  ['settings', 'Loading settings…', 0]
]

describe('skeletons', () => {
  it.each(CASES)('%s is busy, labelled, and draws a fixed row count', (tab, label, rows) => {
    const { container } = render(<TabSkeleton tab={tab} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('aria-busy')).toBe('true')
    expect(root.getAttribute('aria-label')).toBe(label)
    expect(container.querySelectorAll('.axi-skeleton').length).toBeGreaterThan(0)
    if (tab === 'log') expect(container.querySelectorAll('.ar-log__row')).toHaveLength(rows)
    else if (rows) expect(container.querySelectorAll('tbody tr')).toHaveLength(rows)
  })

  it.each(CASES)('%s renders identically twice (no randomness)', (tab) => {
    const a = render(<TabSkeleton tab={tab} />).container.innerHTML
    cleanup()
    const b = render(<TabSkeleton tab={tab} />).container.innerHTML
    expect(b).toBe(a)
  })

  it('every control a skeleton draws is disabled', () => {
    for (const [tab] of CASES) {
      const { container } = render(<TabSkeleton tab={tab} />)
      for (const el of container.querySelectorAll('button, input')) {
        expect((el as HTMLButtonElement).disabled, `${tab}: ${el.outerHTML}`).toBe(true)
      }
      cleanup()
    }
  })

  it('the roster skeleton keeps the real table head', () => {
    const { container } = render(<TabSkeleton tab="roster" />)
    const heads = [...container.querySelectorAll('thead th')].map((th) => th.textContent)
    expect(heads).toEqual(['', 'Member', 'Profession', 'Rank', 'Joined', 'Attendance', 'Last seen'])
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/components/skeletons`
Expected: FAIL, because `./TabSkeleton` does not exist.

- [ ] **Step 3: Write `Bar.tsx`.**

```tsx
import type { CSSProperties } from 'react'

type Kind = 'text' | 'figure' | 'chip' | 'tile'

// One .axi-skeleton bar. It sits inside the real element it stands in for, so
// its height follows that element's font; `w` sets --axi-skeleton-w.
export default function Bar({ w, kind = 'text' }: { w?: number | string; kind?: Kind }): JSX.Element {
  const style =
    w === undefined
      ? undefined
      : ({ '--axi-skeleton-w': typeof w === 'number' ? `${w}px` : w } as CSSProperties)
  return (
    <span
      className={kind === 'text' ? 'axi-skeleton' : `axi-skeleton axi-skeleton--${kind}`}
      style={style}
      aria-hidden="true"
    />
  )
}

/** Widths cycle through a fixed list, so every render draws the same skeleton. */
export function widthAt(widths: readonly number[], i: number): number {
  return widths[i % widths.length]
}
```

- [ ] **Step 4: Write `RosterSkeleton.tsx`.** It mirrors `RosterView`'s list branch: the source strip, the four stat cards, the toolbar and the `MemberTable` wrapper, without the select column.

```tsx
import { MessageSquare, RefreshCw, Search, Swords } from 'lucide-react'
import axibridgeLogo from '../../assets/axibridge-logo.svg'
import Picker from '../Picker'
import Bar, { widthAt } from './Bar'

const ROWS = 8
const NAME_W = [118, 86, 134, 64, 102, 92, 126, 74] as const
const SUB_W = [84, 70, 96, 58, 88, 76, 92, 66] as const
const CLASS_W = [72, 60, 84, 66, 78, 54, 70, 62] as const
const STATS = ['Members', 'Linked', 'Tracked (AxiBridge)', 'Avg attendance'] as const
const COLUMNS = ['Member', 'Profession', 'Rank', 'Joined', 'Attendance', 'Last seen'] as const
const noop = (): void => {}

// RosterView's own wrappers and headers with the data replaced by bars, so
// the real view lands in place with nothing moving.
export default function RosterSkeleton(): JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true" aria-label="Loading roster…">
      <div className="ar-pane__head">
        <SourceChip icon={<Swords size={13} />} label="GW2" />
        <SourceChip icon={<MessageSquare size={13} />} label="Discord" />
        <SourceChip icon={<img src={axibridgeLogo} alt="" className="h-3.5 w-3.5" />} label="AxiBridge" />
        <div className="ar-note--faint ml-auto shrink-0"><Bar w={72} /></div>
      </div>

      <div className="grid grid-cols-4 gap-3 px-4 pt-4">
        {STATS.map((k) => (
          <div key={k} className="axi-stat ar-md ar-raised">
            <span className="axi-stat__n"><Bar kind="figure" w={56} /></span>
            <span className="axi-stat__k">{k}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 px-4 py-3">
        <div className="axi-search ar-sm max-w-sm flex-1">
          <Search size={15} className="axi-search__icon" />
          <input disabled placeholder="Search roster…" className="axi-input ar-sm" />
        </div>
        <Picker value="all" onChange={noop} disabled sm className="min-w-[130px]" options={[{ value: 'all', label: 'All professions' }]} />
        <Picker value="all" onChange={noop} disabled sm className="min-w-[120px]" options={[{ value: 'all', label: 'All ranks' }]} />
        <div className="flex gap-1">
          <button disabled aria-pressed className="axi-pill ar-sm">Table</button>
          <button disabled aria-pressed={false} className="axi-pill ar-sm">Cards</button>
        </div>
        <button disabled className="ar-icon-btn" aria-label="Refresh"><RefreshCw size={15} /></button>
      </div>

      <div className="flex flex-wrap gap-2 px-4 pb-4">
        <button disabled aria-pressed className="axi-pill ar-sm">All <span className="ar-num"><Bar w={14} /></span></button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-6">
        <div className="ar-list pointer-events-none">
          <div className="ar-list__rows">
            <table className="axi-table axi-table--sticky">
              <colgroup>
                <col style={{ width: 26 }} />
                <col />
                <col style={{ width: '17%' }} />
                <col style={{ width: 124 }} />
                <col style={{ width: 112 }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: 96 }} />
              </colgroup>
              <thead>
                <tr>
                  <th />
                  {COLUMNS.map((c) => (
                    <th key={c}><span className="ar-th">{c}</span></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: ROWS }, (_, i) => (
                  <tr key={i}>
                    <td><Bar kind="tile" /></td>
                    <td>
                      <div className="ar-row__name"><Bar w={widthAt(NAME_W, i)} /></div>
                      <div className="ar-row__sub"><Bar w={widthAt(SUB_W, i)} /></div>
                    </td>
                    <td><span className="ar-row__sub"><Bar w={widthAt(CLASS_W, i)} /></span></td>
                    <td><Bar kind="chip" w={64} /></td>
                    <td><span className="ar-num"><Bar w={70} /></span></td>
                    <td><span className="ar-num"><Bar w={40} /></span></td>
                    <td className="axi-table__num"><Bar w={22} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function SourceChip({ icon, label }: { icon: JSX.Element; label: string }): JSX.Element {
  return (
    <span className="axi-chip min-w-0 max-w-[16rem] flex-nowrap whitespace-nowrap">
      <span className={toneDiamond('idle')} />
      <span className="shrink-0">{icon}</span>
      <span className="shrink-0 ar-ink">{label}</span>
      <Bar w={56} />
    </span>
  )
}
```

Add `import { toneDiamond } from '../../lib/status'` to the imports.

- [ ] **Step 5: Write `DepartedSkeleton.tsx`.** It mirrors `DepartedView`: the head, the toolbar, the filter pills and the table, with 6 rows.

```tsx
import { RefreshCw, Search } from 'lucide-react'
import Bar, { widthAt } from './Bar'

const ROWS = 6
const ACCOUNT_W = [104, 82, 120, 70, 96, 88] as const
const DISCORD_W = [76, 92, 64, 84, 58, 72] as const
const REASON_W = [90, 120, 70, 104, 84, 60] as const
const HEAD = ['', '', 'Account', 'Discord', 'Status', 'By', 'When', 'Reason', ''] as const

export default function DepartedSkeleton(): JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true" aria-label="Loading departures…">
      <div className="ar-pane__head">
        <span className="ar-ink">Departed</span>
        <div className="ar-note--faint ml-auto shrink-0"><Bar w={64} /></div>
      </div>
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="axi-search ar-sm max-w-sm flex-1">
          <Search size={15} className="axi-search__icon" />
          <input disabled placeholder="Search account, Discord, actor, reason, note…" className="axi-input ar-sm" />
        </div>
        <button disabled className="ar-icon-btn" aria-label="Refresh"><RefreshCw size={15} /></button>
      </div>
      <div className="flex flex-wrap gap-2 px-4 pb-4">
        <button disabled aria-pressed className="axi-pill ar-sm">All <span className="ar-num"><Bar w={14} /></span></button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-6">
        <div className="ar-list pointer-events-none">
          <div className="ar-list__rows">
            <table className="axi-table axi-table--sticky">
              <colgroup>
                <col style={{ width: 36 }} />
                <col style={{ width: 26 }} />
                <col style={{ width: '18%' }} />
                <col />
                <col style={{ width: 110 }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: 96 }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: 44 }} />
              </colgroup>
              <thead>
                <tr>{HEAD.map((h, i) => <th key={i}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {Array.from({ length: ROWS }, (_, i) => (
                  <tr key={i}>
                    <td />
                    <td><Bar kind="tile" /></td>
                    <td><div className="ar-row__name"><Bar w={widthAt(ACCOUNT_W, i)} /></div></td>
                    <td><div className="ar-row__sub"><Bar w={widthAt(DISCORD_W, i)} /></div></td>
                    <td><Bar kind="chip" w={72} /></td>
                    <td><Bar w={56} /></td>
                    <td><span className="ar-num"><Bar w={64} /></span></td>
                    <td><Bar w={widthAt(REASON_W, i)} /></td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Write `LogSkeleton.tsx`.** It mirrors `GuildLog`: the status strip, the controls and the `ar-log` list with one day header and 8 rows.

```tsx
import { RefreshCw, Search } from 'lucide-react'
import Bar, { widthAt } from './Bar'

const ROWS = 8
const BODY_W = [220, 168, 260, 140, 196, 232, 154, 184] as const

export default function LogSkeleton(): JSX.Element {
  return (
    <div className="ar-pane" aria-busy="true" aria-label="Loading log…">
      <div className="ar-pane__head" style={{ '--ar-head-gap': '18px' } as React.CSSProperties}>
        <span className="axi-legend__key"><Bar w={88} /></span>
        <span className="axi-legend__key"><Bar w={96} /></span>
        <span className="ar-note--faint ml-auto"><Bar w={110} /></span>
      </div>
      <div className="ar-pane__head">
        <div className="flex gap-1">
          <button disabled aria-pressed className="axi-pill">All</button>
          <button disabled aria-pressed={false} className="axi-pill">GW2</button>
          <button disabled aria-pressed={false} className="axi-pill">Discord</button>
        </div>
        <div className="axi-search flex-1">
          <Search size={14} className="axi-search__icon" />
          <input disabled placeholder="Search name or action…" className="axi-input" />
        </div>
        <button disabled className="axi-btn"><RefreshCw size={14} /> Refresh</button>
      </div>
      <div className="ar-log pointer-events-none">
        <div className="ar-log__day"><Bar w={64} /></div>
        {Array.from({ length: ROWS }, (_, i) => (
          <div key={i} className="ar-log__row">
            <span className="ar-num w-16 flex-none"><Bar w={44} /></span>
            <Bar kind="chip" w={48} />
            <span className="flex min-w-0 flex-1"><Bar w={widthAt(BODY_W, i)} /></span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

Before writing this, confirm the labels of the `SOURCES` constant in `GuildLog.tsx` and use them for the three pills.

- [ ] **Step 7: Write `RetentionSkeleton.tsx`.** It mirrors `RetentionView`: the head, the three tier stats, the filter pills and the table, with 8 rows and no select column.

```tsx
import { Activity, RefreshCw } from 'lucide-react'
import Bar, { widthAt } from './Bar'

const ROWS = 8
const NAME_W = [112, 84, 128, 70, 98, 90, 120, 76] as const
const WHY_W = [180, 140, 210, 120, 160, 196, 132, 170] as const
const TIERS = [
  ['At-risk', 'danger'],
  ['Watch', 'warn'],
  ['Healthy', 'ok']
] as const

export default function RetentionSkeleton(): JSX.Element {
  return (
    <div className="ar-pane" aria-busy="true" aria-label="Loading retention…">
      <div className="ar-pane__head">
        <Activity className="ar-ink-accent" size={15} />
        <span className="ar-title">Retention</span>
        <span className="ar-note--faint"><Bar w={120} /></span>
        <button disabled className="ar-icon-btn ml-auto" aria-label="Refresh"><RefreshCw size={14} /></button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 pb-6">
        <div className="grid grid-cols-3 gap-3">
          {TIERS.map(([label, tone]) => (
            <div key={label} className={`axi-stat ar-md ar-raised axi-stat--${tone}`}>
              <span className="axi-stat__n"><Bar kind="figure" w={36} /></span>
              <span className="axi-stat__k">{label}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled aria-pressed className="axi-pill ar-sm">Needs attention</button>
        </div>
        <div className="ar-list ar-list--read pointer-events-none">
          <div className="ar-list__rows">
            <table className="axi-table axi-table--sticky">
              <colgroup>
                <col />
                <col style={{ width: 58 }} />
                <col style={{ width: 96 }} />
                <col style={{ width: 96 }} />
                <col style={{ width: '34%' }} />
                <col style={{ width: 88 }} />
              </colgroup>
              <thead>
                <tr><th>Member</th><th>Risk</th><th>Tier</th><th>Recent</th><th>Why</th><th>Last seen</th></tr>
              </thead>
              <tbody>
                {Array.from({ length: ROWS }, (_, i) => (
                  <tr key={i}>
                    <td>
                      <div className="ar-row__name"><Bar w={widthAt(NAME_W, i)} /></div>
                      <div className="ar-row__sub"><Bar w={72} /></div>
                    </td>
                    <td className="axi-table__num"><Bar w={24} /></td>
                    <td><Bar kind="chip" w={60} /></td>
                    <td><Bar w={48} /></td>
                    <td><Bar w={widthAt(WHY_W, i)} /></td>
                    <td><Bar w={40} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
```

Before writing this, check the remaining cells of a `RetentionView` row (after the "Member" cell, around lines 216-270). Use `className="axi-table__num"` on exactly the cells that have it there.

- [ ] **Step 8: Write `RecruitmentSkeleton.tsx`.** It shows the default stage names as real column heads, with 3/2/2/1/1 cards.

```tsx
import { RefreshCw, Users2 } from 'lucide-react'
import { DEFAULT_STAGES, stageSeries } from '../../lib/pipeline'
import Bar, { widthAt } from './Bar'

const CARDS = [3, 2, 2, 1, 1] as const
const NAME_W = [104, 86, 120, 72, 96, 110, 80, 92, 64] as const

export default function RecruitmentSkeleton(): JSX.Element {
  let n = 0
  return (
    <div className="ar-pane" aria-busy="true" aria-label="Loading recruitment…">
      <div className="ar-pane__head">
        <Users2 className="ar-ink-accent" size={15} />
        <span className="ar-title">Recruitment</span>
        <span className="ar-note--faint"><Bar w={80} /></span>
        <button disabled className="ar-icon-btn ml-auto" aria-label="Refresh"><RefreshCw size={14} /></button>
      </div>
      <div className="ar-pane__body overflow-x-auto pointer-events-none">
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${DEFAULT_STAGES.length}, minmax(200px, 1fr))` }}>
          {DEFAULT_STAGES.map((stage, col) => (
            <div key={stage.id} className="ar-col">
              <div className="ar-col__head">
                <span
                  className="axi-diamond axi-diamond--series"
                  style={{ '--axi-series': stageSeries(stage.color) } as React.CSSProperties}
                />
                <span>{stage.label}</span>
                <span className="ml-auto"><Bar kind="chip" w={26} /></span>
              </div>
              {Array.from({ length: CARDS[col] ?? 1 }, () => {
                const i = n++
                return (
                  <div key={i} className="ar-card">
                    <div className="ar-card__name"><Bar w={widthAt(NAME_W, i)} /></div>
                    <div className="ar-row__sub"><Bar w={72} /></div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

`stageSeries` is currently defined inside `RecruitmentView.tsx`. Move it unchanged into `src/renderer/src/lib/pipeline.ts` as an exported function, and import it from there in `RecruitmentView.tsx` too. Importing it from the view would pull the whole view into the skeleton.

- [ ] **Step 9: Write `PageSkeletons.tsx`.** Sharing and Settings are both `axi-page axi-page--narrow` pages.

```tsx
import { ShieldCheck } from 'lucide-react'
import Bar from './Bar'

const FIELD_W = [96, 120, 84, 108] as const

// A section of labelled fields: eyebrow-height label bar over an input-height bar.
function Fields({ count }: { count: number }): JSX.Element {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="axi-eyebrow" style={{ marginBottom: 8 }}><Bar w={FIELD_W[i % FIELD_W.length]} /></div>
          <Bar kind="chip" w="100%" />
        </div>
      ))}
    </>
  )
}

export function SharingSkeleton(): JSX.Element {
  return (
    <div className="ar-pane__body" aria-busy="true" aria-label="Loading sharing…">
      <div className="axi-page axi-page--narrow flex flex-col gap-5">
        <div>
          <h1 className="ar-title">Sharing</h1>
          <p className="ar-note mt-2"><Bar w={280} /></p>
        </div>
        <section className="axi-panel flex flex-col gap-4">
          <div className="ar-section__title"><Bar w={110} /></div>
          <Fields count={3} />
        </section>
      </div>
    </div>
  )
}

export function SettingsSkeleton(): JSX.Element {
  return (
    <div className="ar-pane__body" aria-busy="true" aria-label="Loading settings…">
      <div className="axi-page axi-page--narrow flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <Bar kind="chip" w={64} />
        </div>
        <section className="axi-panel flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <ShieldCheck className="ar-ink-accent" size={18} />
            <h2 className="ar-title">Connection</h2>
          </div>
          <Fields count={1} />
          <div className="ar-section flex flex-col gap-3">
            <div className="ar-section__title"><Bar w={60} /></div>
            <Fields count={3} />
          </div>
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 10: Write `TabSkeleton.tsx`.**

```tsx
import RosterSkeleton from './RosterSkeleton'
import DepartedSkeleton from './DepartedSkeleton'
import LogSkeleton from './LogSkeleton'
import RetentionSkeleton from './RetentionSkeleton'
import RecruitmentSkeleton from './RecruitmentSkeleton'
import { SettingsSkeleton, SharingSkeleton } from './PageSkeletons'

export type GuildTab = 'roster' | 'log' | 'departed' | 'sharing' | 'settings' | 'retention' | 'recruitment'

// The pane App shows while a guild switch is in flight: the target tab's own
// skeleton, which the view then keeps showing until its first load lands.
export default function TabSkeleton({ tab }: { tab: GuildTab }): JSX.Element {
  switch (tab) {
    case 'roster': return <RosterSkeleton />
    case 'log': return <LogSkeleton />
    case 'departed': return <DepartedSkeleton />
    case 'retention': return <RetentionSkeleton />
    case 'recruitment': return <RecruitmentSkeleton />
    case 'sharing': return <SharingSkeleton />
    case 'settings': return <SettingsSkeleton />
  }
}
```

- [ ] **Step 11: Run the tests and confirm they pass.**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/components/skeletons`
Expected: PASS. If the disabled-controls test flags a `Picker`, check that `Picker` forwards `disabled` to its trigger button. If it does not, add that forwarding in `Picker.tsx` and keep the test.

- [ ] **Step 12: Typecheck and commit.**

```bash
npm run typecheck
git add src/renderer/src/components/skeletons src/renderer/src/lib/pipeline.ts src/renderer/src/components/RecruitmentView.tsx src/renderer/src/components/Picker.tsx
git commit -m "$(printf 'feat(ui): per-view loading skeletons\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

Only stage `Picker.tsx` if you changed it.

---

### Task 5: `guilds:setActive` sends `workspace:changed` once

**Files:**
- Create: `src/main/activateGuild.ts`
- Create: `src/main/activateGuild.test.ts`
- Modify: `src/main/index.ts:861-866`

**Interfaces:**
- Produces:

```ts
export async function activateGuild(
  id: string,
  deps: { setActive: (id: string) => void; initSync: () => Promise<void>; notify: (channel: 'workspace:changed') => void }
): Promise<void>
```

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it, vi } from 'vitest'
import { activateGuild } from './activateGuild'

describe('activateGuild', () => {
  it('sets the guild active, awaits initSync, then sends workspace:changed once', async () => {
    const order: string[] = []
    const notify = vi.fn((ch: string) => { order.push(`notify:${ch}`) })
    await activateGuild('g2', {
      setActive: (id) => { order.push(`setActive:${id}`) },
      initSync: async () => { order.push('initSync') },
      notify
    })
    expect(order).toEqual(['setActive:g2', 'initSync', 'notify:workspace:changed'])
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).not.toHaveBeenCalledWith('sync:changed')
  })

  it('rejects without notifying when initSync fails, so the renderer can show the error', async () => {
    const notify = vi.fn()
    await expect(
      activateGuild('g2', { setActive: () => {}, initSync: async () => { throw new Error('offline') }, notify })
    ).rejects.toThrow('offline')
    expect(notify).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails** (the module is missing).

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/main/activateGuild.test.ts`

- [ ] **Step 3: Write the module.**

```ts
// The body of guilds:setActive. The renderer remounts every guild view once
// this resolves, so the views refetch on their own; the only event left to
// send is workspace:changed, for the listeners that outlive a switch (the
// guild list, invites, auth). A sync:changed here would make every freshly
// mounted view load twice.
export async function activateGuild(
  id: string,
  deps: { setActive: (id: string) => void; initSync: () => Promise<void>; notify: (channel: 'workspace:changed') => void }
): Promise<void> {
  deps.setActive(id)
  await deps.initSync()
  deps.notify('workspace:changed')
}
```

- [ ] **Step 4: Wire it into `index.ts`.** Replace the handler at lines 861-866 with:

```ts
  ipcMain.handle('guilds:setActive', (_e, id: string) =>
    activateGuild(id, {
      setActive: (g) => guilds.setActive(g),
      initSync, // the workspace follows the active guild — re-point sync + audit/retention
      notify: (ch) => mainWindow?.webContents.send(ch)
    })
  )
```

Add `import { activateGuild } from './activateGuild'` with the other local imports.

- [ ] **Step 5: Run the test, the typecheck and the full suite.**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/main/activateGuild.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/main/activateGuild.ts src/main/activateGuild.test.ts src/main/index.ts
git commit -m "$(printf 'fix(main): guild switch sends workspace:changed once, no sync:changed\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 6: The App switch flow

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/App.test.tsx`

**Interfaces:**
- Consumes:
  - `TabSkeleton` and `GuildTab` (Task 4).
  - `LoadError` (Task 3).
  - `fakeClient`, `guild` and `deferred` (Task 3).
- Produces:
  - Guild views are rendered as `<XView key={selected.id} … />`, and only when no switch is in flight or failed.
  - Later view tasks rely on that remount and must not re-implement guild-change handling.

- [ ] **Step 1: Write the failing tests** `src/renderer/src/App.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { deferred, fakeClient, guild } from './test/fakeClient'

// BlockNote (via MemberDetail) does not load under jsdom and is never opened here.
vi.mock('./components/NotesEditor', () => ({ default: () => null }))

import App from './App'

afterEach(cleanup)

const A = guild('a', { name: 'Alpha', active: true })
const B = guild('b', { name: 'Bravo' })
const C = guild('c', { name: 'Charlie' })

async function renderApp(setActive: (id: string) => Promise<void>) {
  const fc = fakeClient({ listGuilds: async () => [A, B, C], setActiveGuild: setActive })
  render(<App />)
  await act(async () => {})
  return fc
}
const row = (name: string): HTMLElement => screen.getByText(name).closest('button') as HTMLElement
const busy = (): HTMLElement | null => document.querySelector('main [aria-busy="true"]')

describe('guild switching', () => {
  it('highlights the new guild and shows the skeleton before setActiveGuild resolves', async () => {
    const pending = deferred<void>()
    const fc = await renderApp(async (id) => (id === 'b' ? pending.promise : undefined))
    const buildsBefore = fc.api.buildRoster.mock.calls.length

    act(() => { fireEvent.click(row('Bravo')) })
    expect(row('Bravo').className).toContain('ar-guild--on')
    expect(busy()?.getAttribute('aria-label')).toBe('Loading roster…')
    expect(fc.api.buildRoster.mock.calls.length).toBe(buildsBefore) // nothing fetches mid-switch

    await act(async () => pending.resolve())
    expect(fc.api.buildRoster.mock.calls.length).toBe(buildsBefore + 1) // remounted once, for B
    expect(screen.getByPlaceholderText('Search roster…')).not.toHaveProperty('disabled', true)
  })

  it('A→B→C with earlier switches resolving last mounts only C', async () => {
    const waits: Record<string, ReturnType<typeof deferred<void>>> = { a: deferred(), b: deferred(), c: deferred() }
    const fc = await renderApp((id) => waits[id].promise)
    act(() => { fireEvent.click(row('Bravo')) })
    act(() => { fireEvent.click(row('Charlie')) })
    act(() => { fireEvent.click(row('Alpha')) })
    act(() => { fireEvent.click(row('Charlie')) })
    const buildsBefore = fc.api.buildRoster.mock.calls.length

    await act(async () => waits.c.resolve())
    expect(busy()).toBeNull()
    expect(fc.api.buildRoster.mock.calls.length).toBe(buildsBefore + 1)
    await act(async () => { waits.b.resolve(); waits.a.resolve() })
    expect(busy()).toBeNull()
    expect(screen.queryByText("Couldn't open this guild")).toBeNull()
    expect(fc.api.buildRoster.mock.calls.length).toBe(buildsBefore + 1)
    expect(row('Charlie').className).toContain('ar-guild--on')
  })

  it('shows the error with Retry when setActiveGuild rejects, and Retry switches again', async () => {
    const setActive = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
    const fc = await renderApp(setActive)
    await act(async () => { fireEvent.click(row('Bravo')) })
    expect(screen.getByText("Couldn't open this guild")).toBeTruthy()
    expect(screen.getByText('offline')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByText('Retry')) })
    expect(fc.api.setActiveGuild).toHaveBeenLastCalledWith('b')
    expect(screen.queryByText("Couldn't open this guild")).toBeNull()
  })

  it('remounts the view per guild, so search state resets', async () => {
    await renderApp(async () => {})
    const search = screen.getByPlaceholderText('Search roster…') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'zed' } })
    expect(search.value).toBe('zed')
    await act(async () => { fireEvent.click(row('Bravo')) })
    expect((screen.getByPlaceholderText('Search roster…') as HTMLInputElement).value).toBe('')
  })

  it('re-clicking the open, active guild does not switch again', async () => {
    const fc = await renderApp(async () => {})
    await act(async () => { fireEvent.click(row('Alpha')) })
    expect(fc.api.setActiveGuild).not.toHaveBeenCalled()
    expect(busy()).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/App.test.tsx`
Expected: FAIL. Before this task, nothing shows a skeleton mid-switch, Retry does not exist, and re-clicking calls `setActiveGuild`.

If the file fails to *load* (not just its assertions) because a module needs a browser API jsdom lacks (for example `matchMedia` in Mantine), add a `vi.mock` for the offending component at the top of the test, in the same way as `NotesEditor`. Do not change production code to suit jsdom.

- [ ] **Step 3: Change `App.tsx`.**

  1. **Imports and type.** Import `useRef` from React, `TabSkeleton` and `GuildTab` from `./components/skeletons/TabSkeleton`, and `LoadError` from `./components/LoadError`. Replace `type Tab = …` with `type Tab = GuildTab`.

  2. **State,** next to `rosterReset`:

```tsx
  // A guild switch in flight: App shows the target tab's skeleton and mounts
  // no view until setActiveGuild resolves. switchSeq makes only the latest
  // click count — an earlier switch resolving late is ignored.
  const switchSeq = useRef(0)
  const [switching, setSwitching] = useState<string | null>(null)
  const [switchError, setSwitchError] = useState<{ id: string; error: unknown } | null>(null)
  const [activeGuildId, setActiveGuildId] = useState<string | null>(null)
```

  3. **`loadGuilds`.** After `setRoles(roleMap)`, add `setActiveGuildId(list.find((g) => g.active)?.id ?? null)`.

  4. **`selectGuild`.** Replace it with:

```tsx
  // Selecting a guild makes it active (roster + sync follow) and lands on Roster.
  const selectGuild = async (id: string): Promise<void> => {
    setSelectedInviteId(null)
    setView('guild')
    setTab('roster')
    // Re-clicking the open guild drops out of any member detail to the list.
    setRosterReset((n) => n + 1)
    if (id === switching) return
    if (id === selectedId && id === activeGuildId && !switching && !switchError) return
    setSelectedId(id)
    const seq = ++switchSeq.current
    setSwitching(id)
    setSwitchError(null)
    try {
      await client.setActiveGuild(id)
      if (seq !== switchSeq.current) return
      setActiveGuildId(id)
      setSwitching(null)
      void loadGuilds()
    } catch (error) {
      if (seq !== switchSeq.current) return
      setSwitching(null)
      setSwitchError({ id, error })
    }
  }
```

  5. **Clear switch state when leaving the guild view.** Wherever the code sets `setView('add-guild')` or calls `selectInvite`, also bump `switchSeq.current++`, `setSwitching(null)` and `setSwitchError(null)`. That way a late resolution cannot override what the user went to.

  6. **Sidebar spinner.** In the guild row, replace `{g.active && (<span …diamond… />)}` with:

```tsx
                      {switching === g.id ? (
                        <span
                          className="axi-spinner"
                          style={{ '--axi-spinner-size': '12px' } as React.CSSProperties}
                          role="status"
                          aria-label="Opening guild…"
                        />
                      ) : (
                        g.active && (
                          <span
                            className={`${toneDiamond(SYNC_META[sync].tone)}${
                              sync === 'connecting' ? ' ar-work' : ''
                            }`}
                            title={SYNC_META[sync].label}
                          />
                        )
                      )}
```

  7. **The tab the pane shows.** After `const selected = …`, add:

```tsx
  // A tab whose feature is off for this guild falls back to the roster.
  const paneTab: Tab =
    (tab === 'retention' && !selected?.retentionEnabled) ||
    (tab === 'recruitment' && !selected?.pipelineEnabled)
      ? 'roster'
      : tab
```

  8. **The main ternary.** Replace everything from `) : tab === 'roster' ? (` through the closing `<GuildSettings … />` with:

```tsx
          ) : switching ? (
            <TabSkeleton tab={paneTab} />
          ) : switchError && switchError.id === selected.id ? (
            <LoadError
              title="Couldn't open this guild"
              error={switchError.error}
              onRetry={() => void selectGuild(switchError.id)}
            />
          ) : paneTab === 'roster' ? (
            <RosterView key={selected.id} resetToken={rosterReset} onOpenDeparted={openDeparted} />
          ) : paneTab === 'log' ? (
            <GuildLog key={selected.id} />
          ) : paneTab === 'departed' ? (
            <DepartedView key={selected.id} initialFilter={departedFilter} />
          ) : paneTab === 'sharing' ? (
            <GuildSharing key={selected.id} guild={selected} onOpenAppSettings={() => setAppSettingsOpen(true)} />
          ) : paneTab === 'retention' ? (
            <RetentionView key={selected.id} />
          ) : paneTab === 'recruitment' ? (
            <RecruitmentView key={selected.id} />
          ) : (
            <GuildSettings
              key={selected.id}
              guild={selected}
              role={roles[selected.gw2GuildId]}
              onChanged={loadGuilds}
              onRemoved={async () => {
                setView('guild')
                setSelectedId(null)
                await loadGuilds()
              }}
            />
          )}
```

  9. **Sub-tabs.** Leave them as they are. They already render from `selected?.retentionEnabled` / `selected?.pipelineEnabled`, which are the summary flags, and they stay usable mid-switch: clicking one changes `tab`, so the skeleton follows.

- [ ] **Step 4: Run the App tests and confirm they pass.**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/App.test.tsx`
Expected: PASS (5 tests).

Note that the first test's final assertion only proves that the search is not the skeleton's disabled input. RosterView still loads its data the old way until Task 8.

- [ ] **Step 5: Typecheck, run the full suite and commit.**

```bash
npm run typecheck && npm test
git add src/renderer/src/App.tsx src/renderer/src/App.test.tsx
git commit -m "$(printf 'feat(ui): guild switch shows the target tab skeleton, views keyed per guild\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### View adoption pattern (Tasks 7–12)

Every view task follows the same shape. Each task below gives the specifics.

- **A loader function at module scope** returns everything the view needs for one guild:
  - It throws an `Error` with the message to show when the load is unusable.
  - It does not set state.
- **The exported view is a thin gate:**

```tsx
export default function XView(props: XProps): JSX.Element {
  const q = useGuildData(loadX, { on: [/* per task */] })
  if (q.loading) return <XSkeleton />
  if (!q.data) return <LoadError title="Couldn't load <thing>" error={q.error} onRetry={() => void q.reload()} />
  return <XBody {...props} data={q.data} reload={q.reload} refreshing={q.refreshing} />
}
```

- **`XBody` is the old component body.** It is renamed, not exported, and receives `data`, `reload` and `refreshing`. Make these changes in it:
  - **Removed:** its own `load`, its `useEffect(() => { load() }, [load])`, every event subscription the hook now owns, and its `loading` state.
  - **Values that were state set only by `load`:** read them from `data` directly.
  - **Values that are also changed optimistically by the body** (for example a recoloured tag registry or a moved placement): `const [x, setX] = useState(data.x)` plus `useEffect(() => setX(data.x), [data.x])`.
  - **`load()` / `await load()` calls:** they become `reload()` / `await reload()`.
  - **The refresh button's spinner:** it uses `refreshing` where it used `loading`.
  - **Loading branches** (`loading && rows.length === 0 ? … 'Loading…'`): delete them, because the body never renders without data.
  - **"Nothing here" branches:** keep them (for example "No roster yet").
- **Regression test:** each task adds one at `src/renderer/src/components/<View>.test.tsx`, with `// @vitest-environment jsdom`, `afterEach(cleanup)` and `fakeClient`. If the view imports `MemberDetail`, add `vi.mock('./NotesEditor', () => ({ default: () => null }))`.

---

### Task 7: Log view

**Files:**
- Modify: `src/renderer/src/components/GuildLog.tsx:75-250`
- Create: `src/renderer/src/components/GuildLog.test.tsx`

**Interfaces:**
- Consumes: `useGuildData` and `LoadError` (Task 3), and `LogSkeleton` (Task 4).
- This view stays one component: the filters feed the loader, so the hook takes `deps`. Its early returns go after the last hook call.

- [ ] **Step 1: Write the failing tests.**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { deferred, fakeClient } from '../test/fakeClient'
import GuildLog from './GuildLog'

afterEach(cleanup)

describe('GuildLog loading', () => {
  it('shows the skeleton, not the empty state, while the first list loads', async () => {
    const list = deferred<{ events: never[]; updatedAt: string }>()
    fakeClient({ auditList: () => list.promise })
    render(<GuildLog />)
    expect(document.querySelector('[aria-label="Loading log…"]')).not.toBeNull()
    expect(screen.queryByText(/No log entries yet/)).toBeNull()
    await act(async () => list.resolve({ events: [], updatedAt: '' }))
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
    expect(screen.getByText(/No log entries yet/)).toBeTruthy()
  })

  it('refetches on a search change without showing the skeleton again', async () => {
    const fc = fakeClient()
    render(<GuildLog />)
    await act(async () => {})
    fireEvent.change(screen.getByPlaceholderText('Search name or action…'), { target: { value: 'kick' } })
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
    await act(async () => {})
    expect(fc.api.auditList).toHaveBeenLastCalledWith({ search: 'kick' })
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/components/GuildLog.test.tsx`
Expected: the first test FAILS, because today "No log entries yet" renders immediately.

- [ ] **Step 3: Adopt the hook.** In `GuildLog`:

  1. Delete `events` state, `index` state, `load`, `loadIdentities`, and the three effects that call them (initial load, workspace subscription, `onAuditUpdated`). Keep the `auditStatus` / `onAuditStatus` effect.
  2. Add:

```tsx
  const eventsQ = useGuildData(
    async () => {
      const filter: AuditFilter = {}
      if (source) filter.source = source
      if (search.trim()) filter.search = search.trim()
      return (await client.auditList(filter)).events
    },
    { on: ['audit', 'workspace'], deps: [source, search] }
  )
  // Identities only decorate rows, so a failure leaves raw names rather than
  // blocking the log.
  const identitiesQ = useGuildData(
    async () => {
      const res = await client.buildRoster().catch(() => null)
      return res?.ok ? buildIdentityIndex(res.data.members) : EMPTY_INDEX
    },
    { on: ['workspace'] }
  )
  const events = eventsQ.data ?? []
  const index = identitiesQ.data ?? EMPTY_INDEX
```

  3. Change `refresh` so that `await load()` becomes `await eventsQ.reload()`, with deps `[eventsQ.reload]`.
  4. Directly before the component's `return (`, after `const anySyncing = …`, add:

```tsx
  if (eventsQ.loading) return <LogSkeleton />
  if (!eventsQ.data) {
    return <LoadError title="Couldn't load the log" error={eventsQ.error} onRetry={() => void eventsQ.reload()} />
  }
```

  5. Import `useGuildData`, `LoadError` and `LogSkeleton`.

- [ ] **Step 4: Run the tests and confirm they pass,** then run the full suite.

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/components/GuildLog.test.tsx && npm test`

- [ ] **Step 5: Typecheck and commit.**

```bash
npm run typecheck
git add src/renderer/src/components/GuildLog.tsx src/renderer/src/components/GuildLog.test.tsx
git commit -m "$(printf 'fix(log): skeleton while loading instead of the empty state\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 8: Roster view

**Files:**
- Modify: `src/renderer/src/components/RosterView.tsx:57-140` and `:356-560`
- Create: `src/renderer/src/components/RosterView.test.tsx`

**Interfaces:**
- Consumes: `useGuildData` and `LoadError` (Task 3), and `RosterSkeleton` (Task 4).
- Keeps: the props `resetToken?: number` and `onOpenDeparted?: () => void` (ruling 2).

- [ ] **Step 1: Write the failing tests.**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { fakeClient } from '../test/fakeClient'

vi.mock('./NotesEditor', () => ({ default: () => null }))
import RosterView from './RosterView'

afterEach(cleanup)

describe('RosterView loading', () => {
  it('loads the tag registry on every mount, with the roster', async () => {
    const fc = fakeClient()
    const first = render(<RosterView key="a" />)
    await act(async () => {})
    expect(fc.api.getTagRegistry).toHaveBeenCalledTimes(1)
    first.rerender(<RosterView key="b" />)
    await act(async () => {})
    expect(fc.api.getTagRegistry).toHaveBeenCalledTimes(2)
  })

  it('also reloads the tag registry on a sync event', async () => {
    vi.useFakeTimers()
    const fc = fakeClient()
    render(<RosterView />)
    await act(async () => {})
    act(() => fc.emit('onSyncChanged'))
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(fc.api.getTagRegistry).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('shows LoadError when the first build fails', async () => {
    fakeClient({ buildRoster: async () => ({ ok: false, error: 'GW2 API down' }) })
    const { findByText } = render(<RosterView />)
    expect(await findByText("Couldn't load the roster")).toBeTruthy()
    expect(await findByText('GW2 API down')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail.** The registry is fetched once, and there is no `LoadError`.

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/components/RosterView.test.tsx`

- [ ] **Step 3: Add the loader and the gate.** Above `export default function RosterView`:

```tsx
interface RosterData {
  payload: RosterPayload
  departures: DepartureDoc[]
  registry: TagRegistry
  canEdit: boolean
}

async function loadRoster(): Promise<RosterData> {
  const [res, auth, registry] = await Promise.all([
    client.buildRoster(),
    client.authStatus().catch(() => null),
    client.getTagRegistry().catch(() => ({}))
  ])
  if (!res.ok) throw new Error(res.error)
  // Desktop detection runs inside buildRoster, so read departures after it.
  const rows = await client.departuresGet().catch(() => [])
  return {
    payload: res.data,
    departures: rows.map((r) => parseDepartureDoc(r.key, r.notes)),
    registry: parseRegistry(JSON.stringify(registry)),
    canEdit: auth?.role !== 'read'
  }
}

type RosterProps = { onOpenDeparted?: () => void; resetToken?: number }

export default function RosterView(props: RosterProps): JSX.Element {
  const q = useGuildData(loadRoster, { on: ['sync', 'workspace'] })
  if (q.loading) return <RosterSkeleton />
  if (!q.data) {
    return <LoadError title="Couldn't load the roster" error={q.error} onRetry={() => void q.reload()} />
  }
  return <RosterBody {...props} data={q.data} reload={q.reload} refreshing={q.refreshing} />
}
```

Match `RosterProps` to the existing prop types of `RosterView` exactly.

- [ ] **Step 4: Turn the old component into `RosterBody`.** Rename the old `export default function RosterView({ … })` to `function RosterBody({ onOpenDeparted, resetToken, data, reload, refreshing }: RosterProps & { data: RosterData; reload: () => Promise<void>; refreshing: boolean })`. Then make these edits in its body:
  1. **Delete** these states: `payload`, `loading`, `departures`, `error` and `canEdit`. Also delete the tag-registry `useEffect`, `load`, `refreshRole`, and the subscribe/debounce `useEffect`.
  2. **Add:**

```tsx
  const payload = data.payload
  const departures = data.departures
  const canEdit = data.canEdit
  const [registry, setRegistry] = useState<TagRegistry>(data.registry)
  useEffect(() => setRegistry(data.registry), [data.registry])
```

  3. **Delete** the old `const [registry, setRegistry] = useState<TagRegistry>({})`.
  4. **Replace** every `load()` / `await load()` with `reload()` / `await reload()`. This includes `onChanged={load}` (becomes `onChanged={reload}`) and the bulk-tag handlers.
  5. **Refresh button:** `<button onClick={load}` becomes `<button onClick={() => void reload()}`, and `className={loading ? 'ar-work' : ''}` becomes `className={refreshing ? 'ar-work' : ''}`.
  6. **Error banner:** delete the `{error && (<div className="ar-banner ar-banner--danger">…)}` block. A failed refresh now toasts.
  7. **Table branch:**
     - Delete the `loading && members.length === 0 ? (…Building roster…)` branch.
     - Change `) : !loading && filtered.length === 0 ? (` to `) : filtered.length === 0 ? (`, and make it the first branch: `{filtered.length === 0 ? (`.
  8. **`resetToken` effect:** keep it. Update its comment to: `// Clicking Roster (or re-clicking the open guild) bumps resetToken to drop out of the member detail back to the list. A guild switch remounts this view instead.`
  9. **Unused imports:** remove any left over (for example `AlertTriangle`, if nothing else uses it).

- [ ] **Step 5: Run the tests and confirm they pass,** then run the App tests and the full suite.

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/components/RosterView.test.tsx src/renderer/src/App.test.tsx && npm test`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit.**

```bash
npm run typecheck
git add src/renderer/src/components/RosterView.tsx src/renderer/src/components/RosterView.test.tsx
git commit -m "$(printf 'fix(roster): load per guild through useGuildData; tag registry reloads with the roster\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 9: Departed view

**Files:**
- Modify: `src/renderer/src/components/DepartedView.tsx:26-240`
- Create: `src/renderer/src/components/DepartedView.test.tsx`

**Interfaces:**
- Consumes: `useGuildData` and `LoadError` (Task 3), and `DepartedSkeleton` (Task 4).
- Keeps: the prop `initialFilter?: DepartedFilter`.

- [ ] **Step 1: Write the failing tests.**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { deferred, fakeClient } from '../test/fakeClient'
import DepartedView from './DepartedView'

afterEach(cleanup)

describe('DepartedView loading', () => {
  it('shows its skeleton until departures arrive, then the empty state', async () => {
    const rows = deferred<never[]>()
    fakeClient({ departuresGet: () => rows.promise })
    render(<DepartedView />)
    expect(document.querySelector('[aria-label="Loading departures…"]')).not.toBeNull()
    await act(async () => rows.resolve([]))
    expect(screen.getByText(/No departures recorded yet/)).toBeTruthy()
  })

  it('keeps showing departures with a banner when only the roster build fails', async () => {
    fakeClient({ buildRoster: async () => ({ ok: false, error: 'GW2 API down' }) })
    render(<DepartedView />)
    await act(async () => {})
    expect(screen.getByText('GW2 API down')).toBeTruthy()
    expect(screen.queryByText("Couldn't load departures")).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail.** The first test fails because no skeleton is shown today.

- [ ] **Step 3: Add the loader and the gate.**

```tsx
interface DepartedData {
  payload: RosterPayload | null
  /** The roster build failed; departures still show, matched against nothing. */
  rosterError: string | null
  docs: DepartureDoc[]
  canEdit: boolean
}

async function loadDeparted(): Promise<DepartedData> {
  const [roster, auth] = await Promise.all([client.buildRoster(), client.authStatus().catch(() => null)])
  // Desktop detection runs inside buildRoster, so read departures after it.
  const rows = await client.departuresGet()
  return {
    payload: roster.ok ? roster.data : null,
    rosterError: roster.ok ? null : roster.error,
    docs: rows.map((r) => parseDepartureDoc(r.key, r.notes)),
    canEdit: auth?.role !== 'read'
  }
}

export default function DepartedView(props: { initialFilter?: DepartedFilter }): JSX.Element {
  const q = useGuildData(loadDeparted, { on: ['sync'] })
  if (q.loading) return <DepartedSkeleton />
  if (!q.data) {
    return <LoadError title="Couldn't load departures" error={q.error} onRetry={() => void q.reload()} />
  }
  return <DepartedBody {...props} data={q.data} reload={q.reload} refreshing={q.refreshing} />
}
```

- [ ] **Step 4: Turn the old component into `DepartedBody`.** Rename the old component to `function DepartedBody({ initialFilter = 'all', data, reload, refreshing }: …)`. Then make these edits:
  1. **Delete** these states: `payload`, `loading`, `error` and `canEdit`. Also delete `load` and the subscription effect.
  2. **Add:**

```tsx
  const payload = data.payload
  const error = data.rosterError
  const canEdit = data.canEdit
  const [docs, setDocs] = useState<DepartureDoc[]>(data.docs)
  useEffect(() => setDocs(data.docs), [data.docs])
```

     Delete the old `docs` state.
  3. **Replace** `load()` / `await load()` with `reload()` / `await reload()`.
  4. **Refresh button:** `loading ? 'ar-work'` becomes `refreshing ? 'ar-work'`.
  5. **Delete** the `loading && rows.length === 0 ? (…Loading departures…)` branch, so `shown.length === 0 ? (` becomes the first branch.
  6. **Keep** the `{error && <div className="ar-banner ar-banner--danger">…}` banner. It now shows `rosterError`.

- [ ] **Step 5: Run the tests and confirm they pass,** then run the full suite and typecheck.

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/components/DepartedView.test.tsx && npm test && npm run typecheck`

- [ ] **Step 6: Commit.**

```bash
git add src/renderer/src/components/DepartedView.tsx src/renderer/src/components/DepartedView.test.tsx
git commit -m "$(printf 'feat(departed): skeleton and per-guild load through useGuildData\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 10: Retention view

**Files:**
- Modify: `src/renderer/src/components/RetentionView.tsx:27-130`
- Create: `src/renderer/src/components/RetentionView.test.tsx`

**Interfaces:**
- Consumes: `useGuildData` and `LoadError` (Task 3), `RetentionSkeleton` (Task 4), and `member` / `emptyRoster` (Task 3).

- [ ] **Step 1: Write the failing tests.**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { RosterPayload } from '../../../preload/index.d'
import { deferred, emptyRoster, fakeClient, member } from '../test/fakeClient'
import RetentionView from './RetentionView'

afterEach(cleanup)

const raid = { id: 'r1', date: new Date().toISOString(), accounts: ['old.1234'] }

describe('RetentionView', () => {
  it('shows its skeleton while loading', () => {
    fakeClient({ buildRoster: () => new Promise(() => {}) })
    render(<RetentionView />)
    expect(document.querySelector('[aria-label="Loading retention…"]')).not.toBeNull()
  })

  it('never logs results from a guild it has been unmounted from', async () => {
    const stale = deferred<{ ok: true; data: RosterPayload }>()
    const fc = fakeClient({ buildRoster: () => stale.promise })
    const first = render(<RetentionView key="old" />)
    first.unmount()
    await act(async () =>
      stale.resolve({ ok: true, data: { ...emptyRoster([member('old')]), attendance: [raid] as never } })
    )
    expect(fc.api.logRetention).not.toHaveBeenCalled()
  })
})
```

Before writing `raid`, check `AttendanceRaidDTO` in `src/preload/index.d.ts` and give `raid` that type's real field names. `computeRetention` must yield at least one non-`insufficient-data` result for `old`, which means at least `minRaids` raids. If it does not, repeat the raid object enough times. Read `DEFAULT_RETENTION_CONFIG` in `lib/retention.ts` to find the number.

- [ ] **Step 2: Run the tests.** The skeleton test FAILS. Check that the stale test asserts something real: temporarily change `loadRetention`'s result handling so it ignores unmount, and confirm the test then fails. Do this after Step 3, then revert the temporary change.

- [ ] **Step 3: Add the loader and the gate.**

```tsx
interface RetentionData { payload: RosterPayload; registry: TagRegistry; canEdit: boolean }

async function loadRetention(): Promise<RetentionData> {
  const [res, auth, registry] = await Promise.all([
    client.buildRoster(),
    client.authStatus().catch(() => null),
    client.getTagRegistry().catch(() => ({}))
  ])
  if (!res.ok) throw new Error(res.error)
  return { payload: res.data, registry: parseRegistry(JSON.stringify(registry)), canEdit: auth?.role !== 'read' }
}

export default function RetentionView(): JSX.Element {
  const q = useGuildData(loadRetention)
  if (q.loading) return <RetentionSkeleton />
  if (!q.data) {
    return <LoadError title="Couldn't load retention" error={q.error} onRetry={() => void q.reload()} />
  }
  return <RetentionBody data={q.data} reload={q.reload} refreshing={q.refreshing} />
}
```

- [ ] **Step 4: Turn the old component into `RetentionBody`.** Rename it to `function RetentionBody({ data, reload, refreshing }: …)`. Then make these edits:
  1. **Delete** these states: `payload`, `loading` and `canEdit`, plus `load` and its effect.
  2. **Add:**

```tsx
  const payload = data.payload
  const canEdit = data.canEdit
  const [registry, setRegistry] = useState<TagRegistry>(data.registry)
  useEffect(() => setRegistry(data.registry), [data.registry])
```

  3. **Replace** `await load()` with `await reload()` in `applyAdd` and `applyRemove`. Change `onClick={load}` to `onClick={() => void reload()}`, and `loading ? 'ar-work'` to `refreshing ? 'ar-work'`.

- [ ] **Step 5: Run the tests and confirm they pass,** then run the full suite and typecheck.

- [ ] **Step 6: Commit.**

```bash
git add src/renderer/src/components/RetentionView.tsx src/renderer/src/components/RetentionView.test.tsx
git commit -m "$(printf 'fix(retention): per-guild load; stale results never logged\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 11: Recruitment view

**Files:**
- Modify: `src/renderer/src/components/RecruitmentView.tsx:32-160` and `:320-345`
- Create: `src/renderer/src/components/RecruitmentView.test.tsx`

**Interfaces:**
- Consumes: `useGuildData` and `LoadError` (Task 3), `RecruitmentSkeleton` (Task 4), `member` and `emptyRoster` (Task 3), and `stageSeries` from `lib/pipeline` (Task 4).

- [ ] **Step 1: Write the failing tests.**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { RosterPayload } from '../../../preload/index.d'
import { deferred, emptyRoster, fakeClient, member } from '../test/fakeClient'
import RecruitmentView from './RecruitmentView'

afterEach(cleanup)

const pipe = (placement: Record<string, string>) => ({
  stages: undefined, placement, placedAt: {}, prospects: [], votes: [], commentCounts: {}
})

describe('RecruitmentView prune', () => {
  it('never prunes before its own roster has loaded', async () => {
    const roster = deferred<{ ok: true; data: RosterPayload }>()
    const fc = fakeClient({
      buildRoster: () => roster.promise,
      pipelineGet: async () => pipe({ m1: 'applied', ghost: 'applied' })
    })
    render(<RecruitmentView />)
    expect(document.querySelector('[aria-label="Loading recruitment…"]')).not.toBeNull()
    await act(async () => {})
    expect(fc.api.pipelinePrunePlacements).not.toHaveBeenCalled()
    await act(async () => roster.resolve({ ok: true, data: emptyRoster([member('m1')]) }))
    expect(fc.api.pipelinePrunePlacements).toHaveBeenCalledTimes(1)
    expect(fc.api.pipelinePrunePlacements).toHaveBeenCalledWith(['ghost'])
  })

  it('never prunes when its roster comes back empty', async () => {
    const fc = fakeClient({ pipelineGet: async () => pipe({ m1: 'applied' }) })
    render(<RecruitmentView />)
    await act(async () => {})
    expect(fc.api.pipelinePrunePlacements).not.toHaveBeenCalled()
  })

  it('prunes at most once per mount even after a background reload', async () => {
    const fc = fakeClient({
      buildRoster: async () => ({ ok: true, data: emptyRoster([member('m1')]) }),
      pipelineGet: async () => pipe({ m1: 'applied', ghost: 'applied' }),
      pipelinePrunePlacements: async () => 0
    })
    const { getByLabelText } = render(<RecruitmentView />)
    await act(async () => {})
    await act(async () => { getByLabelText('Refresh').click() })
    expect(fc.api.pipelinePrunePlacements).toHaveBeenCalledTimes(1)
  })
})
```

The third test clicks Refresh by its accessible name. If the refresh button in `RecruitmentView` has no `aria-label`, add `aria-label="Refresh"` to it in Step 4. The Tooltip text is not an accessible name.

- [ ] **Step 2: Run the tests.** The first test FAILS, because no skeleton is shown today.

- [ ] **Step 3: Add the loader and the gate.**

```tsx
type PipeDTO = Awaited<ReturnType<typeof client.pipelineGet>>
interface RecruitmentData {
  payload: RosterPayload | null
  pipe: PipeDTO
  auth: AuthStatus | null
  registry: TagRegistry
  departures: DepartureDoc[]
}

async function loadRecruitment(): Promise<RecruitmentData> {
  const [roster, pipe, auth, registry] = await Promise.all([
    client.buildRoster(),
    client.pipelineGet(),
    client.authStatus().catch(() => null),
    client.getTagRegistry().catch(() => ({}))
  ])
  const deps = await client.departuresGet().catch(() => [])
  return {
    payload: roster.ok ? roster.data : null,
    pipe,
    auth,
    registry: parseRegistry(JSON.stringify(registry)),
    departures: deps.map((r) => parseDepartureDoc(r.key, r.notes))
  }
}

export default function RecruitmentView(): JSX.Element {
  const q = useGuildData(loadRecruitment)
  if (q.loading) return <RecruitmentSkeleton />
  if (!q.data) {
    return <LoadError title="Couldn't load recruitment" error={q.error} onRetry={() => void q.reload()} />
  }
  return <RecruitmentBody data={q.data} reload={q.reload} refreshing={q.refreshing} />
}
```

Import `AuthStatus` from the preload types if it is not already imported.

- [ ] **Step 4: Turn the old component into `RecruitmentBody`.** Rename it to `function RecruitmentBody({ data, reload, refreshing }: …)`. Then make these edits:
  1. **Delete** `loading` state, `load` and its effect.
  2. **Seed the states from the loader's data.** Keep `stages`, `placement`, `placedAt`, `commentCounts`, `prospects`, `voteRows`, `myVote`, `registry` and `departures` as state, because the body updates several of them optimistically. Seed them from `data`, and re-seed when `data` changes, using the derivations the old `load` used:

```tsx
  const payload = data.payload
  const auth = data.auth
  const canEdit = auth?.role !== 'read'
  const myVoterId = auth?.userId ?? null
  const isOwner = auth?.role === 'owner'
  const currentUserId = auth?.userId ?? null
  const seed = useMemo(() => {
    const doc = parsePipelineDoc(JSON.stringify({ stages: data.pipe.stages, placement: data.pipe.placement }))
    const mine = data.pipe.votes.find((v) => v.voterId === (auth?.userId ?? ''))
    return {
      stages: doc.stages,
      placement: doc.placement,
      placedAt: data.pipe.placedAt ?? {},
      commentCounts: data.pipe.commentCounts ?? {},
      prospects: data.pipe.prospects,
      voteRows: data.pipe.votes.map((v) => parseVoteRow(JSON.stringify(v.row))),
      myVote: mine ? parseVoteRow(JSON.stringify(mine.row)) : {}
    }
  }, [data, auth])
  const [stages, setStages] = useState(seed.stages)
  const [placement, setPlacement] = useState(seed.placement)
  const [placedAt, setPlacedAt] = useState(seed.placedAt)
  const [commentCounts, setCommentCounts] = useState(seed.commentCounts)
  const [prospects, setProspects] = useState(seed.prospects)
  const [voteRows, setVoteRows] = useState(seed.voteRows)
  const [myVote, setMyVote] = useState(seed.myVote)
  const [registry, setRegistry] = useState<TagRegistry>(data.registry)
  const [departures, setDepartures] = useState<DepartureDoc[]>(data.departures)
  useEffect(() => {
    setStages(seed.stages)
    setPlacement(seed.placement)
    setPlacedAt(seed.placedAt)
    setCommentCounts(seed.commentCounts)
    setProspects(seed.prospects)
    setVoteRows(seed.voteRows)
    setMyVote(seed.myVote)
    setRegistry(data.registry)
    setDepartures(data.departures)
  }, [seed, data.registry, data.departures])
```

     Delete the old `useState` declarations these replace, and the old `payload`, `canEdit`, `myVoterId`, `isOwner` and `currentUserId` states. If a setter is now unused, drop it from the destructuring.
  3. **The prune effect.** Remove `loading` from it, since the body only exists with loaded data:

```tsx
  const prunedOnce = useRef(false)
  useEffect(() => {
    if (prunedOnce.current) return
    const stale = stalePlacementKeys(placement, subjects, members.length > 0)
    if (!stale.length) return
    prunedOnce.current = true
    void client.pipelinePrunePlacements(stale).then((n) => {
      if (!n) return
      setPlacement((prev) => {
        const next = { ...prev }
        for (const k of stale) delete next[k]
        return next
      })
    })
  }, [placement, subjects, members.length])
```

     Update the comment above it to say that it runs on this mount's own data only, because App remounts the view per guild.
  4. **Replace** every `load()` / `await load()` with `reload()` / `await reload()`, including `onChanged={() => { void load() }}`.
  5. **Refresh button:** `onClick={load}` becomes `onClick={() => void reload()}`, and `loading ? 'ar-work'` becomes `refreshing ? 'ar-work'`. Add `aria-label="Refresh"` to the button.

- [ ] **Step 5: Run the tests and confirm they pass,** then run the full suite and typecheck.

- [ ] **Step 6: Commit.**

```bash
git add src/renderer/src/components/RecruitmentView.tsx src/renderer/src/components/RecruitmentView.test.tsx
git commit -m "$(printf 'fix(recruitment): prune only on this guild\x27s loaded data; skeleton while loading\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 12: Sharing and Settings

**Files:**
- Modify: `src/renderer/src/components/GuildSharing.tsx:12-130`
- Modify: `src/renderer/src/components/GuildSettings.tsx:61-210`
- Create: `src/renderer/src/components/GuildSharing.test.tsx`
- Create: `src/renderer/src/components/GuildSettings.test.tsx`

**Interfaces:**
- Consumes: `useGuildData` and `LoadError` (Task 3), `SharingSkeleton` and `SettingsSkeleton` (Task 4), and `guild()` (Task 3).
- Keeps: the existing props of both components.

- [ ] **Step 1: Write the failing tests.**

`GuildSharing.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { fakeClient, guild } from '../test/fakeClient'
import GuildSharing from './GuildSharing'

afterEach(cleanup)

describe('GuildSharing', () => {
  it('loads exactly once per mount', async () => {
    const fc = fakeClient()
    render(<GuildSharing guild={guild('a')} onOpenAppSettings={() => {}} />)
    expect(document.querySelector('[aria-label="Loading sharing…"]')).not.toBeNull()
    await act(async () => {})
    expect(fc.api.adoptSharedKeys).toHaveBeenCalledTimes(1)
    expect(fc.api.listWorkspaceRoles).toHaveBeenCalledTimes(1)
  })
})
```

`GuildSettings.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { deferred, fakeClient, guild } from '../test/fakeClient'
import GuildSettings from './GuildSettings'

afterEach(cleanup)

const profile = (id: string, name: string) => ({ ...guild(id), name, gw2ApiKey: '', axitoolsKey: '' })

describe('GuildSettings', () => {
  it("never shows the previous guild's profile while the next one loads", async () => {
    const second = deferred<ReturnType<typeof profile>>()
    fakeClient({
      getGuild: (id: string) => (id === 'a' ? Promise.resolve(profile('a', 'Alpha Name')) : second.promise)
    } as never)
    const noop = (): void => {}
    const view = render(<GuildSettings key="a" guild={guild('a')} onChanged={noop} onRemoved={noop} />)
    await act(async () => {})
    expect(screen.getByDisplayValue('Alpha Name')).toBeTruthy()
    view.rerender(<GuildSettings key="b" guild={guild('b')} onChanged={noop} onRemoved={noop} />)
    expect(screen.queryByDisplayValue('Alpha Name')).toBeNull()
    expect(document.querySelector('[aria-label="Loading settings…"]')).not.toBeNull()
    await act(async () => second.resolve(profile('b', 'Bravo Name')))
    expect(screen.getByDisplayValue('Bravo Name')).toBeTruthy()
  })
})
```

Fill `profile()` from the `GuildProfile` type in `src/preload/index.d.ts`, with whatever fields `GuildEditor` reads from `initial` (`name`, `gw2ApiKey`, `gw2GuildId`, `axitoolsKey`, `bridgeRepos`, …). Use `as GuildProfile` if needed.

- [ ] **Step 2: Run the tests.** The Sharing test FAILS: today it shows a `Loader2`, not the skeleton. The Settings test FAILS on the skeleton assertion.

- [ ] **Step 3: Sharing — add the loader, the gate and the body.**

```tsx
interface SharingData { auth: AuthStatus; sync: string; role: string | null }

export default function GuildSharing(props: { guild: GuildSummary; onOpenAppSettings: () => void }): JSX.Element {
  const q = useGuildData<SharingData>(async () => {
    // Pick up the workspace's guild (and any AxiTools-sharing change) live.
    await client.adoptSharedKeys().catch(() => {})
    const [auth, sync, roleMap] = await Promise.all([
      client.authStatus(),
      client.syncStatus(),
      client.listWorkspaceRoles()
    ])
    // Role for THIS guild specifically — keyed by gw2GuildId, not auth:status's
    // effectiveWorkspace (which falls back to the user's first membership and
    // would bleed another workspace's role onto a local guild).
    return { auth, sync, role: roleMap[props.guild.gw2GuildId] ?? null }
  }, { on: ['workspace'] })
  if (q.loading) return <SharingSkeleton />
  if (!q.data) {
    return <LoadError title="Couldn't load sharing" error={q.error} onRetry={() => void q.reload()} />
  }
  return <SharingBody {...props} data={q.data} reload={q.reload} />
}
```

  Then rename the old component to `function SharingBody({ guild, onOpenAppSettings, data, reload }: …)` and edit it:
  1. **Delete** these states: `authStatus`, `syncStatus`, `role` and `loading`. Also delete `loadStatus` and the `useEffect` that ran `sync()`.
  2. **Add:** `const authStatus = data.auth`, `const syncStatus = data.sync` and `const role = data.role`.
  3. **Replace** `await loadStatus()` with `await reload()`.
  4. **Delete** the `{loading ? (<Loader2 …/>) : …}` branch. The ternary starts at `!authStatus?.signedIn ? (`.
  5. **Remove** `Loader2` from the imports if it is now unused.

- [ ] **Step 4: Settings — add the gate and the body.**

```tsx
export default function GuildSettings(props: {
  guild: GuildSummary
  role?: string
  onChanged: () => void
  onRemoved: () => void
}): JSX.Element {
  const q = useGuildData(async () => {
    const profile = await client.getGuild(props.guild.id)
    if (!profile) throw new Error('This guild no longer exists.')
    return profile
  })
  if (q.loading) return <SettingsSkeleton />
  if (!q.data) {
    return <LoadError title="Couldn't load settings" error={q.error} onRetry={() => void q.reload()} />
  }
  return <SettingsBody {...props} profile={q.data} reload={q.reload} />
}
```

  Then rename the old component to `function SettingsBody({ guild, role, onChanged, onRemoved, profile, reload }: …)` and edit it:
  1. **Delete** the `profile` state, `load` and its effect.
  2. **Replace** the `{profile ? (<GuildEditor …/>) : (<Loader2 …/>)}` block with just the `GuildEditor`. Its `onDone` becomes `async () => { await reload(); onChanged() }`, and `onCancel` becomes `() => void reload()`.
  3. **Remove** `Loader2` from the imports only if nothing else in the file uses it. `GuildEditor` uses it, so it probably stays.

- [ ] **Step 5: Run the tests and confirm they pass,** then run the full suite and typecheck.

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2 src/renderer/src/components/GuildSharing.test.tsx src/renderer/src/components/GuildSettings.test.tsx && npm test && npm run typecheck`

- [ ] **Step 6: Commit.**

```bash
git add src/renderer/src/components/GuildSharing.tsx src/renderer/src/components/GuildSharing.test.tsx src/renderer/src/components/GuildSettings.tsx src/renderer/src/components/GuildSettings.test.tsx
git commit -m "$(printf 'fix(sharing,settings): one load per guild, skeletons, no stale profile\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 13: Verify, publish axi-design (with approval), restore the dependency

**Files:**
- Modify: `package.json` and `package-lock.json` (`@axiapps/axi-design` → `^1.50.0`)

- [ ] **Step 1: Run every check on the branch.**

Run: `npm run typecheck && npm test && npm run build && npm run build:web`
Expected: all PASS.

Also confirm that no guild view still subscribes on its own to the events the hook owns:

Run: `grep -n "onSyncChanged\|onAuditUpdated\|onWorkspaceChanged" src/renderer/src/components/{RosterView,DepartedView,GuildLog,RetentionView,RecruitmentView,GuildSharing,GuildSettings}.tsx`
Expected: no output.

- [ ] **Step 2: Run the manual smoke test** in `npm run dev` (desktop) and `npm run dev:web` (web). Record the results in the task report.
  - On each tab (Roster, Log, Departed, Retention, Recruitment, Sharing, Settings), switch quickly between a large and a small guild:
    - The skeleton appears at once.
    - The previous guild's rows never appear.
    - When data lands, the stat cards, table header and toolbar do not move.
  - Click A, B and C quickly. The sidebar spinner tracks only the latest guild, and the pane ends on C.
  - Turn on OS reduced motion. The bars hold still and show no band.
  - Open a member detail, then click the Roster sub-tab. You return to the list.

- [ ] **Step 3: STOP and ask the user for approval to publish** `@axiapps/axi-design@1.50.0`, and to push the `../axi-design` `feat/skeleton` branch (or merge it to its main) and tag `v1.50.0`. Do not run `npm publish` or `git push` without an explicit yes.

- [ ] **Step 4: After approval and publish, restore the registry dependency.**

Run: `npm install @axiapps/axi-design@^1.50.0`
Expected: `package.json` shows `"@axiapps/axi-design": "^1.50.0"`, and `node_modules/@axiapps/axi-design` is no longer a symlink.

Then run: `npm run typecheck && npm test && npm run build && npm run build:web`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add package.json package-lock.json
git commit -m "$(printf 'chore(deps): @axiapps/axi-design ^1.50.0\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

Merging the AxiRoster branch is the user's call, through superpowers:finishing-a-development-branch.
