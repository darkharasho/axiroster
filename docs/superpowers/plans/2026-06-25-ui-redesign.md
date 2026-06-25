# AxiRoster UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-theme AxiRoster from amber-on-warm-stone to a flat Linear-style neutral dark theme, and restructure the roster into a table-first view with a Table/Cards toggle and click-through to a full-screen member detail.

**Architecture:** Almost all styling routes through Tailwind color tokens (`tailwind.config.js`) and component classes in `src/renderer/src/index.css` (`@layer components`). Re-theming is primarily a token swap; the structural work is confined to five renderer components (`Titlebar`, `App`, `RosterView`, `MemberDetail`, `SettingsView`). No `src/main`, `src/preload`, or `src/renderer/src/lib` behavior changes — lib helpers (`metrics.ts`, `status.ts`, `roleStyle.ts`, `matching.ts`, `ClassIcon.tsx`) are reused as-is.

**Tech Stack:** Electron 33 + electron-vite, React 18, TypeScript, Tailwind CSS 3, lucide-react, gw2-class-icons.

## Global Constraints

- **No backend/IPC/data-model changes.** Renderer-only. Do not edit `src/main/**`, `src/preload/**`, or change any `window.axiroster.*` call signature.
- **No new runtime dependencies.** No web-font fetches (CSP `default-src 'self'` blocks remote fonts; `style-src` has no `https:`). Use system font stacks only.
- **Preserve all existing behavior:** link/unlink, set-main, tags/nickname/notes, Discord role assign/unassign/kick, refresh, search, status filters, source-status pills with tooltips, error/warning banners, empty states.
- **Semantic colors are fixed** (do not re-map): status LEDs via `STATUS_META` (green `#22c55e`, blue `#3b82f6`, amber `#f59e0b`, red `#ef4444`, grey `#a8a29e`); sync colors in `App.tsx` `SYNC_META`; profession colors via `ClassIcon`/`gw2-class-icons`.
- **Accent:** indigo — `accent.DEFAULT #6366f1`, `accent.soft #818cf8`, `accent.deep #4f46e5`.
- **No test runner exists.** Per task, "verify" = `npm run typecheck` passes **and** a visual check via the in-app `sai_render_html` renderer (or `electron-vite dev`). There are no unit tests to write.
- **Nav stays Roster + Settings only.** No "Squads" tab.
- Spec: `docs/superpowers/specs/2026-06-25-ui-redesign-design.md`.

---

## File Structure

- `tailwind.config.js` — color tokens (`ink`, `panel`, `accent`), add `panel.hover`/`panel.line2`, mono font stack. **[modify]**
- `src/renderer/src/index.css` — restyle component classes (`.btn`, `.btn-accent`, `.chip`, `.field`, `.led`, `.titlebar-btn`); add `.card`, `.stat-card`, `.seg`/`.seg-item`, `.table-*` helpers. **[modify]**
- `src/renderer/src/components/Titlebar.tsx` — logo + window button restyle. **[modify]**
- `src/renderer/src/App.tsx` — rail + guild switcher + nav + sync footer restyle. **[modify]**
- `src/renderer/src/components/RosterView.tsx` — source strip, stat cards, filter pills, search/refresh, Table/Cards toggle, table view, card view, click→detail switch. **[modify, largest]**
- `src/renderer/src/components/MemberDetail.tsx` — full-screen layout with back + prev/next, header/tile restyle. **[modify]**
- `src/renderer/src/components/SettingsView.tsx` — token restyle only. **[modify]**

Tasks are ordered so the foundation (tokens/classes) lands first; each later task is independently reviewable.

---

## Task 1: Design tokens & component classes

**Files:**
- Modify: `tailwind.config.js`
- Modify: `src/renderer/src/index.css`

**Interfaces:**
- Produces: Tailwind utilities `bg-panel`, `bg-panel-raised`, `bg-panel-hover`, `border-panel-line`, `border-panel-line2`, `text-ink`/`text-ink-dim`/`text-ink-faint`, `text-accent`/`bg-accent`/`text-accent-soft`, `font-mono`; component classes `.btn`, `.btn-accent`, `.chip`, `.field`, `.led`, `.titlebar-btn`, `.card`, `.stat-card`, `.seg`, `.seg-item`. Every later task consumes these.

- [ ] **Step 1: Rewrite color tokens + mono stack in `tailwind.config.js`**

Replace the `theme.extend` block with:

```js
theme: {
  extend: {
    colors: {
      // AxiRoster palette — flat neutral-dark (Linear-style) with an indigo accent.
      ink: {
        DEFAULT: '#e9eaec',
        dim: '#9aa0a8',
        faint: '#646a73'
      },
      panel: {
        DEFAULT: '#0b0c0e', // app background
        raised: '#1a1c20', // cards / surfaces
        hover: '#15171a', // row/control hover
        line: '#222428', // hairline borders
        line2: '#2c2f35' // stronger borders / inputs
      },
      accent: {
        DEFAULT: '#6366f1',
        soft: '#818cf8',
        deep: '#4f46e5'
      }
    },
    fontFamily: {
      sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
    }
  }
}
```

- [ ] **Step 2: Restyle component classes in `src/renderer/src/index.css`**

Replace the `@layer components` block with (note new `.card`/`.stat-card`/`.seg` helpers and flat, glow-free styling; `.btn-accent` now uses solid indigo):

```css
@layer components {
  .titlebar-btn {
    @apply flex h-full w-11 items-center justify-center text-ink-dim transition hover:bg-panel-hover hover:text-ink;
  }
  .led {
    @apply inline-block h-2 w-2 rounded-full;
  }
  .chip {
    @apply inline-flex items-center gap-1 rounded-md border border-panel-line2 bg-panel-raised px-2 py-0.5 text-xs text-ink-dim;
  }
  .btn {
    @apply inline-flex items-center justify-center gap-2 rounded-lg border border-panel-line2 bg-panel-raised px-3 py-1.5 text-sm text-ink transition hover:border-accent/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-50;
  }
  .btn-accent {
    @apply border-transparent bg-accent text-white hover:bg-accent-deep;
  }
  .field {
    @apply w-full rounded-lg border border-panel-line2 bg-panel-raised px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent/70;
  }
  .card {
    @apply rounded-xl border border-panel-line bg-panel;
  }
  .stat-card {
    @apply rounded-xl border border-panel-line bg-panel px-4 py-3;
  }
  .seg {
    @apply inline-flex rounded-lg border border-panel-line2 bg-panel-raised p-0.5;
  }
  .seg-item {
    @apply cursor-pointer rounded-md px-3 py-1 text-xs font-semibold text-ink-faint transition;
  }
  .seg-item-on {
    @apply bg-panel text-ink;
  }
}
```

Leave the `@layer base` block and the `.drag`/`.no-drag` rules unchanged.

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS (no errors). CSS/config changes don't affect types but this confirms nothing broke.

- [ ] **Step 4: Visual sanity check**

Run `electron-vite dev` (or render a small snippet using the new classes). Expected: app background is near-black `#0b0c0e`, surfaces are `#1a1c20`, primary buttons are solid indigo. Existing screens still render (they'll look transitional until later tasks).

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.js src/renderer/src/index.css
git commit -m "Re-theme tokens + component classes to Linear-style dark"
```

---

## Task 2: Titlebar restyle

**Files:**
- Modify: `src/renderer/src/components/Titlebar.tsx`

**Interfaces:**
- Consumes: `.titlebar-btn` (Task 1), tokens. No exported API change.

- [ ] **Step 1: Replace the logo mark and bar styling**

In `Titlebar.tsx`, swap the `ShieldCheck` brand glyph for an indigo rounded-square mark and tighten the bar. Replace the brand `<div>` (lines ~18-26) with:

```tsx
<div className={`flex items-center gap-2 px-3 text-xs font-semibold tracking-wide text-ink-dim`}>
  <span className="h-4 w-4 rounded-md bg-gradient-to-br from-accent-soft to-accent-deep" />
  <span className="text-ink">AxiRoster</span>
</div>
```

Keep the outer `.drag` bar but update its classes to:

```tsx
<div className="drag flex h-9 shrink-0 select-none items-center justify-between border-b border-panel-line bg-panel">
```

Remove the now-unused `ShieldCheck` import and the unused `mac` conditional padding (keep the `mac`/`setMax` state and effects untouched — they still drive window controls). The window-control buttons (`Minus`/`Square`/`Copy`/`X`) and their handlers stay exactly as-is; the red close-hover stays.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS. (If `ShieldCheck` was removed from the import, confirm no other usage — there is none.)

- [ ] **Step 3: Visual check**

Run dev. Expected: 36px bar, indigo gradient logo square, "AxiRoster" wordmark, three window buttons; close button turns red on hover; drag still works.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Titlebar.tsx
git commit -m "Restyle titlebar with indigo logo mark"
```

---

## Task 3: App shell — rail, guild switcher, nav

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: tokens, `.led` (Task 1). No exported API change. `SYNC_META` colors are semantic — keep values, they already fit dark.

- [ ] **Step 1: Restyle the rail container, guild switcher, nav, and footer**

In `App.tsx`, keep all state/effects/handlers (`section`, `sync`, `guilds`, `loadGuilds`, `swapGuild`, `nav` array) unchanged. Update only classNames in the returned JSX:

- Rail `<aside>`: `className="flex w-56 shrink-0 flex-col border-r border-panel-line bg-panel"` (unchanged structurally; tokens now resolve to dark).
- Guild buttons: active state uses an indigo wash instead of the raised panel. Replace the active/inactive ternary with:

```tsx
className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
  g.active
    ? 'bg-accent/12 text-white'
    : 'text-ink-dim hover:bg-panel-hover hover:text-ink'
}`}
```

- Replace the `Shield` glyph next to each guild with a small crest tile showing initials. Swap the `<Shield .../>` line for:

```tsx
<span className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-panel-line2 bg-panel-raised text-[9px] font-bold text-ink-dim">
  {g.name.slice(0, 2).toUpperCase()}
</span>
```

(Keep the leading status `<span className="led ...">` dot and the trailing truncated name.) Remove the now-unused `Shield` import.

- Nav buttons active state: replace `'bg-panel-raised text-white'` with `'bg-accent/12 text-white'`; inactive hover `'hover:bg-panel-raised/60'` → `'hover:bg-panel-hover'`. Round to `rounded-lg`.
- Sync footer: keep `SYNC_META[sync].color` LED and label; no change needed beyond inherited tokens.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (confirm `Shield` removed from the lucide import line; `Users`, `Settings as SettingsIcon`, `Plus` remain).

- [ ] **Step 3: Visual check**

Run dev. Expected: dark rail, guild rows with initials crest + status dot, active guild/nav use indigo wash, sync footer LED shows correct color.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "Restyle app rail, guild switcher, and nav"
```

---

## Task 4: RosterView — header, stat cards, filters, view toggle, table view

**Files:**
- Modify: `src/renderer/src/components/RosterView.tsx`

**Interfaces:**
- Consumes: `STATUS_META`, `fmtRelative` (`lib/status`), `aggregateMemberMetrics` (`lib/metrics`), `ClassIcon`, tokens, `.stat-card`/`.seg`/`.card`/`.chip`/`.field`/`.btn` (Task 1).
- Produces: a `view` state (`'table' | 'cards'`) and a `MemberTable` render consumed by Task 5's card view and Task 6's detail switch. A `derive(member)` helper returning `{ metrics, attendance, mainClass, lastSeen }` reused by both table and cards.

- [ ] **Step 1: Add view state and a per-member derive helper**

At the top of the `RosterView` component, after the existing `useState` hooks, add:

```tsx
const [view, setView] = useState<'table' | 'cards'>('table')
```

Add this helper function at module scope (below the component, near `MemberRow`):

```tsx
// Derive the display fields the table/cards need from a member + payload metrics.
function deriveRow(member: ReconciledMember, metrics: Record<string, BridgePlayerMetrics>) {
  const m = aggregateMemberMetrics(member.accounts, metrics)
  const attendance =
    m && m.raidsConsidered > 0 ? Math.round((m.raidsAttended / m.raidsConsidered) * 100) : null
  return {
    mainClass: m?.mainClass ?? null,
    attendance,
    lastSeen: m ? fmtRelative(m.lastSeen) : '—',
    account: member.accounts[0]?.account_name ?? member.discordName ?? '—'
  }
}
```

Add `BridgePlayerMetrics` to the type import from `../../../preload/index.d`, and import `aggregateMemberMetrics` from `../lib/metrics`, `fmtRelative` from `../lib/status`, and `ClassIcon` from `./ClassIcon`. Add `Users` (or keep existing) lucide icons as needed; add no behavior.

- [ ] **Step 2: Add stat-card derivations**

Inside the component, after `counts`, add:

```tsx
const stats = useMemo(() => {
  const linked = members.filter((m) => m.status === 'verified' || m.status === 'linked').length
  const tracked = members.filter((m) => aggregateMemberMetrics(m.accounts, payload?.metrics ?? {})).length
  const atts = members
    .map((m) => deriveRow(m, payload?.metrics ?? {}).attendance)
    .filter((a): a is number => a !== null)
  const avgAtt = atts.length ? Math.round(atts.reduce((s, a) => s + a, 0) / atts.length) : null
  return { total: members.length, linked, tracked, avgAtt }
}, [members, payload])
```

- [ ] **Step 3: Replace the main-area body with header + table**

The current layout is a narrow list + side detail. Replace the `return (...)` JSX body so that, **when no member is selected**, the main area shows: source strip (keep `SourcePill`s as-is) → stat cards → search/refresh/toggle row → filter pills → table. Use this structure for the non-detail branch:

```tsx
return (
  <div className="flex h-full min-h-0 flex-col">
    {/* source-status strip — unchanged SourcePill row */}
    <div className="flex items-center gap-2 overflow-hidden border-b border-panel-line px-3 py-2">
      <SourcePill icon={<Swords size={13} />} label="GW2" s={payload?.sources.gw2} unit="members" />
      <SourcePill icon={<MessageSquare size={13} />} label="Discord" s={payload?.sources.discord} unit="members" />
      <SourcePill icon={<Activity size={13} />} label="AxiBridge" s={payload?.sources.bridge} unit="tracked" />
      <div className="ml-auto shrink-0 text-xs text-ink-faint">{members.length} in roster</div>
    </div>

    {selected ? (
      <MemberDetail
        member={selected}
        metrics={payload?.metrics ?? {}}
        discordGuildId={payload?.discordGuildId ?? null}
        discordRoles={payload?.discordRoles ?? []}
        discordCandidates={payload?.discordCandidates ?? []}
        onSelect={setSelectedKey}
        onChanged={load}
        onBack={() => setSelectedKey(null)}
        siblings={filtered.map((m) => m.annotationKey)}
      />
    ) : (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* error + warnings */}
        {error && (
          <div className="flex items-center gap-2 border-b border-panel-line bg-red-500/10 px-4 py-2 text-sm text-red-300">
            <AlertTriangle size={15} /> {error}
          </div>
        )}
        {payload?.warnings.map((w) => (
          <div key={w} className="flex items-center gap-2 border-b border-panel-line bg-amber-500/10 px-4 py-1.5 text-xs text-amber-300">
            <AlertTriangle size={13} /> {w}
          </div>
        ))}

        {/* stat cards */}
        <div className="grid grid-cols-4 gap-3 px-4 pt-4">
          <StatCard k="Members" v={String(stats.total)} />
          <StatCard k="Linked" v={`${stats.linked} / ${stats.total}`} />
          <StatCard k="Tracked (AxiBridge)" v={String(stats.tracked)} />
          <StatCard k="Avg attendance" v={stats.avgAtt !== null ? `${stats.avgAtt}%` : '—'} />
        </div>

        {/* controls */}
        <div className="flex items-center gap-2 px-4 py-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={15} className="absolute left-2.5 top-2.5 text-ink-faint" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search roster…" className="field pl-8" />
          </div>
          <div className="seg">
            <button onClick={() => setView('table')} className={`seg-item ${view === 'table' ? 'seg-item-on' : ''}`}>Table</button>
            <button onClick={() => setView('cards')} className={`seg-item ${view === 'cards' ? 'seg-item-on' : ''}`}>Cards</button>
          </div>
          <button onClick={load} className="btn px-2" title="Refresh">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* filter pills */}
        <div className="flex flex-wrap gap-1 px-4 pb-3">
          {filters.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-2.5 py-0.5 text-xs transition ${
              filter === f ? 'bg-accent/15 text-accent-soft' : 'text-ink-dim hover:text-ink'
            }`}>
              {f === 'all' ? 'All' : STATUS_META[f].label}
              <span className="ml-1 text-ink-faint">{counts[f] ?? 0}</span>
            </button>
          ))}
        </div>

        {/* table / cards */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {view === 'table' ? (
            <MemberTable rows={filtered} metrics={payload?.metrics ?? {}} onSelect={setSelectedKey} />
          ) : (
            <MemberCards rows={filtered} metrics={payload?.metrics ?? {}} onSelect={setSelectedKey} />
          )}
          {!loading && filtered.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-ink-faint">
              {members.length === 0 ? 'No roster yet — connect GW2 + Discord in Settings.' : 'No members match.'}
            </div>
          )}
        </div>
      </div>
    )}
  </div>
)
```

(`MemberCards` is implemented in Task 5 — for this task, render only `MemberTable` and temporarily render `null` for the cards branch, or implement `MemberCards` as a stub returning `null`. Recommended: stub it so typecheck passes, fill in Task 5.)

- [ ] **Step 2b: Add `StatCard` and `MemberTable` components**

At module scope add:

```tsx
function StatCard({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div className="stat-card">
      <div className="text-xs font-medium text-ink-faint">{k}</div>
      <div className="mt-1 font-mono text-2xl font-bold text-ink">{v}</div>
    </div>
  )
}

function MemberTable({
  rows,
  metrics,
  onSelect
}: {
  rows: ReconciledMember[]
  metrics: Record<string, BridgePlayerMetrics>
  onSelect: (k: string) => void
}): JSX.Element {
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[16px_1.6fr_1fr_120px_1fr_90px] gap-3 border-b border-panel-line px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        <div></div><div>Member</div><div>Profession</div><div>Rank</div><div>Attendance</div><div>Last seen</div>
      </div>
      {rows.map((m) => {
        const d = deriveRow(m, metrics)
        const meta = STATUS_META[m.status]
        return (
          <button
            key={m.annotationKey}
            onClick={() => onSelect(m.annotationKey)}
            className="grid w-full grid-cols-[16px_1.6fr_1fr_120px_1fr_90px] items-center gap-3 border-b border-panel-line/60 px-4 py-2.5 text-left transition last:border-0 hover:bg-panel-hover"
          >
            <span className="led" style={{ background: meta.color }} title={meta.label} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">{m.label}</div>
              <div className="truncate text-xs text-ink-faint">{d.account}</div>
            </div>
            <div className="flex min-w-0 items-center gap-2 text-sm text-ink-dim">
              {d.mainClass ? <ClassIcon name={d.mainClass} size={16} /> : null}
              <span className="truncate">{d.mainClass ?? '—'}</span>
            </div>
            <div>
              {m.rank ? <span className="chip">{m.rank}</span> : <span className="text-xs text-ink-faint">—</span>}
            </div>
            <div>
              {d.attendance !== null ? (
                <>
                  <div className="h-1.5 overflow-hidden rounded-full bg-panel-line2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${d.attendance}%` }} />
                  </div>
                  <div className="mt-1 font-mono text-xs text-ink-dim">{d.attendance}%</div>
                </>
              ) : (
                <span className="text-xs text-ink-faint">—</span>
              )}
            </div>
            <div className="text-right font-mono text-xs text-ink-dim">{d.lastSeen}</div>
          </button>
        )
      })}
    </div>
  )
}
```

Add a temporary stub so Task 5 has a seam:

```tsx
function MemberCards(_: { rows: ReconciledMember[]; metrics: Record<string, BridgePlayerMetrics>; onSelect: (k: string) => void }): JSX.Element | null {
  return null // implemented in Task 5
}
```

Remove the now-unused `MemberRow` component (the narrow-list row is replaced by the table). Keep `SourcePill` unchanged.

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS. Common fixes: ensure `MemberDetail` accepts the new `onBack` and `siblings` props — Task 6 adds them; until then, **temporarily** add `onBack?: () => void` and `siblings?: string[]` as optional props in `MemberDetail`'s signature so this task typechecks, OR implement Task 6 immediately after. (If executing strictly task-by-task, add the two optional props to `MemberDetail` now as a no-op; Task 6 wires them.)

- [ ] **Step 4: Visual check**

Run dev. Expected: stat cards row, search + Table/Cards toggle + refresh, filter pills with counts, full-width member table with status dot, class icon, rank chip, attendance bar, last-seen. Clicking a row opens the (still old-styled) detail; Cards view shows nothing yet.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/RosterView.tsx src/renderer/src/components/MemberDetail.tsx
git commit -m "Roster: stat cards, filters, Table view, view toggle"
```

---

## Task 5: RosterView — card view

**Files:**
- Modify: `src/renderer/src/components/RosterView.tsx`

**Interfaces:**
- Consumes: `deriveRow`, `STATUS_META`, `ClassIcon`, tokens, `.card` (Tasks 1, 4).

- [ ] **Step 1: Implement `MemberCards`**

Replace the `MemberCards` stub from Task 4 with:

```tsx
function MemberCards({
  rows,
  metrics,
  onSelect
}: {
  rows: ReconciledMember[]
  metrics: Record<string, BridgePlayerMetrics>
  onSelect: (k: string) => void
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
      {rows.map((m) => {
        const d = deriveRow(m, metrics)
        const meta = STATUS_META[m.status]
        return (
          <button
            key={m.annotationKey}
            onClick={() => onSelect(m.annotationKey)}
            className="card p-4 text-left transition hover:border-panel-line2 hover:bg-panel-hover"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-panel-line2 bg-panel-raised">
                {d.mainClass ? <ClassIcon name={d.mainClass} size={20} /> : <span className="led" style={{ background: meta.color }} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{m.label}</div>
                <div className="truncate text-xs text-ink-faint">{d.mainClass ?? d.account}</div>
              </div>
              {m.rank ? <span className="chip shrink-0">{m.rank}</span> : null}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="text-ink-faint">Attendance</span>
              <span className="font-mono text-ink-dim">{d.attendance !== null ? `${d.attendance}%` : '—'}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-line2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${d.attendance ?? 0}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-ink-faint">
                <span className="led" style={{ background: meta.color }} /> {meta.label}
              </span>
              <span className="font-mono text-ink-faint">{d.lastSeen}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Visual check**

Run dev, click the **Cards** toggle. Expected: responsive 2–3 column grid of member cards with class avatar, rank chip, attendance bar, status, last-seen; clicking a card opens detail.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/RosterView.tsx
git commit -m "Roster: card view toggle"
```

---

## Task 6: MemberDetail — full-screen layout with back + prev/next

**Files:**
- Modify: `src/renderer/src/components/MemberDetail.tsx`

**Interfaces:**
- Consumes: new props `onBack: () => void` and `siblings: string[]` (the filtered annotationKeys, in order) passed from `RosterView` (Task 4). Existing props unchanged.
- Produces: the final `MemberDetail` signature consumed by `RosterView`.

- [ ] **Step 1: Extend the component signature**

Update the destructured props and type to add `onBack` and `siblings` (replace the temporary optional props from Task 4 with required ones):

```tsx
export default function MemberDetail({
  member,
  metrics,
  discordGuildId,
  discordRoles,
  discordCandidates,
  onSelect,
  onChanged,
  onBack,
  siblings
}: {
  member: ReconciledMember
  metrics: Record<string, BridgePlayerMetrics>
  discordGuildId: string | null
  discordRoles: DiscordRole[]
  discordCandidates: DiscordCandidate[]
  onSelect: (annotationKey: string) => void
  onChanged: () => void
  onBack: () => void
  siblings: string[]
}): JSX.Element {
```

- [ ] **Step 2: Add a detail toolbar (back + prev/next) above the header**

Compute neighbors and prepend a sticky toolbar inside the outer scroll container, before the existing header `<div className="border-b ...">`:

```tsx
const idx = siblings.indexOf(member.annotationKey)
const prevKey = idx > 0 ? siblings[idx - 1] : null
const nextKey = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null
```

```tsx
<div className="sticky top-0 z-10 flex items-center gap-2 border-b border-panel-line bg-panel/95 px-4 py-2 backdrop-blur">
  <button onClick={onBack} className="btn px-2 py-1 text-xs"><ChevronLeft size={14} /> Roster</button>
  <div className="ml-auto flex items-center gap-1">
    <span className="mr-2 text-xs text-ink-faint">{idx + 1} / {siblings.length}</span>
    <button onClick={() => prevKey && onSelect(prevKey)} disabled={!prevKey} className="btn px-2 py-1"><ChevronUp size={14} /></button>
    <button onClick={() => nextKey && onSelect(nextKey)} disabled={!nextKey} className="btn px-2 py-1"><ChevronDown size={14} /></button>
  </div>
</div>
```

Add `ChevronLeft`, `ChevronUp`, `ChevronDown` to the lucide-react import.

- [ ] **Step 3: Restyle the header with a class avatar**

Replace the header block (currently `<div className="border-b border-panel-line px-6 py-5">…`) so it leads with a class avatar built from the member's aggregated main class. Just above the `return`, the existing `const m = aggregateMemberMetrics(...)` already gives `m?.mainClass`. Use:

```tsx
<div className="flex items-center gap-4 border-b border-panel-line px-6 py-5">
  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-panel-line2 bg-panel-raised">
    {m?.mainClass ? <ClassIcon name={m.mainClass} size={30} /> : <span className="led h-3 w-3" style={{ background: meta.color }} />}
  </span>
  <div className="min-w-0">
    <div className="flex items-center gap-3">
      <h1 className="truncate text-lg font-semibold text-white">{member.label}</h1>
      <span className="chip">{meta.label}</span>
      {member.linkSource && <span className="chip">{member.linkSource} link</span>}
    </div>
    <div className="mt-1 text-sm text-ink-dim">
      {member.discordName ? `@${member.discordName}` : 'No Discord match'}
      {member.rank ? ` · ${member.rank}` : ''}
    </div>
  </div>
</div>
```

The rest of the component (annotations, GW2 accounts, WvW activity, commander panel, Discord roles, footer) keeps its structure; the indigo accent now applies automatically to the commander callout (`border-accent/30 bg-accent/5 text-accent-soft`) and `Star`/main indicators via inherited tokens. No behavioral change.

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS. Confirm `RosterView` passes `onBack` + `siblings` (added in Task 4) and that the temporary optional props are now required.

- [ ] **Step 5: Visual check**

Run dev. Click a member → full-screen detail with a back button, `N / total` counter, up/down to move through the filtered list; class avatar in header; commander/activity cards use indigo. All actions (tags, notes, link/unlink, set-main, role add/remove, kick) still work.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/MemberDetail.tsx
git commit -m "MemberDetail: full-screen layout with back + prev/next nav"
```

---

## Task 7: SettingsView restyle

**Files:**
- Modify: `src/renderer/src/components/SettingsView.tsx`

**Interfaces:**
- Consumes: tokens + `.btn`/`.field`/`.chip`/`.card` (Task 1). No behavior change.

- [ ] **Step 1: Audit and align classnames**

Open `SettingsView.tsx` and replace any hard-coded legacy surface classes with the token classes so it matches the new system. Specifically search-and-align:
- Raw panels/sections → wrap in `.card` or `bg-panel`/`bg-panel-raised` with `border-panel-line`.
- Inputs/selects/textareas → `.field`.
- Buttons → `.btn` / `.btn-accent` (primary save/connect actions use `.btn-accent`).
- Any `text-accent`/amber references already resolve to indigo via tokens — leave semantic status colors (green/red/amber for connection state) as literal hex if present.

Do not change form logic, IPC calls, validation, or field order — restyle only.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Visual check**

Run dev, open Settings. Expected: cards/inputs/buttons match the dark theme; primary actions are indigo; all settings still load, save, and connect (GW2 key, Discord/axitools, guild fields, bridge repos).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/SettingsView.tsx
git commit -m "Restyle settings view to dark theme"
```

---

## Final verification

- [ ] Run `npm run typecheck` — clean.
- [ ] Run `electron-vite dev` and walk every screen: rail/guild switch, roster table + cards toggle + filters + search, member detail (back + prev/next + all actions), settings.
- [ ] Confirm no remaining amber/stone surfaces (visual scan). Sync/status/profession semantic colors intact.
- [ ] Update screenshots if the README has any (optional; see `readme-screenshots` skill).

## Self-Review (completed by plan author)

- **Spec coverage:** §1 tokens → Task 1. §2 roster (source strip, stat cards, filters, table, cards toggle, click-through) → Tasks 4–5. §3 member detail full-screen + restyle → Task 6. §4 settings + titlebar → Tasks 2, 7. Rail/guild switcher (App) → Task 3. No "Squads", no backend change — honored in Global Constraints.
- **Placeholders:** none — all steps carry concrete code or exact class mappings. The one cross-task seam (`MemberDetail` props) is called out explicitly with the temporary-optional-then-required handling.
- **Type consistency:** `deriveRow`, `MemberTable`, `MemberCards`, `StatCard`, `BridgePlayerMetrics`, `aggregateMemberMetrics`, and the `onBack`/`siblings` prop names match across Tasks 4–6.
