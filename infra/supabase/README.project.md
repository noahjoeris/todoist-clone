# Supabase self-hosted stack (vendored)

Unmodified copy of the official Supabase Docker distribution.

- Source: https://github.com/supabase/supabase/tree/self-hosted/v0.8.1/docker
- Tag: `self-hosted/v0.8.1` (commit `8c7a4d9dbbaf8b552893822e89d7bf06f33f9220`)
- Docs: https://supabase.com/docs/guides/self-hosting/docker

Do not edit the upstream files in this directory. Project-specific additions live in the
repo-root `compose.supabase.yaml` (`include` of this stack) and `compose.local.yaml`
(service overlays + PowerSync), and in `infra/powersync/`.

## Auth redirect URLs

Native confirmation, password-reset, and email-change emails use
`todoist-clone://auth/callback`. `compose.local.yaml` always adds that URL to GoTrue's
`GOTRUE_URI_ALLOW_LIST`. Extra allow-listed URLs can be set as comma-separated
`ADDITIONAL_REDIRECT_URLS` in `infra/supabase/.env`; they are appended. Do not edit the
vendored `.env.example` or compose files for this. Cloud projects add the same URL under
**Authentication → URL Configuration → Redirect URLs** (see the root README).

## First-time setup

```sh
cd infra/supabase
cp .env.example .env
sh utils/generate-keys.sh              # random secrets
sh utils/add-new-auth-keys.sh --update-env  # publishable/secret API keys + JWT_KEYS
git checkout -- docker-compose.yml     # script uncomments GOTRUE_JWT_KEYS; we overlay it instead
```

Then start everything from the repo root with `pnpm infra:up`.

On macOS, Storage's bind mount (`volumes/storage`) can misbehave; switch it to a named
volume in `compose.local.yaml` if uploads fail (see the upstream README, "Using file backend
in Storage on macOS").

## Updating

Follow https://supabase.com/docs/guides/self-hosting/updating (`update.sh`) and record the
new tag/commit in this file.
