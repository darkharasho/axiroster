# Audit Log Robustness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Discord audit rows always show an action verb, a cleanly-formatted actor, and resolved `#channel` names — by emitting structured fields from AxiTools and rendering them in AxiRoster.

**Architecture:** Additive. AxiTools (Python bot) gains four nullable columns (`channel_id`, `channel_name`, `actor_is_bot`, `target_type`), populated at its single `_log_discord_event` choke point and returned by the `/audit/discord` endpoint. AxiRoster carries them through `raw`, always leads each row with the humanized `event_type` verb, and renders the channel as a chip. Old rows (NULL structured fields) fall back to the dimmed raw channel id.

**Tech Stack:** Python 3 + discord.py + SQLite (AxiTools, pytest); TypeScript + React + vitest (AxiRoster).

**Repos:** `../axitools` (producer), `.` = `axiroster` (consumer). Producer Tasks 1–3, consumer Tasks 4–8, verify Task 9.

## Global Constraints

- **Additive only.** Do not break the existing JSON fields (`id`, `created_at`, `event_type`, `actor_id`, `actor_name`, `target_id`, `target_name`, `details`) or remove `details`. No historical backfill on either side.
- AxiRoster vitest runs with `--pool=forks --poolOptions.forks.maxForks=2`. Never raise parallelism.
- New columns are **nullable**; old rows read back as NULL and must still render (dimmed-id fallback, never silently drop — the approved "Option 2" behavior).
- `target_type` values: `user | role | channel | message | emoji | guild` (or NULL).
- AxiTools snowflake ids cross the API as **strings** (JS safety); the existing `_sid()` helper already does this for actor/target ids — reuse it for `channel_id`.

---

## Producer — AxiTools (`../axitools`)

### Task 1: Storage — structured columns + round-trip

**Files:**
- Modify: `axitools/storage.py` (`AuditStore._ensure_schema` ~1382, `AuditStore.add_discord_event` ~1428)
- Test: `tests/test_storage.py`

**Interfaces:**
- Produces: `add_discord_event(..., channel_id: Optional[str], channel_name: Optional[str], actor_is_bot: Optional[bool], target_type: Optional[str])`. `query_discord_events_filtered` already does `SELECT *`, so new columns flow to rows automatically.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_storage.py`:

```python
def test_discord_audit_structured_fields_round_trip(tmp_path):
    from axitools.storage import StorageManager

    storage = StorageManager(tmp_path)
    store = storage.get_audit_store(123)
    store.add_discord_event(
        created_at="2026-06-30T07:38:00Z",
        event_type="channel_create",
        actor_id=42,
        actor_name="<@42> (rooster)",
        target_id=None,
        target_name=None,
        details="",
        channel_id="1449262177046495356",
        channel_name="raid-signups",
        actor_is_bot=True,
        target_type="channel",
    )
    rows = store.query_discord_events_filtered(limit=10)
    assert len(rows) == 1
    row = rows[0]
    assert row["channel_id"] == "1449262177046495356"
    assert row["channel_name"] == "raid-signups"
    assert row["actor_is_bot"] == 1
    assert row["target_type"] == "channel"


def test_discord_audit_structured_fields_default_null(tmp_path):
    from axitools.storage import StorageManager

    storage = StorageManager(tmp_path)
    store = storage.get_audit_store(124)
    store.add_discord_event(
        created_at="2026-06-30T07:38:00Z",
        event_type="member_leave",
        actor_id=None,
        actor_name=None,
        target_id=7,
        target_name="<@7> (khava)",
        details="Details: Member left the server.",
    )
    row = store.query_discord_events_filtered(limit=10)[0]
    assert row["channel_id"] is None
    assert row["channel_name"] is None
    assert row["actor_is_bot"] is None
    assert row["target_type"] is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /var/home/mstephens/Documents/GitHub/axitools && python -m pytest tests/test_storage.py -k discord_audit_structured -q`
Expected: FAIL — `add_discord_event() got an unexpected keyword argument 'channel_id'`.

- [ ] **Step 3: Add the columns to the schema + a migration for existing DBs**

In `axitools/storage.py`, in `AuditStore._ensure_schema`, add the four columns to the `CREATE TABLE IF NOT EXISTS discord_audit_events (...)` definition (so fresh DBs have them) — insert after the `details TEXT` line:

```sql
                    details TEXT,
                    channel_id TEXT,
                    channel_name TEXT,
                    actor_is_bot INTEGER,
                    target_type TEXT
```

Then, because `CREATE TABLE IF NOT EXISTS` does not alter existing tables, add a migration call at the end of `_ensure_schema` (after the `executescript(...)` block, still inside the `with self._connect() as connection:`):

```python
            self._migrate_discord_columns(connection)
```

And add the migration method to the `AuditStore` class (next to `_ensure_schema`):

```python
    @staticmethod
    def _migrate_discord_columns(connection) -> None:
        existing = {
            row["name"] for row in connection.execute("PRAGMA table_info(discord_audit_events)")
        }
        for column, ddl in (
            ("channel_id", "channel_id TEXT"),
            ("channel_name", "channel_name TEXT"),
            ("actor_is_bot", "actor_is_bot INTEGER"),
            ("target_type", "target_type TEXT"),
        ):
            if column not in existing:
                connection.execute(f"ALTER TABLE discord_audit_events ADD COLUMN {ddl}")
```

- [ ] **Step 4: Extend `add_discord_event`**

Replace the `add_discord_event` signature and INSERT in `axitools/storage.py`:

```python
    def add_discord_event(
        self,
        *,
        created_at: str,
        event_type: str,
        actor_id: Optional[int],
        actor_name: Optional[str],
        target_id: Optional[int],
        target_name: Optional[str],
        details: Optional[str],
        channel_id: Optional[str] = None,
        channel_name: Optional[str] = None,
        actor_is_bot: Optional[bool] = None,
        target_type: Optional[str] = None,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO discord_audit_events (
                    created_at,
                    event_type,
                    actor_id,
                    actor_name,
                    actor_name_normalized,
                    target_id,
                    target_name,
                    target_name_normalized,
                    details,
                    channel_id,
                    channel_name,
                    actor_is_bot,
                    target_type
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    created_at,
                    event_type,
                    actor_id,
                    actor_name,
                    self._normalise_name(actor_name),
                    target_id,
                    target_name,
                    self._normalise_name(target_name),
                    details,
                    channel_id,
                    channel_name,
                    None if actor_is_bot is None else int(actor_is_bot),
                    target_type,
                ),
            )
```

- [ ] **Step 5: Run to verify it passes**

Run: `python -m pytest tests/test_storage.py -k discord_audit_structured -q`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add axitools/storage.py tests/test_storage.py
git commit -m "feat(audit): structured channel/actor_is_bot/target_type columns"
```

---

### Task 2: Capture — derive structured fields at the choke point

**Files:**
- Modify: `axitools/cogs/audit.py` (`_log_discord_event` ~1258, channel + message handlers)
- Test: `tests/test_audit_fields.py` (create)

**Interfaces:**
- Consumes: `add_discord_event(..., channel_id, channel_name, actor_is_bot, target_type)` (Task 1).
- Produces: pure helpers `_derive_target_type(event_type) -> Optional[str]` and `build_discord_event_fields(*, event_type, actor, channel) -> dict`, plus `_log_discord_event(..., channel=None)`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_audit_fields.py`:

```python
from types import SimpleNamespace

from axitools.cogs.audit import _derive_target_type, build_discord_event_fields


def test_derive_target_type():
    assert _derive_target_type("channel_create") == "channel"
    assert _derive_target_type("role_update") == "role"
    assert _derive_target_type("message_delete") == "message"
    assert _derive_target_type("emoji_update") == "emoji"
    assert _derive_target_type("guild_update") == "guild"
    assert _derive_target_type("member_leave") == "user"
    assert _derive_target_type("something_else") is None


def test_build_fields_for_channel_event():
    actor = SimpleNamespace(id=42, name="rooster", bot=True)
    channel = SimpleNamespace(id=1449262177046495356, name="raid-signups")
    fields = build_discord_event_fields(event_type="channel_create", actor=actor, channel=channel)
    assert fields == {
        "actor_is_bot": True,
        "target_type": "channel",
        "channel_id": "1449262177046495356",
        "channel_name": "raid-signups",
    }


def test_build_fields_member_event_no_channel_no_actor():
    fields = build_discord_event_fields(event_type="member_leave", actor=None, channel=None)
    assert fields == {
        "actor_is_bot": None,
        "target_type": "user",
        "channel_id": None,
        "channel_name": None,
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_audit_fields.py -q`
Expected: FAIL — `cannot import name '_derive_target_type'`.

- [ ] **Step 3: Add the pure helpers**

In `axitools/cogs/audit.py`, near the other module-level helpers (e.g. after `_format_channel_label`):

```python
def _derive_target_type(event_type: str) -> Optional[str]:
    if event_type.startswith("channel_"):
        return "channel"
    if event_type.startswith("role_"):
        return "role"
    if event_type.startswith("message_"):
        return "message"
    if event_type.startswith("emoji"):
        return "emoji"
    if event_type.startswith("guild_"):
        return "guild"
    if event_type.startswith("member_"):
        return "user"
    return None


def build_discord_event_fields(*, event_type, actor, channel) -> dict:
    return {
        "actor_is_bot": bool(getattr(actor, "bot", False)) if actor is not None else None,
        "target_type": _derive_target_type(event_type),
        "channel_id": str(channel.id) if channel is not None else None,
        "channel_name": getattr(channel, "name", None) if channel is not None else None,
    }
```

- [ ] **Step 4: Run to verify the helpers pass**

Run: `python -m pytest tests/test_audit_fields.py -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Thread the fields through `_log_discord_event`**

In `axitools/cogs/audit.py`, change the `_log_discord_event` signature to accept an optional `channel`, and pass the derived fields to `add_discord_event`. Replace the method's signature and the `store.add_discord_event(...)` call:

```python
    async def _log_discord_event(
        self,
        guild: discord.Guild,
        *,
        event_type: str,
        actor: Optional[discord.abc.User],
        target: Optional[discord.abc.User],
        details: Mapping[str, str],
        channel: "Optional[discord.abc.GuildChannel | discord.Thread]" = None,
    ) -> None:
        channel_id = self._audit_channel_id(guild)
        if not channel_id:
            return

        created_at = utcnow()
        store = self.bot.storage.get_audit_store(guild.id)
        details_text = "\n".join(f"{key}: {value}" for key, value in details.items())
        fields = build_discord_event_fields(event_type=event_type, actor=actor, channel=channel)
        store.add_discord_event(
            created_at=created_at,
            event_type=event_type,
            actor_id=actor.id if actor else None,
            actor_name=_display_user(actor),
            target_id=target.id if target else None,
            target_name=_display_user(target),
            details=details_text,
            channel_id=fields["channel_id"],
            channel_name=fields["channel_name"],
            actor_is_bot=fields["actor_is_bot"],
            target_type=fields["target_type"],
        )
```

(Everything below the `store.add_discord_event(...)` call — the embed building — is unchanged.)

- [ ] **Step 6: Pass `channel=` from the channel + message handlers**

In `axitools/cogs/audit.py`, add `channel=` to the `_log_discord_event(...)` calls in these handlers so the structured channel is captured (the channel object is already in scope):

- `on_guild_channel_create`: add `channel=channel,` (and you may drop the now-redundant `details={"Channel": ...}` to `details={}`).
- `on_guild_channel_delete`: add `channel=channel,` (drop the redundant `details={"Channel": ...}` to `details={}`).
- `on_guild_channel_update`: add `channel=after,` (keep the existing `Name` detail).
- `on_message_delete`: add `channel=message.channel,` (keep existing content/attachment details).
- `on_message_edit`: add `channel=message.channel,` (keep existing details).

Example — `on_guild_channel_create` becomes:

```python
        await self._log_discord_event(
            channel.guild,
            event_type="channel_create",
            actor=actor,
            target=None,
            details={},
            channel=channel,
        )
```

- [ ] **Step 7: Run the audit test suite**

Run: `python -m pytest tests/test_audit_fields.py tests/test_audit_blacklist.py tests/test_audit_embed_avatar.py -q`
Expected: PASS (existing audit tests still green; new fields test green).

- [ ] **Step 8: Commit**

```bash
git add axitools/cogs/audit.py tests/test_audit_fields.py
git commit -m "feat(audit): capture channel/actor_is_bot/target_type at log choke point"
```

---

### Task 3: API — return the structured fields

**Files:**
- Modify: `axitools/api/server.py` (`_handle_audit_discord` ~839)
- Test: `tests/test_audit_api_serialize.py` (create)

**Interfaces:**
- Produces: extract `_discord_event_to_dict(row) -> dict` returning all existing fields plus `channel_id` (string via `_sid`), `channel_name`, `actor_is_bot` (bool|None), `target_type`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_audit_api_serialize.py`:

```python
from axitools.api.server import _discord_event_to_dict


def test_discord_event_to_dict_structured():
    row = {
        "id": 5,
        "created_at": "2026-06-30T07:38:00Z",
        "event_type": "channel_create",
        "actor_id": 42,
        "actor_name": "<@42> (rooster)",
        "target_id": None,
        "target_name": None,
        "details": "",
        "channel_id": "1449262177046495356",
        "channel_name": "raid-signups",
        "actor_is_bot": 1,
        "target_type": "channel",
    }
    out = _discord_event_to_dict(row)
    assert out["channel_id"] == "1449262177046495356"
    assert out["channel_name"] == "raid-signups"
    assert out["actor_is_bot"] is True
    assert out["target_type"] == "channel"
    # back-compat fields preserved
    assert out["event_type"] == "channel_create"
    assert out["actor_id"] == "42"


def test_discord_event_to_dict_old_row_nulls():
    row = {
        "id": 6,
        "created_at": "2026-06-30T07:38:00Z",
        "event_type": "member_leave",
        "actor_id": None,
        "actor_name": None,
        "target_id": 7,
        "target_name": "<@7> (khava)",
        "details": "Details: Member left the server.",
        "channel_id": None,
        "channel_name": None,
        "actor_is_bot": None,
        "target_type": None,
    }
    out = _discord_event_to_dict(row)
    assert out["channel_id"] is None
    assert out["channel_name"] is None
    assert out["actor_is_bot"] is None
    assert out["target_type"] is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_audit_api_serialize.py -q`
Expected: FAIL — `cannot import name '_discord_event_to_dict'`.

- [ ] **Step 3: Extract + extend the serializer**

In `axitools/api/server.py`, add a module-level helper near `_handle_audit_discord` (rows behave like mappings — `sqlite3.Row` and dict both support `row["x"]`; use `.get`-safe access via a try for dicts in tests by indexing, since `sqlite3.Row` supports indexing by name):

```python
def _discord_event_to_dict(row) -> dict:
    raw_bot = row["actor_is_bot"]
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "event_type": row["event_type"],
        "actor_id": _sid(row["actor_id"]),
        "actor_name": row["actor_name"],
        "target_id": _sid(row["target_id"]),
        "target_name": row["target_name"],
        "details": row["details"],
        "channel_id": _sid(row["channel_id"]) if row["channel_id"] is not None else None,
        "channel_name": row["channel_name"],
        "actor_is_bot": None if raw_bot is None else bool(raw_bot),
        "target_type": row["target_type"],
    }
```

Then replace the `_handle_audit_discord` response builder to use it:

```python
    rows = await asyncio.to_thread(_query)
    return web.json_response([_discord_event_to_dict(row) for row in rows])
```

Note: `channel_id` is already a string in storage, but `_sid` is null-safe and idempotent on strings; the guard keeps `None` as `None`.

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/test_audit_api_serialize.py -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full AxiTools audit + storage suites**

Run: `python -m pytest tests/test_storage.py tests/test_audit_fields.py tests/test_audit_api_serialize.py tests/test_audit_blacklist.py tests/test_audit_embed_avatar.py -q`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add axitools/api/server.py tests/test_audit_api_serialize.py
git commit -m "feat(audit): API returns channel/actor_is_bot/target_type"
```

---

## Consumer — AxiRoster (`.`)

### Task 4: Extend the wire type

**Files:**
- Modify: `src/main/auditNormalize.ts` (`DiscordAuditRaw` ~31)

**Interfaces:**
- Produces: `DiscordAuditRaw` carries `channel_id?`, `channel_name?`, `actor_is_bot?`, `target_type?`. `normalizeDiscord` already stores the whole row in `raw`, so the new fields ride along with no further change.

- [ ] **Step 1: Extend the interface**

In `src/main/auditNormalize.ts`, add to `DiscordAuditRaw`:

```ts
export interface DiscordAuditRaw {
  id: number | string
  created_at: string
  event_type: string
  actor_id?: string | null
  actor_name?: string | null
  target_id?: string | null
  target_name?: string | null
  details?: string | null
  channel_id?: string | null
  channel_name?: string | null
  actor_is_bot?: boolean | null
  target_type?: string | null
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /var/home/mstephens/Documents/GitHub/axiroster && npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/main/auditNormalize.ts
git commit -m "feat(audit): carry structured discord fields in the wire type"
```

---

### Task 5: Verb map — every event type yields a verb

**Files:**
- Modify: `src/renderer/src/lib/auditIdentities.ts` (`humanizeType` ~97)
- Test: `src/renderer/src/lib/auditIdentities.test.ts` (create if absent)

**Interfaces:**
- Produces: `discordVerb(eventType: string): string` — a natural verb phrase, never empty.

- [ ] **Step 1: Write the failing test**

Create (or append to) `src/renderer/src/lib/auditIdentities.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { discordVerb } from './auditIdentities'

describe('discordVerb', () => {
  it('maps known channel/member event types to verb phrases', () => {
    expect(discordVerb('channel_create')).toBe('created channel')
    expect(discordVerb('channel_delete')).toBe('deleted channel')
    expect(discordVerb('channel_update')).toBe('updated channel')
    expect(discordVerb('member_leave')).toBe('left the server')
    expect(discordVerb('member_kick')).toBe('was kicked')
  })

  it('falls back to a de-underscored type for unmapped events', () => {
    expect(discordVerb('some_new_event')).toBe('some new event')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/lib/auditIdentities.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — `discordVerb` is not exported.

- [ ] **Step 3: Add the verb map**

In `src/renderer/src/lib/auditIdentities.ts`, add (keeping the existing `humanizeType` for GW2 fallback use):

```ts
const DISCORD_VERBS: Record<string, string> = {
  member_join: 'joined the server',
  member_leave: 'left the server',
  member_kick: 'was kicked',
  member_ban: 'was banned',
  member_unban: 'was unbanned',
  member_role_update: 'had roles changed',
  member_server_mute: 'was server-muted',
  member_server_unmute: 'was server-unmuted',
  member_server_deaf: 'was server-deafened',
  member_server_undeaf: 'was server-undeafened',
  message_delete: 'deleted a message in',
  message_edit: 'edited a message in',
  channel_create: 'created channel',
  channel_delete: 'deleted channel',
  channel_update: 'updated channel',
  role_create: 'created role',
  role_delete: 'deleted role',
  role_update: 'updated role',
  guild_update: 'updated the server',
  emoji_update: 'updated emojis'
}

export function discordVerb(eventType: string): string {
  return DISCORD_VERBS[eventType] ?? eventType.replace(/_/g, ' ')
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/lib/auditIdentities.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/auditIdentities.ts src/renderer/src/lib/auditIdentities.test.ts
git commit -m "feat(audit): discordVerb map so every event has an action"
```

---

### Task 6: Render model — always verb, channel chip, actor subject

**Files:**
- Modify: `src/renderer/src/lib/auditIdentities.ts` (`RowModel` ~29, `describeDiscord` ~145, `IdentityIndex` ~37, `buildIdentityIndex` ~42)
- Test: `src/renderer/src/lib/auditIdentities.test.ts`

**Interfaces:**
- Consumes: `discordVerb` (Task 5); `DiscordAuditRaw` structured fields via `e.raw`.
- Produces: `RowModel.channel?: ChannelChip` where `ChannelChip = { name?: string; id?: string }`; `IdentityIndex.channels: Map<string, string>` (id→name, empty until Task 8). `describeDiscord` always emits a verb and resolves the channel.

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/src/lib/auditIdentities.test.ts`:

```ts
import { describeEvent, buildIdentityIndex } from './auditIdentities'
import type { AuditEvent } from '../../../preload/index.d'

const idx = buildIdentityIndex([])

function discordEvent(raw: Record<string, unknown>): AuditEvent {
  return {
    uid: `discord:${raw.id}`,
    source: 'discord',
    id: String(raw.id),
    time: '2026-06-30T07:38:00Z',
    type: String(raw.event_type),
    summary: '',
    raw
  }
}

describe('describeDiscord', () => {
  it('renders a channel event with verb + channel chip from channel_name', () => {
    const m = describeEvent(
      discordEvent({
        id: 1,
        event_type: 'channel_create',
        actor_id: '42',
        actor_name: 'rooster',
        target_type: 'channel',
        channel_id: '1449262177046495356',
        channel_name: 'raid-signups'
      }),
      idx
    )
    expect(m.action.map((s) => s.t).join('')).toContain('created channel')
    expect(m.channel).toEqual({ name: 'raid-signups', id: '1449262177046495356' })
    expect(m.lead?.discordName).toBe('rooster')
  })

  it('always shows a verb for a member leave (no actor)', () => {
    const m = describeEvent(
      discordEvent({ id: 2, event_type: 'member_leave', target_id: '7', target_name: 'khava', target_type: 'user' }),
      idx
    )
    expect(m.action.map((s) => s.t).join('')).toContain('left the server')
    expect(m.lead?.discordName).toBe('khava')
    expect(m.channel).toBeUndefined()
  })

  it('falls back to the channel id from a <#id> token in details for old rows', () => {
    const m = describeEvent(
      discordEvent({ id: 3, event_type: 'channel_delete', actor_name: 'rooster', details: 'Channel: <#999>' }),
      idx
    )
    expect(m.channel).toEqual({ id: '999' })
    expect(m.action.map((s) => s.t).join('')).toContain('deleted channel')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/lib/auditIdentities.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — `m.channel` is undefined / no verb.

- [ ] **Step 3: Add `ChannelChip` + extend `RowModel` and `IdentityIndex`**

In `src/renderer/src/lib/auditIdentities.ts`:

```ts
export interface ChannelChip {
  name?: string
  id?: string
}

export interface RowModel {
  lead?: ChipModel
  action: Seg[]
  trail?: ChipModel
  channel?: ChannelChip
  /** Set instead of the structured fields when the event type is unmapped. */
  fallback?: string
}

export interface IdentityIndex {
  byDiscordId: Map<string, ReconciledMember>
  byAccount: Map<string, ReconciledMember>
  channels: Map<string, string>
}
```

Update `buildIdentityIndex` to seed an (initially empty) channels map; accept an optional second arg so Task 8 can fill it:

```ts
export function buildIdentityIndex(
  members: ReconciledMember[],
  channels?: Map<string, string>
): IdentityIndex {
  const byDiscordId = new Map<string, ReconciledMember>()
  const byAccount = new Map<string, ReconciledMember>()
  for (const m of members) {
    if (m.memberId) byDiscordId.set(m.memberId, m)
    for (const a of m.accounts) byAccount.set(a.account_name.toLowerCase(), m)
  }
  return { byDiscordId, byAccount, channels: channels ?? new Map() }
}
```

- [ ] **Step 4: Add channel resolution + rewrite `describeDiscord`**

Add a channel resolver and replace `describeDiscord` entirely:

```ts
function channelChip(r: Record<string, unknown>, index: IdentityIndex): ChannelChip | undefined {
  const name = str(r.channel_name)
  let id = str(r.channel_id)
  if (!name && !id) {
    // Back-compat: old rows embed "<#id>" in free-text details.
    const token = str(r.details)?.match(/<#(\d+)>/)
    if (token) id = token[1]
  }
  if (!name && !id) return undefined
  const resolved = name ?? (id ? index.channels.get(id) : undefined)
  return { name: resolved, id }
}

function detailContext(r: Record<string, unknown>): Seg[] {
  // Drop a leading "Channel: ..." line (now a chip) and keep the first remaining line.
  const lines = (str(r.details) ?? '').split('\n').filter((l) => l && !/^Channel:\s/i.test(l))
  const first = lines[0]
  return first ? [{ t: ` · ${first}` }] : []
}

function describeDiscord(e: AuditEvent, index: IdentityIndex): RowModel {
  const r = e.raw as Record<string, unknown>
  const targetId = str(r.target_id)
  const actorId = str(r.actor_id)
  const targetType = str(r.target_type)
  const verb = discordVerb(e.type)
  const channel = channelChip(r, index)
  const context = detailContext(r)

  const hasUserTarget = targetId !== undefined || str(r.target_name) !== undefined
  const userSubject = (targetType === 'user' || (!targetType && targetType !== 'channel')) && hasUserTarget

  if (userSubject) {
    const lead = resolveDiscord(index, targetId, str(r.target_name))
    const action: Seg[] = [{ t: verb }, ...context]
    if ((actorId || str(r.actor_name)) && actorId !== targetId) {
      return {
        lead,
        action: [{ t: verb }, { t: ' by' }],
        trail: resolveDiscord(index, actorId, str(r.actor_name)),
        channel
      }
    }
    return { lead, action, channel }
  }

  // Actor-subject events: channels, roles, messages, emoji, guild.
  const lead =
    actorId || str(r.actor_name) ? resolveDiscord(index, actorId, str(r.actor_name)) : undefined
  return { lead, action: [{ t: verb }, ...context], channel }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/renderer/src/lib/auditIdentities.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS (all describeDiscord + discordVerb tests).

- [ ] **Step 6: Update `EMPTY_INDEX` consumers + typecheck**

`buildIdentityIndex` now returns a `channels` map, but `GuildLog.tsx` defines `EMPTY_INDEX` literally. Update it in `src/renderer/src/components/GuildLog.tsx`:

```ts
const EMPTY_INDEX: IdentityIndex = { byDiscordId: new Map(), byAccount: new Map(), channels: new Map() }
```

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/lib/auditIdentities.ts src/renderer/src/lib/auditIdentities.test.ts src/renderer/src/components/GuildLog.tsx
git commit -m "feat(audit): always-verb rows + resolved channel chip render model"
```

---

### Task 7: Render the channel chip in the row

**Files:**
- Modify: `src/renderer/src/components/GuildLog.tsx` (`EventRow` ~231)

**Interfaces:**
- Consumes: `RowModel.channel` (Task 6).

- [ ] **Step 1: Add a channel tag + render it**

In `src/renderer/src/components/GuildLog.tsx`, add a small component above `EventRow`:

```tsx
function ChannelTag({ channel }: { channel: { name?: string; id?: string } }): JSX.Element {
  if (channel.name) {
    return (
      <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-xs text-sky-300">
        #{channel.name}
      </span>
    )
  }
  // Unresolvable (e.g. a deleted channel): keep the raw id dimmed, never drop it.
  return (
    <span className="rounded border border-panel-line bg-panel-sunk px-1.5 py-0.5 font-mono text-xs text-ink-faint">
      #{channel.id ?? 'unknown'}
    </span>
  )
}
```

Then, inside `EventRow`'s structured branch, render it after the action segments and before the trail chip:

```tsx
            {m.action.length > 0 && (
              <span className="text-ink-dim">
                {m.action.map((s, i) => (
                  <span key={i} className={s.b ? 'font-medium text-ink' : undefined}>
                    {s.t}
                  </span>
                ))}
              </span>
            )}
            {m.channel && <ChannelTag channel={m.channel} />}
            {m.trail && <IdentityChip chip={m.trail} />}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: exit 0.

- [ ] **Step 3: Visual check (in-app render or running app)**

Confirm a channel event renders `actor created channel #name`, a member-leave renders `name left the server`, and an old row with an unmappable channel shows a dimmed `#id`. (Use the SAI in-app renderer with a sample, or run the app against a guild with recent Discord activity.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/GuildLog.tsx
git commit -m "feat(audit): render resolved/dimmed channel chip in log rows"
```

---

### Task 8 (optional, deferrable): channel-name map for old rows

> Skippable: new events already carry `channel_name`. This only upgrades historical rows whose `channel_name` is NULL from a dimmed id to a real `#name`. Implement only if you want pre-migration rows to read nicely.

**Files:**
- Modify: `src/shared/roster/adapters.ts` (add `asDiscordChannels`)
- Modify: `src/shared/roster/assembleRoster.ts` (include channels in the payload)
- Modify: `src/preload/index.d.ts` (RosterPayload type — add `channels`)
- Modify: `src/renderer/src/components/GuildLog.tsx` (`loadIdentities` passes channels)
- Test: `src/shared/roster/adapters.test.ts` (if present) for `asDiscordChannels`

**Interfaces:**
- Produces: `asDiscordChannels(overview): { id: string; name: string }[]` mirroring `asDiscordRoles`; `RosterPayload.channels: { id: string; name: string }[]`; `buildIdentityIndex(members, new Map(channels.map(c => [c.id, c.name])))`.

- [ ] **Step 1:** Mirror `asDiscordRoles` in `src/shared/roster/adapters.ts` as `asDiscordChannels`, parsing the overview `channels` array into `{ id, name }`. Add a unit test feeding a sample overview, asserting the mapped pairs.
- [ ] **Step 2:** In `assembleRoster.ts`, call `asDiscordChannels(overview)` where the Discord overview is parsed and include `channels` on the returned payload (default `[]`). Add `channels: { id: string; name: string }[]` to `RosterPayload` in `src/preload/index.d.ts`.
- [ ] **Step 3:** In `GuildLog.tsx` `loadIdentities`, build the map and pass it: `setIndex(buildIdentityIndex(res.data.members, new Map(res.data.channels.map((c) => [c.id, c.name]))))`.
- [ ] **Step 4:** `npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json` → exit 0; run vitest for adapters + auditIdentities.
- [ ] **Step 5:** Commit `feat(audit): resolve historical channel ids via roster overview`.

---

### Task 9: Full verification (both repos)

**Files:** none.

- [ ] **Step 1: AxiTools suite**

Run: `cd /var/home/mstephens/Documents/GitHub/axitools && python -m pytest tests/ -q`
Expected: all PASS (including the 3 new audit test files).

- [ ] **Step 2: AxiRoster typecheck + tests**

Run:
```bash
cd /var/home/mstephens/Documents/GitHub/axiroster
npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json
npx vitest run --pool=forks --poolOptions.forks.maxForks=2
```
Expected: typechecks exit 0; all vitest pass.

- [ ] **Step 3: End-to-end sanity**

With the updated AxiTools bot running and a guild that has recent Discord channel activity, refresh the AxiRoster log and confirm: channel events show `#name`, every row has a verb, the actor reads cleanly (no `(parenthesized)` noise), and any deleted-channel row shows a dimmed id rather than nothing.

- [ ] **Step 4:** No commit (verification only).

---

## Self-review notes (addressed)

- **Spec coverage:** channels→names (Tasks 1–3 producer + 6–8 consumer); actor formatting (existing `resolveDiscord`/`cleanDiscordName`, now always the subject chip); action-always-exists (Task 5 `discordVerb` + Task 6 always-lead-with-verb); additive/no-backfill (nullable columns, dimmed-id fallback).
- **`actor_is_bot`** is captured and serialized (Tasks 1–3) but intentionally not yet surfaced in the row UI (v1 scope per spec) — it's available in `raw` for a later subtle bot marker.
- **No structured before/after changes object** (spec non-goal) — update specifics stay in `details` and render as the dim `· context` suffix.
