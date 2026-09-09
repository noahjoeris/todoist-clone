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
- New synced tables need, together: a Drizzle migration (incl. `ALTER PUBLICATION powersync ADD TABLE`),
  a Sync Stream in `infra/powersync/sync-config.yaml`, and the client table in
  `apps/client/src/data/powersync/schema.ts`.
- Do not edit vendored files under `infra/supabase/` (except `README.project.md`).
- Secrets only in untracked `.env` files; update the matching `.env.example` when adding variables.
- Expo: this project uses SDK 57. Check https://docs.expo.dev/versions/v57.0.0/ before writing
  Expo/React Native code; APIs change between SDKs.

## Verify before finishing

```sh
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

Client bundle checks when touching `apps/client` or Metro config:

```sh
pnpm --filter @todoist-clone/client export:web
pnpm --filter @todoist-clone/client exec expo export --platform ios
```
