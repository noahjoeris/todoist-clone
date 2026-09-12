# Architecture

Living document. Every architectural decision is logged here with its rationale; update it in
the same change that alters the architecture. Product/feature design does not belong here.

## System overview

```text
                 ┌──────────────────────────── client (Expo) ────────────────────────────┐
                 │  UI  →  repositories  →  local SQLite (PowerSync SDK)                │
                 └──────────────┬───────────────────────────────▲───────────────────────┘
        uploads (queued writes) │                               │ downloads (Sync Streams)
                                ▼                               │
                        Fastify API ── Drizzle ──► Supabase Postgres ──► PowerSync Service
                                                        ▲
                     Supabase Auth (JWT) ───────────────┘   Supabase Storage (files)
```

- **Reads and writes** happen against the local SQLite database through the repository layer.
- **Uploads**: the PowerSync SDK queues local writes; the backend connector posts them to the
  Fastify API, which validates (Zod), authorizes and applies them with Drizzle.
- **Downloads**: the PowerSync Service replicates Postgres (logical replication, `powersync`
  publication) and streams the per-user subset defined by Sync Streams to clients.
- **Identity**: Supabase Auth issues JWTs; both the API and the PowerSync Service verify them.
- **Files**: Supabase Storage (later; via PowerSync attachment queue).

## Repository layout

| Path | Responsibility | May import |
| --- | --- | --- |
| `apps/client` | Expo app. `src/data` = PowerSync adapters, Supabase client, repositories. `src/ui` = screens/components. | `contracts` |
| `apps/api` | Fastify. Env validation, plugins, routes, upload handling, authorization. | `contracts`, `database` |
| `packages/contracts` | Zod schemas and inferred types shared across the wire. | nothing internal |
| `packages/database` | Drizzle schema, migrations, connection factory. Server-only. | nothing internal |
| `infra/supabase` | Vendored official Supabase compose stack. Do not edit upstream files. | — |
| `infra/powersync` | `service.yaml` (local service), `sync-config.yaml` (Sync Streams, source of truth), bootstrap SQL. | — |

Boundaries:

- UI never imports PowerSync, Supabase or SQL directly; it goes through `src/data/repositories`.
- Client never imports `packages/database`. Database models are not wire contracts.
- `packages/contracts` has no dependency on either app.

## Decision log

### ADR-001 Local-first with PowerSync on top of Supabase Postgres

Todoist-like apps must feel instant and work offline. PowerSync gives a synced client SQLite
database with a queue for offline writes, while Postgres stays the system of record. Supabase
provides Postgres, Auth and Storage with a free tier now and an official self-hosting stack later.

### ADR-002 Writes go through the Fastify API, not PostgREST

PowerSync's Supabase demos upload directly via `supabase-js`/PostgREST with RLS. We route uploads
through Fastify instead so that validation, authorization and business rules live in one
TypeScript codebase that is unit-testable, and so that future server-side work (reminders,
emails via pg-boss) shares the same code. Consequences:

- The API connects with a fixed database role, so **Supabase RLS does not apply the user's
  identity automatically**. The API must authorize every write explicitly (verify the Supabase
  JWT, check ownership). Integration tests target exactly this. How those JWTs are verified
  is ADR-013.
- RLS stays enabled on application tables as defence in depth for any PostgREST access.

### ADR-003 Download access is defined by Sync Streams, not RLS

The PowerSync replication role has `BYPASSRLS`. Which rows a user receives is decided solely by
`infra/powersync/sync-config.yaml`. Streams mirror the ownership rules the API enforces on
writes (`auth.user_id()`). Every synced table carries an owner column to make this cheap.

### ADR-004 Drizzle owns application migrations; Supabase owns its own schemas

`packages/database` manages `public.*` with drizzle-kit (`schemaFilter: ['public']`). Supabase's
`auth`, `storage`, etc. are never touched by our migrations. Migrations run with a direct
(session) connection (`DATABASE_MIGRATION_URL`); the API runtime uses the transaction pooler
(`DATABASE_URL`, `prepare: false`).

### ADR-005 Explicit `powersync` publication

The publication is created empty by `infra/powersync/bootstrap-source-db.sql`. Each migration
that creates a synced table adds it (`ALTER PUBLICATION powersync ADD TABLE ...`). This avoids
replicating tables PowerSync does not need (PowerSync must read every published table's WAL).

### ADR-006 Client IDs are UUIDs generated on the client

PowerSync requires a single text `id` column. Postgres tables use `uuid` primary keys; clients
generate ids so offline inserts need no round trip.

### ADR-007 Platform-specific PowerSync adapters via file suffixes

`create-database.native.ts` (op-sqlite via `@powersync/react-native`) and `create-database.web.ts`
(`@powersync/web`, workers in `public/@powersync`). Metro picks the file per platform; a small
`metro.config.js` guard keeps each SDK out of the other bundle. Native requires an Expo
development build (no Expo Go). Web uses the default IndexedDB VFS, which needs no special
response headers; switching to OPFS would require COOP/COEP headers.

### ADR-008 Cloud services first, self-hosting kept viable

Development targets Supabase Cloud and PowerSync Cloud. `compose.supabase.yaml` plus
`compose.local.yaml` run the identical
components self-hosted: the unmodified official Supabase stack (vendored, pinned), the official
`journeyapps/powersync-service` image with a **dedicated Postgres for bucket storage**, and the
API image. The same `service.yaml`/`sync-config.yaml` are the source of truth for both.

### ADR-009 Tooling

pnpm workspaces (isolated `node_modules`, Expo SDK ≥ 54 supports it), TypeScript 6 (version
pinned by the Expo SDK), Biome for lint + format, Vitest with `unit`/`integration` projects,
Zod 4 for all runtime validation. Shared packages compile to `dist` so Metro and Node consume
the same artifacts; `pnpm build` is required after cloning.

### ADR-010 Testing policy

Unit tests for business logic; targeted integration tests for authorization and PowerSync
upload handling; no end-to-end suite. Basic CI (`checks`) runs without cloud credentials
or a database. The `integration` job starts `supabase/postgres:17.6.1.136`, bootstraps
the empty `powersync` publication, migrates, and runs `apps/api` integration tests. Still
no cloud credentials.

### ADR-011 Guest tasks use a local-only PowerSync table

The first task feature stores guest tasks in `local_tasks` with `localOnly: true`. They persist
on the device without authentication, cloud configuration, or queued uploads. The repository
owns validation, SQL and live subscriptions; the UI receives only the repository interface.
No Postgres migration or Sync Stream is needed for this unsynced table.

Scheduled dates (`YYYY-MM-DD`) and optional wall-clock times (`HH:mm`) are separate nullable
fields, not UTC instants; time requires a date. Deadlines and reminders are separate future
features. Priority uses 1 (highest) through 4 (default).

Guest tasks are adopted into the account-owned synced table by an explicit copy+delete
(ADR-016), preserving IDs. Do not turn this guest table into a synced table in place or
upload ownerless rows. Cloud adapters remain available but are not instantiated by the
local-only composition root.

Account-owned rows live in `public.tasks` (ADR-014). Adoption copies `local_tasks` into
that table; it does not convert `local_tasks` in place (ADR-016).

### ADR-012 Supabase Auth behind an `AuthRepository`; guest tasks hidden while signed in

Email/password authentication with confirmation through the link in Supabase's default email is
the first cloud feature, including password recovery and email change. (A typed 6-digit code
would give the same UX on every platform, but Supabase Cloud only allows editing the email
template with custom SMTP.) Consequences:

- **Boundary.** `src/data/repositories/auth-repository.ts` is the only place the UI reaches auth
  from. It exposes an observable `AuthState` (`restoring` / `restore-failed` / `signed-out` /
  `signed-in`, with optional `passwordRecovery` on signed-in) and intention-revealing
  operations (`signUp` / `signIn` / `requestPasswordReset` / `updatePassword` / `updateEmail`);
  every failure is an `AuthFailure` with an app-level code and a user-facing message.
  Supabase sessions, tokens and error shapes never leave `src/data`. The UI only learns the
  user's id and email.
- **Optional configuration.** `loadCloudEnv()` reads the four public variables (Supabase URL and
  publishable key, PowerSync URL, API URL). All unset means guest-only mode; a partial or
  malformed set is reported inside the app while guest tasks keep working.
- **Platform options (extends ADR-007).** `auth-platform.native.ts` supplies AsyncStorage,
  sets `flowType: 'pkce'`, and leaves URL session detection off (`detectSessionInUrl: false`):
  there is no `window.location` on native, so confirmation / recovery / email-change is
  completed by `auth-deep-link.native.ts` (`Linking` + `exchangeCodeForSession` /
  `setSession`) after `signUp` / `resend` / recovery / email-change pass
  `emailRedirectTo` / `redirectTo: 'todoist-clone://auth/callback'`. PKCE puts the grant in
  `?code=` (query survives Android intents and email clients); `setSession` remains a
  fallback for implicit hash tokens from old links. The resulting session is applied in
  `AuthRepository` and rides the existing auth-state / PowerSync lifecycle (ADR-015).
  `auth-platform.web.ts` keeps supabase-js on `localStorage` and the implicit grant
  (`detectSessionInUrl: true`; no `flowType`), so confirmation and recovery redirects to the
  Site URL sign the user in; web does not pass `emailRedirectTo`. Failed web redirects
  (`error` / `error_code` / `error_description` in the query or fragment, typically
  `otp_expired`) are parsed from the page URL before supabase-js runs and surfaced as an
  `AuthFailure` on `signed-out` (`redirectError`) so Sign in can show them and offer the
  existing resend-confirmation or forgot-password path. A successful recovery redirect
  (`type=recovery` and/or `PASSWORD_RECOVERY`) is `signed-in` with `passwordRecovery: true`
  until `updatePassword`. Native does not read the page URL; deep-link errors go through the
  callback exchange. `auth-lifecycle.native.ts` starts/stops token auto-refresh from
  `AppState`; the web variant is a no-op because supabase-js already reacts to
  `visibilitychange`. The deprecated `lock` option is not used.
- **Startup.** The root screen renders nothing until the stored session is resolved, so guest
  tasks never flash before an account view. A failed restoration (typically offline with an
  expired token) offers retry or an explicit "continue as guest"; after that choice, late
  restoration results and stored-session refreshes are ignored until a session is successfully
  applied. A failed sign-in or a confirmation-required sign-up does not lift that guard.
  Nothing is deleted on auth failure.
- **Guest tasks while signed in.** The signed-in view unmounts the guest list and composer and
  shows the account-owned `tasks` list (ADR-015). Remaining `local_tasks` are offered for
  adoption (ADR-016); they are not uploaded ownerless or converted in place. Rows left
  unadopted reappear after sign-out. Sign-out uses `scope: 'local'` so
  other devices keep their sessions, and local state becomes signed-out even if the revoke
  request fails.
- **Server side.** This ADR covers the client auth boundary. The API verifies the same
  Supabase access tokens (ADR-013). Social login comes later.

### ADR-013 The API verifies Supabase JWTs via JWKS (asymmetric only)

User access tokens are ES256. The API verifies them with `jose` against
`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. `createRemoteJWKSet` caches the set and
refetches on an unknown kid (30s cooldown). Consequences:

- Audience is `authenticated`. The `sub` claim becomes `request.user.id`.
- Only ES256 is accepted; there is no HS256 fallback. `SUPABASE_SECRET_KEY` is not used
  for verification.
- Issuer is not checked: inside compose the API reaches Supabase at `http://kong:8000`
  while tokens carry the external URL (`http://localhost:8000` or the cloud project URL).
- Routes opt in with `{ onRequest: app.authenticate }`. Failures are `401` with
  `{ error: "unauthorized" }` and `WWW-Authenticate: Bearer`; reasons stay at debug and
  the token is never echoed.
- Self-hosted stacks generate `JWT_KEYS` (an EC key) in `infra/supabase/.env` with
  `utils/add-new-auth-keys.sh`. Vendored compose leaves `GOTRUE_JWT_KEYS` commented
  out; `compose.local.yaml` sets it on `auth` as a later `-f` than
  `compose.supabase.yaml` (Compose forbids overlaying a service in the file that
  `include`s it). `pnpm infra:up` interpolates `infra/supabase/.env` then the
  repo-root `.env`.

### ADR-014 PowerSync upload contract for `tasks`

The first synced table is `public.tasks`. Clients will upload PowerSync `CrudEntry` batches
to `POST /sync/upload`. The API applies a batch atomically in one Drizzle transaction.

- **Wire schema** lives in `packages/contracts` (`uploadRequestSchema`). Extra keys
  including `id`, `user_id` and `updated_at` are stripped (`.strip()`, not `.strict()`).
  The server always sets `user_id` from the JWT and `updated_at = now()`.
- **PUT** is an owner-guarded upsert: `INSERT … ON CONFLICT (id) DO UPDATE … WHERE
  user_id = jwt`. Zero rows affected means the id belongs to someone else → 403.
- **PATCH / DELETE** of a missing row is a no-op (still 200, `applied = operations.length`).
  PATCH/DELETE of another user's row is 403. A PATCH whose only keys were server-owned
  is a no-op after strip.
- PATCH `scheduled_date` / `scheduled_time` is validated against the merged persisted
  row, not the partial payload. Clearing the date also clears a leftover time. A
  time-only patch on a dated row is allowed. An explicit time without a date is
  400 `invalid-request`.
- `completed_at` is a client-owned timestamptz. PUT omission or null means the
  task is active (PowerSync omits nulls). PATCH omission leaves completion
  unchanged; explicit null reopens. A title/description PATCH must not rewrite
  completion. Completing again while already complete is a client no-op that
  preserves the original timestamp.
- DELETE of an owned row followed by a PUT of the same id restores that snapshot
  (same id, fields, `created_at`, and `completed_at`). The API applies the batch
  in order, atomically; a retry of DELETE → PUT is idempotent (missing DELETE is
  a no-op, PUT upserts).
- PowerSync maps Postgres `timestamptz` to on-disk SQLite text as
  `YYYY-MM-DD hh:mm:ss.sssZ` (space separator, not `T`). The upload contract
  accepts that form on `created_at` and `completed_at` (PUT and PATCH) by
  normalizing it to RFC 3339. The client applies the same normalization in
  `mapTaskRow` so delete snapshots and restore PUTs are wire-valid.
- Any 403 rolls back the whole batch, including earlier PUTs in that request.
- **Connector:** 2xx → `complete()` the PowerSync transaction. 400/403 → log the body and
  `complete()` (client bug or abuse; the SQLite batch is discarded). **401 throws** so
  PowerSync retries after a token refresh. 5xx / network → throw (retry). See ADR-015.
- **RLS** is enabled with no policies (deny-all for PostgREST roles). The table owner
  (API / `postgres`) bypasses RLS; there is no FORCE. The FK
  `tasks.user_id → auth.users(id) ON DELETE CASCADE` is raw SQL so drizzle-kit never
  models `auth` (ADR-004). Referencing `auth` is not modifying it.
- `scheduled_time` is stored as `time(0)` (`HH:mm:ss`). The wire also accepts `HH:mm`.
- Client PowerSync schema includes `tasks` (mirrors `public.tasks` / `user_tasks`).
  Guest-task adoption is ADR-016.

### ADR-015 Connector: Supabase session is the PowerSync credential

Signed-in clients connect to PowerSync with the Supabase access token (PowerSync Cloud
"Use Supabase Auth" accepts it as-is). The connector and lifecycle live in `src/data`;
the token never reaches the UI or `AuthRepository`. Consequences:

- **Connect / clear.** `signed-in` → `powersync.connect` with a connector bound to that
  account. Transition to `signed-out` → `disconnectAndClear({ clearLocal: false })` so
  `local_tasks` survive (the SDK default `clearLocal: true` would wipe them). Connect and
  clear are serialized on a promise chain. `restoring` / `restore-failed` are ignored. If
  the signed-in user id changes without a sign-out, clear before connect. The queued-data
  owner is persisted independently of the in-memory session: before connect, if that owner
  differs from the signing-in user — or the owner is unknown and the upload queue is
  non-empty or unreadable — clear first. Otherwise a crash after force-sign-out updates
  auth but before clear finishes would let a later account upload the previous queue under
  its JWT. The in-memory initialized user is recorded only after persist-owner and connect
  both succeed; a failure stays retryable on a later `signed-in` event. Serializing
  connect/clear does not protect an already-running `uploadData` loop — that is the
  connector account bind below.
- **Local-data readiness.** Ownership check/clear/persist is local and does not wait for
  PowerSync network connect. Until it finishes for the current account, the signed-in UI
  does not mount the account task composer, so writes cannot land in a queue that is about
  to be cleared or be classified as an unknown-owner queue on first sign-in.
- **Uploads.** Each connector is bound to the account it was connected with. Before
  `fetchCredentials` and each upload, `getSession()` must belong to that account; a
  mismatch throws (no `complete()`), so a session change A→B mid-upload cannot POST the
  previous queue under B's JWT (the API strips `user_id` and assigns ownership from the
  token). Each PowerSync transaction is `POST ${origin}/sync/upload` with
  `{ transactionId, operations: [{ clientId, table, id, op, opData }] }`. The API origin
  is stripped of trailing slashes and joined with `URL` so `EXPO_PUBLIC_API_URL` values
  like `http://localhost:3000/` do not become `//sync/upload`. Do not
  `JSON.stringify` a `CrudEntry` (`toJSON()` emits `op_id/type/tx_id/data`). Local-only
  tables never write `ps_crud`. Synced uploads are `tasks`, `labels`, and `task_labels`
  through the same connector (no table filter).
- **HTTP.** 2xx → `complete()`. 400/403 → `console.error` the body and `complete()`.
  401 → throw (retry). 5xx / network → throw (retry).
- **Sign-out with a non-empty upload queue.** The primary action stays disabled until
  the queue count is known (fail closed; initial/unknown is not treated as empty). Once
  known and non-empty, block with `Waiting for N changes to sync…` and offer a secondary
  **Sign out and discard**. Without this, offline edits would be destroyed by
  `disconnectAndClear`.
- **UI.** Account-owned rows go through `TaskRepositories.forUser(userId)` (`tasks` +
  `user_id`). Sync status is `SyncStatusSource` from the repository layer; the UI never
  imports `src/data/sync`. Local-data readiness is `isLocalDataReadyFor(userId)` on that
  source. The UI keeps repository `subscribe()` + `useSyncExternalStore`;
  it does not use `@powersync/react`.

### ADR-016 Guest-task adoption: one-time prompt, copy+delete in one local transaction

When a signed-in user still has `local_tasks` on the device, prompt once: "You have N tasks
from before you signed in." **Add to my account** copies each row into `tasks` with
`user_id` and the same `id`, then deletes `local_tasks`, all in one `writeTransaction`
(one `ps_crud` transaction → one atomic `/sync/upload` batch once a connector is
connected). **Not now** hides the prompt until the next sign-in (in-memory skip; `reset()`
on sign-out, and when the signed-in user id changes without a sign-out). **Don't ask
again** writes `local_preferences` (`id = 'guest-task-adoption'`,
`value = 'dismissed'`), a local-only table that survives `disconnectAndClear({
clearLocal: false })`.

The banner mounts only after local-data readiness (ADR-015) so adoption cannot write into
a queue that is about to be cleared. Do not convert `local_tasks` in place or upload
ownerless rows (ADR-011). Adoption copies `completed_at` with the other fields.

### ADR-017 Task completion, field-level edits, and session undo

The basic task lifecycle (complete, edit, delete) is local-first and identical for
guest `local_tasks` and account-owned `tasks`.

- **Completion.** A nullable `completed_at` timestamptz (SQLite text ISO-8601) is
  the only completion field. The repository `setCompletion(id, completed)` writes
  explicitly; it does not toggle from UI state. Completing an already-completed
  row keeps the original timestamp; reopening sets null and leaves schedule and
  other fields intact; completing again records a new timestamp. Active tasks are
  the default list; completed tasks sit in a separate, initially collapsed
  section ordered by `completed_at` descending, then id.
- **Edits.** Create and edit share one form/validation path (`taskInputSchema`).
  Saves issue field-level UPDATEs for changed editable columns only, so a title
  edit cannot overwrite a newer remote completion. Ids, ownership, and
  `created_at` are not editable. A save against a row that disappeared (deleted
  remotely or locally) reports missing and does not INSERT a replacement.
- **Delete and undo.** Delete reads the snapshot and deletes in one
  `writeTransaction`. Undo is session-scoped UI state (8 seconds, latest deletion
  wins, cleared on account/session change or process restart) and restores by
  INSERT of the captured snapshot with the original id — never `INSERT OR
  REPLACE`. If that id exists locally, restore fails and Undo stays until expiry.
  Guest undo stays on `local_tasks`; account undo uploads as a normal PowerSync
  PUT (ADR-014). There is no persistent trash.
- **Parity.** Guest and account repositories expose the same operations;
  account reads/writes are owner-scoped. Offline writes land in SQLite;
  account changes sync through the existing upload endpoint.

### ADR-018 Reanimated is the shared native/web animation library

The Inbox / Today / Upcoming shell needs a narrow-screen navigation drawer that
slides from the leading edge with a fading backdrop on iOS, Android, and web.
React Native Reanimated (with `react-native-worklets`) is that animation runtime,
and the choice for later UI-thread motion.

Consequences:

- **UI-only ownership.** Animation code lives in `src/ui` (the drawer, beside
  `AppShell` / `Sidebar`). Repository writes, PowerSync, sync, and Undo never wait
  on animation completion. Changing destination happens as soon as any draft-discard
  check succeeds; close motion is presentation only.
- **SDK-compatible install.** Add packages with
  `pnpm --filter @todoist-clone/client exec expo install react-native-reanimated react-native-worklets`
  so versions match Expo SDK 57
  ([setup](https://docs.expo.dev/versions/v57.0.0/sdk/reanimated/)).
  `babel-preset-expo` enables the Worklets/Reanimated plugin automatically; do not
  add a duplicate plugin. Keep the PowerSync async-generator Babel transform and
  Metro native/web SDK exclusions.
- **Native rebuild.** Reanimated includes native code. Rebuild the development
  client after adding it. Expo Go is already insufficient because of PowerSync.
- **Reduced motion.** Use `ReduceMotion.System`; do not force `Never`. Skip
  transitions when the system or browser preference is on, but still run close
  cleanup and focus restore. Subscribe to preference changes at runtime;
  `useReducedMotion` alone only snapshots the startup setting
  ([accessibility](https://docs.swmansion.com/react-native-reanimated/docs/guides/accessibility/)).
- **Drawer only.** Swipe-to-dismiss, Gesture Handler, task-row animations, and a
  general motion framework are follow-ups.

### ADR-019 Normalized ID-based labels (server)

Labels are first-class, account-owned rows (`public.labels`) with a many-to-many
link table (`public.task_labels`). Rename and recolor follow the label id, not
the name. Guest `local_tasks`, adoption, and the local-only schema do not
acquire labels.

- **Identity and uniqueness.** Clients generate UUID primary keys (ADR-006).
  Display names are unique per user case-insensitively
  (`UNIQUE (user_id, lower(name))`), trimmed, 1–60 characters. Color is one of
  Todoist's 20 palette names (default `charcoal`) plus an `is_favorite` flag.
  A duplicate-name unique violation is 400 `invalid-request` with a `name`
  field issue — not automatic merging. Cross-device offline races that collide
  on name reject the whole upload batch under the current connector policy
  (400 → `complete()`, ADR-014).
- **Associations.** `task_labels` uses a client-generated UUID `id` (PowerSync
  single-id model) and `UNIQUE (task_id, label_id)`. Links support PUT/DELETE
  only; PATCH is rejected at the contract. Before insert, the API locks both
  the task and the label (`FOR UPDATE`) and requires both to belong to the
  authenticated user. Missing or foreign refs are 403, never an unhandled FK
  500. An existing association id belonging to another user is 403 — retries
  must not re-own or retarget it. A second device attaching the same
  task+label under a different link id is a 200 no-op (the association already
  exists); unique-constraint 500s are not surfaced.
- **Deletion.** `ON DELETE CASCADE` from `labels` and `tasks` (including
  completed tasks) and from `auth.users`. Deleting a label removes it from
  every task; deleting a task removes its links; deleting the user removes
  both. A missing-link DELETE after a cascade is a no-op. Clients should
  upload labels/tasks before new links, and local association deletes before
  parent deletes; DB cascades cover the rest. Apply the batch in the given
  order, one transaction (ADR-014).
- **Sync and authorization.** RLS is enabled with no client policies (ADR-002).
  Streams `user_labels` and `user_task_labels` filter `user_id = auth.user_id()`
  (ADR-003). Both tables are in the `powersync` publication (ADR-005). The
  client SQLite schema mirrors the tables (`is_favorite` as integer). The API
  still owns authorization; UI → repositories → PowerSync remains the client
  boundary.
- **Client repositories.** `LabelRepository` is account-scoped (`forUser`). The UI
  never imports SQL/PowerSync. Duplicate names are rejected locally with a field
  error; the server remains authoritative for offline cross-device races (400 →
  `complete()`, ADR-014). Active counts use a LEFT JOIN plus a conditional
  aggregate so unused labels stay visible at zero. Delete confirmation uses the
  total association count, including completed tasks. Association rows are
  deleted in the same local transaction as the label; SQLite does not rely on
  server FK cascades.
- **Task associations.** Account task results include label summaries (`id`,
  `name`, `color`) from owner-scoped joins. Guest results always have an empty
  collection. Create/update attach and detach in the same `writeTransaction` as
  the task write. A field-only edit omits association ops so a title change
  cannot overwrite labels updated on another device. When the editor did change
  labels, intended attach/detach is a three-way merge against the open-editor
  baseline and the live links. Missing selected labels are skipped rather than
  queued as invalid refs. Task delete removes local `task_labels` first. Undo
  restores links only to labels that still exist and are owned by the same
  user — it never recreates a deleted label.
- **Inline create.** Creating a label from the task picker writes the `labels`
  row immediately, even if the task draft is cancelled. The draft only attaches
  on save.
- **Wire.** Upload CRUD is discriminated by table and operation. SQLite
  favorite 0/1 is normalized to boolean at the contract boundary, not by
  truthy coercion. `user_id` and `updated_at` stay server-owned (ADR-014).

## Deferred

Tauri desktop wrapper, pg-boss background jobs and the worker container (same API image,
different command), attachments/Storage, and social login.
