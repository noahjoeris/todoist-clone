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
compose.yaml            API container
compose.supabase.yaml   Include of vendored Supabase compose
compose.local.yaml      Local overlays (ES256 JWT on auth, PowerSync) + API
```

## Prerequisites

- Node 24+ (`.nvmrc`), pnpm (any recent version; it self-switches to the pinned one)
- Docker Desktop (only for the containers)
- Xcode / Android Studio for native development builds (PowerSync's native SQLite does not run in Expo Go)

## Setup

The client currently supports local guest tasks (title, description, priority, date and optional
time) with a live list, plus email/password accounts with email-link confirmation and persistent
sessions. Guest tasks stay on the device and are hidden while signed in; signed-in users sync
account-owned tasks through PowerSync. Guest-only use needs no `.env`: run `pnpm install`,
`pnpm build`, then `pnpm --filter @todoist-clone/client web` (or a native development build).

```sh
pnpm install
cp .env.example .env                          # API, drizzle-kit, docker compose
cp apps/client/.env.example apps/client/.env  # public client config
pnpm build                                    # emits packages/* dist used by api and client
```

Fill both env files. Two ways to provide the backing services:

### A. Cloud (default for development)

1. Create a Supabase project. Copy URL, publishable key, secret key, pooler + direct DB URLs into the env files.
   Accounts and sync need all four client variables together (`EXPO_PUBLIC_SUPABASE_URL`,
   `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_POWERSYNC_URL`, `EXPO_PUBLIC_API_URL`);
   see [Authentication setup](#authentication-setup).
2. Prepare the database for PowerSync (replication role + empty `powersync` publication),
   then apply Drizzle migrations (creates `public.tasks` and adds it to the publication):
   `psql "<direct connection string>" -v powersync_password='...' -f infra/powersync/bootstrap-source-db.sql`
   then `DATABASE_MIGRATION_URL="<direct connection string>" pnpm db:migrate`
3. Create a PowerSync Cloud instance: connect it to the Supabase DB as `powersync_role`,
   enable **Use Supabase Auth**, and deploy the contents of `infra/powersync/sync-config.yaml`
   (defines the `user_tasks` stream).
4. Put the instance URL in `EXPO_PUBLIC_POWERSYNC_URL` and the Fastify origin in
   `EXPO_PUBLIC_API_URL`. For web, set the API `CORS_ORIGIN` to the Expo origin
   (e.g. `http://localhost:8081`).

### B. Fully self-hosted (Docker)

```sh
cd infra/supabase && cp .env.example .env && sh utils/generate-keys.sh && sh utils/add-new-auth-keys.sh --update-env && cd ../..
git checkout -- infra/supabase/docker-compose.yml   # overlay sets GOTRUE_JWT_KEYS; do not keep vendored edits
pnpm infra:up                     # Supabase + PowerSync + API, waits for health checks
pnpm infra:powersync:bootstrap    # replication role + publication in the Supabase DB
pnpm db:migrate                   # creates public.tasks and adds it to the publication
```

Studio: http://localhost:8000 · API gateway: http://localhost:8000 · PowerSync: http://localhost:8080 · API: http://localhost:3000.
Point the env files at these local URLs (see comments in `.env.example`).

### Authentication setup

Accounts are email + password with confirmation through the link in Supabase's default
"Confirm signup" email, so the project needs:

1. **Authentication → Sign In / Providers → Email**: enabled, with *Confirm email* on.
2. **Authentication → URL Configuration → Site URL**: the web app's origin, e.g.
   `http://localhost:8081` for `expo start --web`. The confirmation link redirects there with
   the session in the URL fragment, and the web client picks it up and signs the user in.
   On native there is no deep link yet: the link opens in the browser and the user returns to
   the app and signs in with their password (the email is confirmed server-side either way).
3. Supabase's built-in email service only delivers to the project's team members and allows
   about 2 emails per hour; use a team address for development. Anything more needs custom SMTP
   (https://supabase.com/docs/guides/auth/auth-smtp), which also unlocks template editing.

Sessions persist in AsyncStorage on native and `localStorage` on web. Sign-out only ends the
current device's session. A non-empty PowerSync upload queue blocks sign-out until the
changes sync, with a secondary **Sign out and discard**.

The Fastify API verifies those access tokens against the project's JWKS
(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`), ES256 only. Cloud projects need
asymmetric JWT signing keys (the default for new projects; legacy HS256 projects migrate
under **Authentication → JWT Signing Keys**). The local stack needs `JWT_KEYS` in
`infra/supabase/.env` (from `utils/add-new-auth-keys.sh --update-env`; restore any
vendored `docker-compose.yml` edit — `compose.local.yaml` overlays `GOTRUE_JWT_KEYS` on
Auth). The same token authenticates PowerSync (Use Supabase Auth) and `POST /sync/upload`.
Web uploads need the API to allow the Expo origin:

```sh
# repo-root .env — required for the web client talking to a local API
CORS_ORIGIN=http://localhost:8081
```

Smoke test (API JWT + a signed-in session that can upload):

```sh
curl -H "Authorization: Bearer <access_token>" http://localhost:3000/me
```

On web the access token is in `localStorage` under `sb-<project-ref>-auth-token`. After
sign-in, creating an account task should POST it to `/sync/upload` and show **Synced**.

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

CI (`.github/workflows/ci.yml`) always typechecks, lints and unit-tests. Expo web/iOS
exports run when `apps/client` or `packages/contracts` change; the API image when
`apps/api` or `packages/{contracts,database}` change; compose validation when compose
files or `infra/` change; API integration tests when the API, contracts, database or
PowerSync config change. Pushes to `main` run every job. PRs do not export the Docker cache.

## Testing policy

- Unit tests for business logic (repositories, validation, pure helpers), colocated as `*.test.ts`.
- Targeted integration tests for authorization and PowerSync upload handling in `apps/api/test/integration` (need a database; CI runs them in the `integration` job against `supabase/postgres`).
- No end-to-end suite.

API integration tests against the **self-hosted** stack only, never Cloud:

```sh
pnpm infra:up
pnpm infra:powersync:bootstrap
pnpm db:migrate
DATABASE_URL=postgresql://postgres:<password>@localhost:5432/postgres \
  pnpm --filter @todoist-clone/api test:integration
```
