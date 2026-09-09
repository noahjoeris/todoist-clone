# syntax=docker/dockerfile:1

# Build context is the repository root:
#   docker build -f apps/api/Dockerfile -t todoist-clone-api .
# The same image can later run the background worker with a different command.

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
# pnpm needs every workspace manifest to validate the frozen lockfile, even for unused projects.
COPY apps/client/package.json apps/client/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @todoist-clone/api...
COPY tsconfig.base.json tsconfig.node.json ./
COPY packages/contracts packages/contracts
COPY packages/database packages/database
COPY apps/api apps/api
RUN pnpm --filter @todoist-clone/api... build
# Produce a self-contained, production-only copy of the API and its workspace deps.
RUN pnpm --filter @todoist-clone/api --prod deploy --legacy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /out ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
