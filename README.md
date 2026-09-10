# Todoist Clone

Local-first task manager. Expo (iOS, Android, web) with a PowerSync-synced SQLite database,
Fastify API, Supabase (Postgres, Auth, Storage). Architecture and decisions: [docs/architecture.md](docs/architecture.md).

## Layout

```text
apps/api            Fastify API (validates + authorizes writes, PowerSync upload target)
apps/client         Expo app; src/data holds the PowerSync adapters and repository layer
packages/contracts  Zod schemas/types shared by API and client
packages/database   Drizzle schema, migrations, connection factory (server-only)
infra/supabase      Vendored official Supabase self-hosting stack (unmodified)
infra/powersync     PowerSync Service config + Sync Streams + source-db bootstrap
compose.yaml        API container
compose.local.yaml  Full self-hosted stack (Supabase + PowerSync + API)
```

## Prerequisites

- Node 24+ (`.nvmrc`), pnpm (any recent version; it self-switches to the pinned one)
- Docker Desktop (only for the containers)
- Xcode / Android Studio for native development builds (PowerSync's native SQLite does not run in Expo Go)

## Setup

The client currently supports local task creation (title, description, priority, date and
optional time) and a live task list. Tasks persist on the same device/browser; login and cloud
sync are not implemented yet. Client-only use needs no `.env`: run `pnpm install`, `pnpm build`,
then `pnpm --filter @todoist-clone/client web` (or a native development build).

```sh
pnpm install
cp .env.example .env                          # API, drizzle-kit, docker compose
cp apps/client/.env.example apps/client/.env  # public client config
pnpm build                                    # emits packages/* dist used by api and client
```

Fill both env files. Two ways to provide the backing services:

### A. Cloud (default for development)

1. Create a Supabase project. Copy URL, publishable key, secret key, pooler + direct DB URLs into the env files.
2. Prepare the database for PowerSync (replication role + empty `powersync` publication):
   `psql "<direct connection string>" -v powersync_password='...' -f infra/powersync/bootstrap-source-db.sql`
3. Create a PowerSync Cloud instance: connect it to the Supabase DB as `powersync_role`,
   enable **Use Supabase Auth**, and deploy the contents of `infra/powersync/sync-config.yaml`.
4. Put the instance URL in `EXPO_PUBLIC_POWERSYNC_URL`.

### B. Fully self-hosted (Docker)

```sh
cd infra/supabase && cp .env.example .env && sh utils/generate-keys.sh && sh utils/add-new-auth-keys.sh && cd ../..
pnpm infra:up                     # Supabase + PowerSync + API, waits for health checks
pnpm infra:powersync:bootstrap    # replication role + publication in the Supabase DB
```

Studio: http://localhost:8000 · API gateway: http://localhost:8000 · PowerSync: http://localhost:8080 · API: http://localhost:3000.
Point the env files at these local URLs (see comments in `.env.example`).

## Commands

| Command | What |
| --- | --- |
| `pnpm dev:api` | Fastify with reload, reads `.env` |
| `pnpm dev:client` | Expo dev server (`pnpm --filter @todoist-clone/client ios/android/web` for a platform) |
| `pnpm build` / `pnpm typecheck` / `pnpm lint` / `pnpm test` | All workspaces |
| `pnpm test:unit` / `pnpm test:integration` | Split test suites |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle migrations (`DATABASE_MIGRATION_URL`) |
| `pnpm infra:up` / `infra:down` / `infra:logs` / `infra:config` | Local stack |
| `docker build -f apps/api/Dockerfile .` | API image (context = repo root) |

## Testing policy

- Unit tests for business logic (repositories, validation, pure helpers), colocated as `*.test.ts`.
- Targeted integration tests for authorization and PowerSync upload handling in `apps/api/test/integration` (need a database; not run in basic CI).
- No end-to-end suite.
