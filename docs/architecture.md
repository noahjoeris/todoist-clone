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
  JWT, check ownership). Integration tests target exactly this.
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

Development targets Supabase Cloud and PowerSync Cloud. `compose.local.yaml` runs the identical
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
upload handling; no end-to-end suite. Basic CI runs without cloud credentials.

## Deferred

Tauri desktop wrapper, pg-boss background jobs and the worker container (same API image,
different command), attachments/Storage, auth session persistence, the PowerSync backend
connector and first synced table.
