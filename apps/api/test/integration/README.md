Integration tests live here and run with `pnpm --filter @todoist-clone/api test:integration`.

Scope (see docs/architecture.md, "Testing"):
- authorization of PowerSync uploads (a user cannot write rows they do not own)
- upload handlers applying PUT/PATCH/DELETE operations to Postgres

They require a reachable Postgres (`DATABASE_URL`). CI runs them in the `integration`
job against `supabase/postgres`. Locally, use the self-hosted stack — never Cloud:

```sh
pnpm infra:up
pnpm infra:powersync:bootstrap
pnpm db:migrate
DATABASE_URL=postgresql://postgres:<password>@localhost:5432/postgres \
  pnpm --filter @todoist-clone/api test:integration
```
