# Task keyword search

Search is a local overlay on the task shell. It does not change the current
Inbox / Today / Upcoming / label / project destination until you open a result.
Guests and signed-in users can search without a network connection.

## Opening and closing

- **Search** in the sidebar (persistent layout) and in the narrow-screen drawer.
- On web, `/` opens Search from the task shell and focuses the input. The
  shortcut is ignored in text fields, `contenteditable`, during IME composition,
  with Ctrl/Cmd/Alt, on key repeat, and while the navigation drawer or Search
  itself is open. Typing `/` in the Search field is ordinary text. Native apps
  use the visible Search action only.
- Escape, Close, backdrop press, and Android Back dismiss Search. Focus returns
  to the control that opened it, or the navigation menu button if that control
  unmounted (drawer). Opening Search from the drawer finishes closing the drawer
  before Search owns the keyboard.
- Opening Search while a composer or editor draft is dirty uses the existing
  discard confirmation. Cancelling keeps the draft.

## Matching

- A blank or whitespace-only query shows recent searches and a short hint, not
  every task.
- A nonempty query searches **all active tasks** for the current identity,
  independent of the selected view, label, date, or Upcoming range.
- The query is trimmed and split on whitespace. **Every word** must appear as a
  literal substring of the **title or the description** (a word may match one
  field while another matches the other). Order does not matter.
- Titles and descriptions are both searched. Empty or null descriptions count as
  empty text.
- Matching uses SQLite `LIKE` with an explicit escape character. `%`, `_`, `*`,
  backslashes, quotes, `#`, and `&` are literal. `today`, `p1`, and `search:`
  have no operator meaning.
- Case: ASCII letters are case-insensitive. Non-ASCII letters stay literal
  (no Unicode folding, accent folding, stemming, or typo tolerance).
- Input is limited to 200 characters.

## Results

Rank, then `created_at DESC, id DESC`. Account hits normalize PowerSync's
space-separated timestamptz (`YYYY-MM-DD hh:mm:ss.sssZ`) and local RFC 3339
(`T`) before that clock comparison, so mixed local/synced rows order by time:

1. Exact title match (ASCII case-insensitive, no extra characters)
2. Title starts with the complete normalized query
3. Every word appears in the title
4. Other title/description matches

**Top** is up to the first five hits. **Tasks** is the rest. A task never appears
in both. Empty sections are hidden. The first page is 50 unique tasks; **Load
more** adds 50 at a time. Account label summaries are loaded after the task
limit, so extra labels cannot hide a hit.

Selecting a result opens the existing task editor, including when that task is
not in the current view. From Labels or Projects management, Search first
selects Inbox so the editor can mount. Edits, completion, delete, and Undo keep
their current behavior. A task deleted between listing and opening is
unavailable — it is not recreated as a blank draft.

## Recent searches

- At most five queries, newest first, on this device only.
- Recorded on explicit submit (including zero results), choosing a recent query,
  or successfully opening a result. Keystrokes are not stored.
- Deduplicated with the same whitespace normalization and ASCII case folding;
  the latest typed casing is kept and moved to the front.
- Individual **Remove** and **Clear all**. Malformed stored JSON is treated as
  empty. A failed recents write is reported in Search.
- Guest history and each account's history are separate
  (`search-recents:guest` vs `search-recents:user:<userId>`). They do not sync,
  upload, or copy with guest-task adoption. Switching identity clears the open
  modal before the next identity renders.

## Local snapshot

Search and recents read the local SQLite snapshot as soon as the current
identity is ready (the same auth-restoration and local-data-readiness gates as
the rest of the shell). They do not wait for network, upload drain, or an
initial sync. Existing sync status can explain stale account data; it does not
block Search. Local creates, edits, complete/reopen, delete, Undo, adoption, and
later sync updates recompute the open query.

## Performance

The first 50 ranked hits are the target for a broad query over about 5,000 local
tasks, measured from query execution (not the 150 ms input debounce). Leading
wildcard `LIKE` is not index-backed; this is a latency target, not a guarantee.

On Node 24 `node:sqlite` (linux x64), a `milk` query over 5,000 guest tasks
returned 51 rows (limit+1) in about 1 ms median. Web IndexedDB VFS and native
op-sqlite + PowerSync watch delivery add overhead on top of that SQL. If a
device is materially over ~100 ms, inspect hydration/join cost before adding FTS.

## Out of scope

Filter language (priority/date/search operators), saved filters, Cmd/Ctrl+K
Quick Find, completed/history search, projects/labels/comments as search
entities, server/Todoist API search, FTS, and synced search history.
