# syntax=docker/dockerfile:1

# ---- deps: installed once, shared by build and runtime ----
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build: Next standalone output ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next build touches lib/env.ts at page-data-collection time (see the
# NEXT_PHASE=phase-production-build exemption in lib/env.ts) — this only
# needs to parse as a valid Postgres URL, nothing connects during build.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm build

# ---- runtime: both services, differing only by command ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S aqua && adduser -S aqua -G aqua -u 1001

# Next's self-contained server (web service). Standalone output does not
# include public/ or .next/static — Next's own docs are explicit that
# these must be copied in separately.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Full source + node_modules: needed by the worker and the migration
# step (db/deploy.ts), which run via tsx directly rather than through
# Next's bundler — standalone output only traces and bundles what the
# Next app itself imports, not worker/index.ts.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/db ./db
COPY --from=build /app/lib ./lib
COPY --from=build /app/worker ./worker
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/package.json ./package.json

RUN chown -R aqua:aqua /app
USER aqua

EXPOSE 3000

# Both services differ only by the command docker-compose.prod.yml gives
# them (`node server.js` for web, `node_modules/.bin/tsx worker/index.ts`
# for worker). This default exists so a bare `docker run` does the
# sensible thing.
CMD ["node", "server.js"]
