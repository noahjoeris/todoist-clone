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
time) in Inbox, Today, and Upcoming: complete and reopen from the checkbox, edit from the task,
quick reschedule (Today / Tomorrow / Choose date / No date), and delete with an 8-second Undo.
Completed tasks sit in a collapsed section that follows the current view. A persistent sidebar
appears from 900 logical pixels; narrower screens use a menu and overlay drawer. Email/password
accounts with email-link confirmation, password reset, email change, and persistent sessions are
available when cloud env is set. Guest tasks stay on the device and are hidden while signed
in; after sign-in the app offers to add them to the account (or skip / don't ask again),
preserving completion. Signed-in users sync account-owned tasks through PowerSync, including
completion and restores. Signed-in users can also create labels, attach them to tasks from a
searchable picker (inline create uses charcoal and persists even if the task draft is cancelled),
browse a label’s tasks, pin favorites in the sidebar, and manage rename/recolor/favorite/delete
offline. Labels are account-only: guests see no label chips or navigation, and guest-task
adoption does not copy labels. Signed-in users organize tasks into personal projects
(Inbox is `project_id IS NULL`): create/rename/recolor/reorder/favorite/archive/delete
offline, pick a project from a searchable Inbox-inclusive picker, and open a project
task list. Guest-only use needs no `.env`: run `pnpm install`,
`pnpm build`, then `pnpm --filter @todoist-clone/client web` (or a native development build).
View membership, ordering, and create defaults: [docs/task-views.md](docs/task-views.md).

This project is pre-release: schema changes replace the initial Drizzle migration in place.
Reset local SQLite (reinstall / clear site data) and re-run `pnpm db:migrate` against a
fresh or wiped Postgres when `public.tasks`, `public.labels`, `public.task_labels`, or
`public.projects` change; do not expect additive upgrades. After stream or publication
changes, redeploy `infra/powersync/sync-config.yaml` to PowerSync Cloud (or restart the
local PowerSync service).

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
   then apply Drizzle migrations (creates `public.tasks`, `public.labels`,
   `public.task_labels`, and `public.projects` and adds them to the publication):
   `psql "<direct connection string>" -v powersync_password='...' -f infra/powersync/bootstrap-source-db.sql`
   then `DATABASE_MIGRATION_URL="<direct connection string>" pnpm db:migrate`
3. Create a PowerSync Cloud instance: connect it to the Supabase DB as `powersync_role`,
   enable **Use Supabase Auth**, and deploy the contents of `infra/powersync/sync-config.yaml`
   (defines the `user_tasks`, `user_labels`, `user_task_labels`, and `user_projects`
   streams). Redeploy that file whenever streams change.
4. Put the instance URL in `EXPO_PUBLIC_POWERSYNC_URL` and the Fastify origin in
   `EXPO_PUBLIC_API_URL`. For web, set the API `CORS_ORIGIN` to the Expo origin
   (e.g. `http://localhost:8081`).

### B. Fully self-hosted (Docker)

```sh
cd infra/supabase && cp .env.example .env && sh utils/generate-keys.sh && sh utils/add-new-auth-keys.sh --update-env && cd ../..
git checkout -- infra/supabase/docker-compose.yml   # overlay sets GOTRUE_JWT_KEYS; do not keep vendored edits
pnpm infra:up                     # Supabase + PowerSync + API, waits for health checks
pnpm infra:powersync:bootstrap    # replication role + publication in the Supabase DB
pnpm db:migrate                   # creates public.tasks/labels/task_labels/projects and adds them to the publication
```

Studio: http://localhost:8000 · API gateway: http://localhost:8000 · PowerSync: http://localhost:8080 · API: http://localhost:3000.
Point the env files at these local URLs (see comments in `.env.example`).

### Authentication setup

Accounts are email + password with confirmation through the link in Supabase's default
"Confirm signup" email, so the project needs:

1. **Authentication → Sign In / Providers → Email**: enabled, with *Confirm email* on.
2. **Authentication → URL Configuration → Site URL**: the web app's origin, e.g.
   `http://localhost:8081` for `expo start --web`. Confirmation, password-reset, and
   email-change links redirect there with the session in the URL fragment, and the web client
   picks it up. A recovery link opens the set-new-password screen; an email-change link
   updates the signed-in address after confirmation.
3. **Authentication → URL Configuration → Redirect URLs**: add
   `todoist-clone://auth/callback`. Native `signUp` / `resend` / recovery / email-change pass
   that as `emailRedirectTo` / `redirectTo` so the link opens the app (`scheme` in
   `apps/client/app.json`); the client exchanges it for a session. The self-hosted stack
   allow-lists the same URL via `compose.local.yaml` (`GOTRUE_URI_ALLOW_LIST`); extra URLs
   can be appended with `ADDITIONAL_REDIRECT_URLS` in `infra/supabase/.env` (see
   [infra/supabase/README.project.md](infra/supabase/README.project.md)).
4. Supabase's built-in email service only delivers to the project's team members and allows
   about 2 emails per hour; use a team address for development. Anything more needs custom SMTP
   (https://supabase.com/docs/guides/auth/auth-smtp), which also unlocks template editing.

Forgot password lives on Sign in. Change email and change password live on the account
screen. Changing email sends a confirmation link to the new address; the current address
stays active until that link is opened.

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

### Native development builds

PowerSync’s native SQLite and React Native Reanimated both require a development build
(not Expo Go). After adding or upgrading native modules, including Reanimated / Worklets
(`pnpm --filter @todoist-clone/client exec expo install react-native-reanimated react-native-worklets`),
rebuild the client (`pnpm --filter @todoist-clone/client ios` or `android`).
SDK 57’s `babel-preset-expo` configures the Reanimated/Worklets Babel plugin automatically;
do not add that plugin by hand. See [Expo SDK 57 Reanimated](https://docs.expo.dev/versions/v57.0.0/sdk/reanimated/).

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
Pushes to `main` also run `.github/workflows/preview.yml` (Cloudflare Pages Direct Upload
of `apps/client/dist`). That workflow is not a required PR check, does not run on pull
requests, and needs the `preview` environment secrets described below.

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

## Preview / QA

Phase 1 serves one stable public HTTPS URL of the Expo web client for interactive QA of
sign-in, sync, guest-task adoption, and sign-out. It is **not** a merge gate. Native QA
still uses development builds. PR previews are a later phase.

### URL

**https://todoist-clone.pages.dev** — Cloudflare Pages project `todoist-clone`, production
branch `main`, app at the domain root. If Cloudflare assigns a different `*.pages.dev`
hostname, update this section and the `CLOUDFLARE_PAGES_PROJECT` / `PREVIEW_URL` values in
`.github/workflows/preview.yml`. A custom domain is optional and not required for v1.

A failed deploy is visible in GitHub Actions (**Preview** workflow) and leaves the last
successful production deployment in place.

### Staging services

Shared staging, not an isolated stack. **Do not guess URLs.** Record owners and actual
values here when Noah confirms them. A client-only deploy is not enough for interactive
acceptance: the Fastify API must be reachable over public HTTPS from a remote browser.

| Service | Owner | Value | Notes |
| --- | --- | --- | --- |
| Cloudflare Pages `todoist-clone` | _TBD_ | https://todoist-clone.pages.dev | Direct Upload from Actions; Free plan; 25 MiB per-file limit |
| Fastify API | _TBD_ | _public HTTPS URL TBD_ | Image: `docker build -f apps/api/Dockerfile .`. Document sleep/pause if any. |
| Supabase (Auth + Postgres) | _TBD_ | _project URL TBD_ | Same project PowerSync uses for Auth |
| PowerSync Cloud | _TBD_ | _instance URL TBD_ | Deploy `infra/powersync/sync-config.yaml` (`user_tasks`, `user_labels`, `user_task_labels`, `user_projects`) |

API runtime env (host only, never in the client bundle): `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, `CORS_ORIGIN`, plus the host `HOST`/`PORT`. Confirm HTTPS, `/health`,
an authenticated `GET /me`, and a real `POST /sync/upload` — a healthy container is not
enough. Writes stay authorized in Fastify.

### GitHub secrets (`preview` environment)

Create a GitHub Actions environment named **`preview`**, restricted to the `main` branch.
Store these **environment** secrets (not repository secrets, so ordinary PR CI cannot see
them):

| Secret | Purpose |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Staging Supabase HTTPS URL |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key for that same project |
| `EXPO_PUBLIC_POWERSYNC_URL` | Staging PowerSync Cloud endpoint |
| `EXPO_PUBLIC_API_URL` | Public HTTPS Fastify origin, never `localhost` |
| `CLOUDFLARE_API_TOKEN` | Account → Cloudflare Pages → Edit, scoped to the chosen account |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id (not intrinsically secret; stored here anyway) |

The four `EXPO_PUBLIC_*` values are injected only into the export step and are readable in
the browser bundle by design. Changing them requires a rebuild/redeploy. Missing or
non-public-HTTPS values fail the job **before** upload so guest-only mode cannot ship.

The Cloudflare token is passed only to the upload step. Never put `SUPABASE_SECRET_KEY`,
database URLs/passwords, account passwords, or host tokens in client variables, committed
files, or the uploaded `dist`. No GitHub PAT is required.

Cloudflare setup: create a **Direct Upload** Pages project named `todoist-clone` with
production branch `main` (do not also connect Git integration — that would double-deploy).
Create an API token with **Account → Cloudflare Pages → Edit**.

### API CORS and Supabase Auth URLs

On the deployed API, prefer exact origins (the parser is exact strings or the single value
`*`; it does **not** treat `https://*.pages.dev` as a wildcard):

```dotenv
CORS_ORIGIN=https://todoist-clone.pages.dev,http://localhost:8081
```

Origins are scheme + hostname + optional port, no path or trailing slash. Restart/redeploy
the API after changing this. Keep `http://localhost:8081` only if this API also serves
local development. `CORS_ORIGIN=*` is acceptable only as a temporary shared-staging
exception if Noah documents that choice; it is not the default. CORS is not write
authorization.

In the selected Supabase project's **Authentication → URL Configuration**:

- **Site URL**: `https://todoist-clone.pages.dev/` (the single default redirect; replacing
  it affects every consumer of this project, including local developers).
- **Redirect URLs**: add that exact root; keep other deliberate destinations such as
  `http://localhost:8081/` and `todoist-clone://auth/callback`.
- Keep email/password and **Confirm email** enabled. Web `signUp` does not pass
  `emailRedirectTo`, so confirmation returns to Site URL with a session fragment; the web
  client persists it in `localStorage`.

### Test accounts and data

- Reusable **confirmed** accounts per tester (passwords live in a private store, not here).
- One eligible mailbox for a single confirmation-link smoke. Supabase's default SMTP
  delivers only to project-team addresses, about two messages per hour, with no SLA.
  Custom SMTP is a dependency if testers need other addresses; do not disable confirmation.
- Prefix disposable tasks with tester/run (e.g. `qa-18-<date>-…`). Avoid real personal data
  and concurrent tests on one account where possible.
- Cleanup owner: _TBD_. After smoke, delete prefixed tasks (and labels/projects created
  for the run) from the account, restore any browser network blocking, and do not leave
  blocked upload endpoints. Duplicate-name offline races and oversized project
  delete/reorder fail as documented (400 batch discard, or a local operation-limit
  error that offers archive); they are not merged automatically.

### Redeploy and restore

- **Ship a new preview:** merge to `main` (or **Actions → Preview → Run workflow** on
  `main`). The job summary records the commit and URL.
- **Rerun a failed deploy:** the same workflow dispatch, after fixing secrets/config. The
  previous successful Pages production deployment stays live until a new upload succeeds.
- **Restore a known-good build:** in the Cloudflare dashboard, Pages → `todoist-clone` →
  Deployments → roll back to the last good production deployment; or revert the bad commit
  on `main` and push so Actions rebuilds that tree.

### Smoke checklist

Record PASS/FAIL per step with URL, deployed commit, browser, and date. Do not publish
passwords or URL fragments/tokens. Interactive smoke is not required to merge product PRs.

1. Clean browser profile: load the stable URL, request a nested path (e.g. `/inbox`) and
   refresh. Confirm the app shell. In Network, `/@powersync/worker.js` and requested WASM
   must be real assets (correct content type, not `index.html` behind a 200). Check Console.
2. Create a disposable guest task, then sign in with a confirmed test account. Confirm
   account tasks and the guest-adoption banner. Adopt once; it must not be offered again.
   In a fresh guest-data setup, skip/dismiss and confirm unadopted guest tasks survive
   sign-out.
3. Create/update an account task and wait for **Synced**. Confirm `POST /sync/upload` and
   PowerSync traffic. In a second clean profile, sign in to the same account and confirm
   the change arrives (live `user_tasks` stream, not only local persistence). Reload to
   confirm session restoration.
4. Account screen: sign out with no pending uploads. Sign in again, block the API upload
   endpoint, make a disposable account edit. Normal sign-out must stay disabled while
   uploads are pending. Unblock, wait for the queue to drain, sign out. Repeat with
   **Sign out and discard**; the discarded edit must never appear in the second profile.
5. Once, with the agreed eligible mailbox and email budget: sign up, open the confirmation
   link in the intended profile, and confirm it lands on the Site URL and establishes a
   session. Reusable confirmed accounts do not replace this redirect check.
6. Remove smoke data, restore network blocking, record results. If a step fails, check API
   availability/CORS, Auth URL/email settings, and PowerSync assets/configuration
   separately.

Implementation of the workflow is complete when this runbook and `.github/workflows/preview.yml`
land; interactive acceptance is separate and still needs the staging decisions above.
