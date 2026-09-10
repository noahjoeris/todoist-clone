# AGENTS.md

Instructions for AI agents and humans working in this repository.

## Read first

- `docs/architecture.md` — system overview, package boundaries and the decision log (ADRs).
  Any change that alters the architecture must update this file in the same change.
- `README.md` — setup and commands.

## Working rules

- Respect the boundaries in `docs/architecture.md`: UI → repositories → PowerSync; the client
  never imports `packages/database`; contracts stay dependency-free.
- Writes are authorized in the Fastify API. Never rely on Supabase RLS to protect API writes.
- Pre-release: unreleased, stay on version 1 until the user says otherwise. Do not bump
  package, API, or schema versions. Breaking changes are allowed. Do not add compatibility
  layers, dual-write paths, or data/schema migrations that preserve old shapes. Destructive
  resets of local and cloud data are acceptable.
- New synced tables need, together: a Drizzle migration (incl. `ALTER PUBLICATION powersync ADD TABLE`),
  a Sync Stream in `infra/powersync/sync-config.yaml`, and the client table in
  `apps/client/src/data/powersync/schema.ts`. Schema changes replace those in place; do not
  stack additive upgrade migrations.
- Do not edit vendored files under `infra/supabase/` (except `README.project.md`).
- Secrets only in untracked `.env` files; update the matching `.env.example` when adding variables.
- Expo: this project uses SDK 57. Check https://docs.expo.dev/versions/v57.0.0/ before writing
  Expo/React Native code; APIs change between SDKs.

## Feature PR workflow

- Develop each feature on its own branch; open a PR to `main` after verification.
  Explicit user instructions to defer commits, pushes or PRs take precedence.
  PR titles use the same conventional format as commit subjects (`type(scope): summary`).
  See `docs/pr-reviews.md`.
- Reviews may come from any AI agent or human. The user requests reviews.
  After opening the PR, provide its link
  and hand back to the user; do not trigger reviews or wait indefinitely for them.
- When the user asks to address PR feedback, read review summaries, inline threads
  and general PR comments before making changes.
- Read every finding. Fix valid issues, add relevant regression tests, and reply
  with the fix commit. Explain disagreements with evidence; do not blindly apply suggestions.
- Resolve a review thread only after addressing it and posting a reply. Push fixes
  to the same branch, verify CI, and summarize changes and unresolved findings.
- The user triggers any re-review. Identify changes made since the last reviewed
  commit; do not claim they have been reviewed until a new review confirms that.
- Stop after two fix/re-review rounds if disagreements or recurring findings remain;
  summarize unresolved decisions for the user. No automatic merge; the user merges.
- Distinguish implementation complete, feedback addressed, and review complete.
  No automated review check or reviewer API key is required by this repository.
- See `docs/pr-reviews.md` for the manual review workflow.

## Verify before finishing

```sh
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

Client bundle checks when touching `apps/client` or Metro config:

```sh
pnpm --filter @todoist-clone/client export:web
pnpm --filter @todoist-clone/client exec expo export --platform ios
```
