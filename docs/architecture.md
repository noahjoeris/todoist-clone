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

When auth and sync arrive, explicitly adopt guest tasks into an account-owned synced table,
preserving IDs and copying successfully before removing local originals. Do not turn this
guest table into a synced table in place or upload ownerless rows. Cloud adapters remain
available but are not instantiated by the local-only composition root.

Account-owned rows live in `public.tasks` (ADR-014). Adoption copies `local_tasks` into
that table in a later change; it does not convert `local_tasks` in place.

### ADR-012 Supabase Auth behind an `AuthRepository`; guest tasks hidden while signed in

Email/password authentication with confirmation through the link in Supabase's default email is
the first cloud feature. (A typed 6-digit code would give the same UX on every platform, but
Supabase Cloud only allows editing the email template with custom SMTP.) Consequences:

- **Boundary.** `src/data/repositories/auth-repository.ts` is the only place the UI reaches auth
  from. It exposes an observable `AuthState` (`restoring` / `restore-failed` / `signed-out` /
  `signed-in`) and intention-revealing operations; every failure is an `AuthFailure` with an
  app-level code and a user-facing message. Supabase sessions, tokens and error shapes never
  leave `src/data`. The UI only learns the user's id and email.
- **Optional configuration.** `loadSupabaseEnv()` reads only the two Supabase variables. Neither
  set means guest-only mode; a partial or malformed pair is reported inside the app while guest
  tasks keep working. PowerSync and API URLs are not read until the first synced table.
- **Platform options (extends ADR-007).** `auth-platform.native.ts` supplies AsyncStorage and
  leaves URL session detection off (no deep link yet; after confirming in the browser the user
  signs in with their password). `auth-platform.web.ts` keeps supabase-js on `localStorage`
  and enables `detectSessionInUrl`, so the confirmation redirect to the Site URL signs the
  user in. `auth-lifecycle.native.ts` starts/stops token auto-refresh from `AppState`; the web
  variant is a no-op because supabase-js already reacts to `visibilitychange`. The deprecated
  `lock` option is not used.
- **Startup.** The root screen renders nothing until the stored session is resolved, so guest
  tasks never flash before an account view. A failed restoration (typically offline with an
  expired token) offers retry or an explicit "continue as guest"; after that choice, late
  restoration results and stored-session refreshes are ignored until a session is successfully
  applied. A failed sign-in or a confirmation-required sign-up does not lift that guard.
  Nothing is deleted on auth failure.
- **Guest tasks while signed in.** The signed-in view unmounts the guest list and composer and
  shows an account placeholder. `local_tasks` rows are neither copied, uploaded, cleared nor
  re-owned; they reappear after sign-out. Adoption into an account-owned synced table stays
  deferred exactly as ADR-011 describes. Sign-out uses `scope: 'local'` so other devices keep
  their sessions, and local state becomes signed-out even if the revoke request fails.
- **Server side.** This ADR covers the client boundary only. The API verifies the same
  Supabase access tokens (ADR-013). Password recovery, social login and the PowerSync
  connector come later.

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
- Any 403 rolls back the whole batch, including earlier PUTs in that request.
- **Connector (next PR):** 2xx / 4xx → `complete()` the PowerSync transaction (4xx is a
  client bug or abuse; the SQLite batch is discarded). 5xx / network → retry.
- **RLS** is enabled with no policies (deny-all for PostgREST roles). The table owner
  (API / `postgres`) bypasses RLS; there is no FORCE. The FK
  `tasks.user_id → auth.users(id) ON DELETE CASCADE` is raw SQL so drizzle-kit never
  models `auth` (ADR-004). Referencing `auth` is not modifying it.
- `scheduled_time` is stored as `time(0)` (`HH:mm:ss`). The wire also accepts `HH:mm`.
- Client PowerSync table + connector are deferred. That is an explicit waiver of the
  AGENTS.md rule that a synced table ships with migration, Sync Stream, and client
  schema together. Guest-task adoption stays as ADR-011.

## Deferred

Tauri desktop wrapper, pg-boss background jobs and the worker container (same API image,
different command), attachments/Storage, password recovery and social login, guest-task
adoption, the PowerSync backend connector.
