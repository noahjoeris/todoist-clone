Integration tests live here and run with `pnpm --filter @todoist-clone/api test:integration`.

Scope (see docs/architecture.md, "Testing"):
- authorization of PowerSync uploads (a user cannot write rows they do not own)
- upload handlers applying PUT/PATCH/DELETE operations to Postgres

They require a reachable Postgres (`DATABASE_URL`) and are skipped in the basic CI job.
