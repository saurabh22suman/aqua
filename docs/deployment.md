# Deployment — Aqua on Dokploy

Target: **one Dokploy instance on one VPS**, three Applications
(`web`, `worker`, `migrate` one-shot) plus one Dokploy-managed
Postgres database. All four live on the same Dokploy server. Image
builds happen in **GitHub Actions**, not on the Dokploy server
(Dokploy's own docs recommend this — server-side builds under
load freeze the VPS, see
[Going Production](https://docs.dokploy.com/docs/core/applications/going-production)).

The migration step runs as a one-shot Application with the privileged
`MIGRATION_DATABASE_URL` connection — **never** from the web/worker
containers at boot. `tests/tier1/no-superuser-on-request-path.test.ts`
enforces this at the source level: any code path that imports
`@/db/client` and references `MIGRATION_DATABASE_URL` on the
request path fails CI.

The worker is not optional. Without it, pg-boss schedules never
fire, sessions never materialise, and the symptom is invisible —
the next coach to open an empty register sees a blank "today"
list and assumes nothing is wrong with the data.

## What ships

| Component            | Source                                | Role                                    |
| -------------------- | ------------------------------------- | --------------------------------------- |
| `web` Application    | `Dockerfile` + `node server.js`       | Public Next.js server on port 3000      |
| `worker` Application | `Dockerfile` + `tsx worker/index.ts`  | pg-boss consumer for `sessions.generate`|
| `migrate` one-shot   | `Dockerfile` + `tsx db/deploy.ts`     | Bootstrap roles, run migrations, init pg-boss queues + per-tenant schedules |
| Postgres database    | Dokploy-managed Postgres 16           | Primary store; `app_login` connects for app/worker, `aqua` (superuser) for migrate |

All three containers share the same image. The image declares
`node server.js` as the default `CMD`; `docker-compose.prod.yml`
overrides per service via the compose `command:` field, Dokploy
Applications do the same via the **Advanced → Run Command** field.

## Dockerfile (already on this branch)

```
# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps → build → runtime
COPY --from=build /app/.next/standalone → ./
COPY --from=build /app/.next/static → ./.next/static
COPY --from=build /app/public → ./public
COPY --from=deps /app/node_modules → ./node_modules
COPY --from=build /app/{db,lib,worker,tsconfig.json,package.json} → ./
USER aqua
EXPOSE 3000
CMD ["node", "server.js"]
```

`scripts/` is deliberately **not** in the runtime image — those
files are CLI utilities for the developer's machine and for
the migrate step, not for the web/worker. The migrate container
also uses this image; `tsx db/deploy.ts` resolves through the
image's own `db/` and `node_modules/` copy.

**Known issue — already fixed locally, not yet pushed.** The
Dockerfile originally set only `ENV DATABASE_URL` in the build
stage. `lib/env.ts` requires `MIGRATION_DATABASE_URL`
unconditionally (the build phase is exempt from BETTER_AUTH_SECRET
but not from MIGRATION_DATABASE_URL — see the explicit throw at the
bottom of `parseEnv`). Without that env, `pnpm build` fails at
page-data-collection time with a confusing
`Invalid environment configuration: MIGRATION_DATABASE_URL` error
that looks like an env-var bug, not a Dockerfile bug. Fixed by
adding `ENV MIGRATION_DATABASE_URL=postgresql://build:build@localhost:5432/build`
to the build stage. Verified: image builds, prod compose up brings
all three services online, web `/api/health` returns 200, worker
logs `[worker] started — listening on sessions.generate`.

## Local Docker verification

The existing `docker-compose.prod.yml` exists for this purpose
only — its header comment is explicit. Dokploy manages its own
real secrets per service in production; the compose file's
credentials are throwaway local values. To reproduce:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps    # all three healthy
curl -s http://localhost:3000/api/health        # {"status":"ok"}
docker compose -f docker-compose.prod.yml logs --tail=20 worker
# [worker] started — listening on sessions.generate
docker compose -f docker-compose.prod.yml down -v   # tears down
```

To exercise the worker end-to-end, insert one tenant + register a
pg-boss schedule directly (no `scripts/` in the image — local test
only). With one test tenant and a `*/1 * * * *` schedule, the
worker log shows `[sessions.generate] tenant <id>: 0 session(s) created`
within a minute (zero is correct — the test tenant has no batches).

## Dokploy setup, per service

### Project layout in Dokploy

Create one Dokploy project (e.g. `aqua-prod`) with four children:

```
aqua-prod (project)
├── postgres      (Dokploy-managed database — type: Postgres)
├── migrate       (Application, one-shot, restart=no)
├── web           (Application, public, scale=1, has domain)
└── worker        (Application, scale=1, no domain)
```

The order in which you create them doesn't matter; deploy order
matters (see "Deploy sequence" below).

### Image: GHCR (recommended)

Dokploy's own docs recommend building in CI/CD rather than on the
Dokploy server: server-side Docker builds under load exhaust the
VPS and freeze every other application on it.

1. **GitHub Actions** builds the image on every push to `main`
   and pushes it to `ghcr.io/<org>/aqua-web` (the repo already
   builds in CI for tests; adding the docker build is a thin
   wrapper around the existing `pnpm build` step). Tag every
   image with `sha-<short>` and `latest`.
2. **Dokploy Registry:** Settings → Registry → Add GHCR. Username
   = GitHub username/org, Password = GitHub PAT with
   `write:packages`, URL = `ghcr.io`. (Dokploy has a step-by-step
   guide at `/docs/core/registry/ghcr`.) Click **Test** before save.
3. **Application source type:** Docker → Docker Image → `ghcr.io/<org>/aqua-web:latest`.
   Pinning `latest` is fine for the pilot; production can move to
   immutable tags once rollback needs to span multiple deploys.

### `migrate` (one-shot)

| Field                       | Value                                                |
| --------------------------- | ---------------------------------------------------- |
| Source                      | Docker image (`ghcr.io/<org>/aqua-web:latest`)        |
| Run Command                 | `node_modules/.bin/tsx db/deploy.ts`                  |
| Restart Policy              | `no` (one-shot)                                       |
| Wait until healthy          | Yes                                                   |

Required env vars (see "Env vars per service" below). The
migration runs **before** the web and worker deploys — Dokploy
Application dependencies handle this. If the migration fails,
the web/worker deploys are held and the failure surfaces in the
Dokploy UI; nothing reaches a partial-schema state.

### `web` (public)

| Field                       | Value                                                |
| --------------------------- | ---------------------------------------------------- |
| Source                      | Docker image (`ghcr.io/<org>/aqua-web:latest`)        |
| Run Command                 | `node server.js`                                      |
| Restart Policy              | `unless-stopped`                                      |
| Domain                      | `aqua.example.com` (your real domain)                |
| HTTPS                       | Enabled, certificate = Let's Encrypt (auto-issued)   |
| Container port              | 3000                                                  |
| Health check (Swarm)        | `["CMD", "node", "-e", "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]`, interval 10s, timeout 5s, retries 5 |
| Update Config (zero-downtime)| `{"Parallelism": 1, "Delay": "10000000000", "FailureAction": "rollback", "Order": "start-first"}` (10s start delay before the old container stops — see "Rollback" below) |

`alpine` images don't ship `curl` by default — Dokploy's health-
check examples use `curl` but our image uses `node -e` so it
works without an extra `apk add curl`. This is the same shape
as the existing `docker-compose.prod.yml` healthcheck.

### `worker` (no public HTTP)

| Field                       | Value                                                |
| --------------------------- | ---------------------------------------------------- |
| Source                      | Docker image (`ghcr.io/<org>/aqua-web:latest`)        |
| Run Command                 | `node_modules/.bin/tsx worker/index.ts`              |
| Restart Policy              | `unless-stopped`                                      |
| Domain                      | **none** — worker has no HTTP listener               |
| Health check                | none (Dokploy's default container-status check covers "process died") |

The worker's only "health" is "process is alive and pg-boss can
hold the queue lock". Dokploy's container-status check covers that.
For application-level health (pg-boss actually listening), the
Dokploy logs panel shows `[worker] started — listening on sessions.generate`
on every restart — check this after a deploy.

**Scale must stay at 1.** pg-boss locks each job to a single
consumer via SELECT FOR UPDATE SKIP LOCKED. Two workers pulling
the same queue would race and double-process; the queue itself
doesn't prevent this. Multiple workers with horizontal scale is
not safe with this queue.

## Env vars per service

**Shared project-level vars** (Dokploy supports project-shared
env vars — set once, referenced from every service):

```
POSTGRES_PASSWORD=<long random>     # only for Dokploy's Postgres DB creation UI
APP_LOGIN_PASSWORD=<long random>    # must equal the password embedded in DATABASE_URL
```

The two passwords must be equal — `lib/env.ts`'s parser enforces
this with `passwordOf()` and the `superRefine` check at lib/env.ts:96-106.
A drift here surfaces as a bare Postgres auth failure at first
connection, with no indication why. Set them once at the project
level; reference them as `${{project.APP_LOGIN_PASSWORD}}` from
each Application's env.

### `web` env

```
DATABASE_URL=postgresql://app_login:${{project.APP_LOGIN_PASSWORD}}@postgres:5432/aqua
BETTER_AUTH_SECRET=<random 32+ chars, base64 or hex>   # required in production
BETTER_AUTH_URL=https://aqua.example.com                # exact public origin
PARENT_LINK_SECRET=<random 32+ chars>                   # required in production
NODE_ENV=production
DEMO_MODE=false                                          # default; explicit
OFFLINE_SYNC_ENABLED=                                    # per-tenant in real ops; leave empty here
```

`DATABASE_URL` uses Dokploy's internal Postgres hostname
(`postgres` — the Dokploy-generated service name on the project
network). `BETTER_AUTH_SECRET` and `PARENT_LINK_SECRET` are
generated via `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
once, then stored as Dokploy project-shared env vars. **Never**
commit these to source.

### `worker` env

```
DATABASE_URL=postgresql://app_login:${{project.APP_LOGIN_PASSWORD}}@postgres:5432/aqua
NODE_ENV=production
```

**No `MIGRATION_DATABASE_URL`** — the worker must never connect
as the privileged role. `tests/tier1/no-superuser-on-request-path.test.ts`
scans the codebase for this; the source-level guarantee is part
of the rule, not just the runtime configuration.

### `migrate` env

```
MIGRATION_DATABASE_URL=postgresql://aqua:${{project.POSTGRES_PASSWORD}}@postgres:5432/aqua
APP_LOGIN_PASSWORD=${{project.APP_LOGIN_PASSWORD}}
DATABASE_URL=postgresql://app_login:${{project.APP_LOGIN_PASSWORD}}@postgres:5432/aqua
```

`MIGRATION_DATABASE_URL` connects as `aqua` (Dokploy's default
Postgres superuser — created during the database setup). The
migrate step runs `bootstrap-roles` (creates `app_user`/`app_login`),
runs migrations, then `grantAppUserOnPgBossSchema` to wire the
worker up. **All three of these need the privileged role** —
the app role has no CREATE on `pgboss.*`.

`APP_LOGIN_PASSWORD` here is what `bootstrap-roles.ts` uses to set
the `app_login` role's password. It must equal the password
embedded in the `DATABASE_URL` used by web/worker. The env
parser's `passwordOf()` check makes this explicit — a drift
crashes the web container at first request with no clue.

## Deploy sequence

The migration step is the gate. The order Dokploy runs them:

1. **postgres** — Dokploy-managed Postgres is up before any
   Application deploys; it's the dependency target for the
   project.
2. **migrate** — runs once, exits 0 on success, exits non-zero
   on failure. Dokploy holds dependent Applications until this
   succeeds. If it fails, the migration log shows the failing
   SQL (or role-already-exists, etc.); fix forward, re-deploy.
3. **web** — depends on `migrate` (`service_completed_successfully`
   semantics). Once migrate exits 0, web starts. Healthcheck
   probes `/api/health`; Dokploy waits for healthy before
   marking the deploy success.
4. **worker** — depends on `migrate`. Starts in parallel with
   web (no domain, no healthcheck, no reason to wait).

This ordering is enforced by Dokploy's Application **Dependencies**
field on web and worker (both point at migrate). The image is
rebuilt and pushed to GHCR on every push to `main`; **Dokploy
auto-deploys** when the image tag changes (Settings → Webhook on
the Application, or GitHub Actions `dokploy-action`).

**The migration runs in the privileged role — `MIGRATION_DATABASE_URL`
in the migrate container, never in web/worker.** This is
mechanical, not a request-path concern: `lib/env.ts`'s parser
exposes `MIGRATION_DATABASE_URL` only if the env var is set,
and `lib/auth/server.ts`, `lib/services/**`, `worker/index.ts`,
and the Next.js route handlers don't import or reference it.
`tests/tier1/no-superuser-on-request-path.test.ts` enforces this
mechanically — the test allowlist permits exactly the scripts
that legitimately need the privileged connection (`db/reset.ts`,
`db/deploy.ts`, `db/bootstrap-roles.ts`, `db/migrate.ts`, the
migration scripts) plus the test files that need it for fixture
setup. Any new file referencing `MIGRATION_DATABASE_URL` outside
that list fails CI.

## Postgres: Dokploy-managed on the same VPS

**Recommendation: yes — Dokploy-managed Postgres on the same VPS.**
Reasoning:

- Single pane of glass (Dokploy UI for backups, restarts, scaling).
- Internal network between apps and DB — the Postgres port is
  never exposed to the internet. Dokploy's database feature
  creates a private service on the project network; only the
  three Applications on the same project can connect. External
  access is opt-in via a dedicated external port, which we do
  **not** enable.
- Backups via Dokploy's built-in S3 destination (off-server
  storage). A backup stored only on the same VPS as the DB is a
  backup that dies with the DB.
- Restore testing is straightforward (see "Backups" below).
- Single-VPS failure domain is mitigated by backups + a
  quarterly restore drill, not by running Postgres elsewhere.

**When separate Postgres would be the right call:** if/when the
academy operator starts running multiple academies off the same
Aqua instance, and the SLA justifies the operational overhead of
a managed Postgres provider (Neon, Supabase, RDS). For the pilot
and the first production cut, single-VPS is the right trade.

## Backups

Configure on the Dokploy-managed Postgres:

1. **Settings → S3 Destinations** — add an S3 bucket (Backblaze
   B2 + Cloudflare R2 work fine; AWS S3 works; any S3-compatible
   store). Bucket should not live on the same VPS as the database
   (a VPS-loss scenario loses both).
2. **Postgres → Backup tab** — set the destination bucket, the
   database name (`aqua`), a cron schedule (daily 03:00 UTC is
   fine), a prefix (`aqua-prod/`), and **Enabled = on**. Click
   **Test** and confirm a backup file lands in the bucket.
3. The default backup command is `pg_dump -Fc --no-acl --no-owner
   -h localhost -U ${databaseUser} --no-password '${database}' | gzip`
   — per Dokploy's docs. The custom-format dump includes schema
   and data, compressed with gzip; restores via
   `pg_restore -d <db> <dump>.fc`.

### How to TEST a restore

Restoring on top of a live production database is unsafe — the
restore would either drop live data or fail on FK conflicts. Test
restores on a **separate, throwaway** Postgres. Two paths:

**Path A — local Docker, fastest:**

```bash
docker run -d --name restore-target -e POSTGRES_PASSWORD=test \
  -p 5433:5432 postgres:16
# wait for healthy
docker exec restore-target createdb -U postgres aqua
# fetch the latest backup
aws s3 cp s3://<bucket>/aqua-prod/<latest>.gz /tmp/backup.gz
gunzip /tmp/backup.gz
pg_restore -h localhost -U postgres -d aqua /tmp/backup
# smoke-test
psql -h localhost -U postgres -d aqua -c "
  select count(*) from tenants;
  select count(*) from users;
  select count(*) from sessions;
  select count(*) from tenant_features;
"
docker stop restore-target
```

**Path B — second Dokploy-managed Postgres, slower but more
realistic** (includes the network + Dokploy's own restore UI):

1. Provision a second Postgres in Dokploy (any project name; can
   share the S3 destination).
2. Dokploy → second Postgres → Backup tab → **Restore** → pick
   the latest backup file from S3.
3. Smoke-test via Dokploy's internal PgAdmin or a temporary
   Application that connects to it.

**Cadence.** Run the drill once at go-live. Then quarterly.
A backup you haven't restored is a backup you don't have.

## Domain, TLS, health check

**Domain** — point an A record at the VPS IP. Cheap registrars
(Cloudflare Registrar, Porkbun, Namecheap) all work. Dokploy's
Domains tab on the `web` Application takes the hostname and the
container port (3000); select **HTTPS = on**, **Certificate =
Let's Encrypt**. Dokploy auto-issues and auto-renews the cert
through Traefik.

**TLS termination** — handled by Traefik on the Dokploy server.
Traefik terminates TLS at the edge and forwards plain HTTP to
the web container (the Dokploy-managed Traefik is on the same
host network as the web service; it's a reverse proxy, not a
sidecar). The web container sees HTTP requests with the
`X-Forwarded-Proto: https` header — better-auth reads this and
sets `Secure` cookies automatically (its default is
`useSecureCookies=true` whenever the request is HTTPS or
`NODE_ENV=production`).

**Health check wiring** — on the `web` Application, set the
Swarm health check to the `node -e` shell shown in the web
table above. Interval 10s, timeout 5s, retries 5. **Important:**
this is the same check that gates zero-downtime deploys AND the
automatic rollback — Dokploy considers a deploy successful only
when the new container is healthy. A wrong healthcheck string
that always passes (or always fails) silently breaks both.

## Rollback

Dokploy has two rollback paths — use them differently.

**Automatic (Swarm rollback on health check failure).** This is
the default when the health check is configured. Dokploy brings
up the new container, waits for it to be healthy; if it isn't,
Swarm tears it down and reverts to the previous image. This
catches: image won't start, env var boot-fail, DB connection
refused, anything that surfaces as a non-200 on `/api/health`.
Configure once via the `Update Config` shown in the web table.

**Manual (registry-based rollback to a specific deploy).** For
the failures the health check doesn't catch — bad deploy that
passes health but breaks a route, mid-deploy regression in
business logic, "this worked yesterday, revert it now". Enable
in Deployments → Rollback Settings → enable Rollback → pick
the registry (GHCR). Each deploy's image is tagged with the
deployment ID; rollback to any previous one from the
Deployments tab. **Pre-condition: every deploy must produce an
image** — our GitHub Actions workflow builds and pushes on every
push to `main`, so this is automatic.

**What doesn't roll back automatically:** the database. A migration
that broke on `main` stays broken on `main`; you fix forward with
a new migration. The `db/migrations` folder is forward-only by
design — never edit an applied migration (AGENTS.md, absolute
rule).

## Go-live checklist (run against the real production)

These can't be verified in advance — they depend on infrastructure
that doesn't exist until Dokploy is up.

- [ ] **DEMO_MODE must be `false` in production.** `lib/env.ts:113`
      refuses to boot with `DEMO_MODE=true` + `NODE_ENV=production`
      and a server phase. Build-phase exemption covers `next build`
      itself; the real `next start` rejects. Verified by
      `tests/tier1/demo-mode-env.test.ts` ("refuses to boot when
      DEMO_MODE=true and NODE_ENV=production"). Confirm in Dokploy:
      web's env vars contain `DEMO_MODE=false` explicitly.

- [ ] **`rolsuper`/`rolbypassrls` query against REAL production
      Postgres, after `migrate` has run.** `bootstrap-roles.ts`
      creates `app_user`/`app_login` *without* `SUPERUSER` or
      `BYPASSRLS` by construction — Postgres defaults new roles
      to neither, verified locally (`rolbypassrls=f` for both
      rows). But some managed providers hand you a
      superuser-equivalent role by default; bootstrap-roles.ts
      running successfully doesn't prove the resulting roles
      are unprivileged if the provider's role grant is upstream
      of it. After the first migrate runs, connect as
      `MIGRATION_DATABASE_URL`'s user and run:

      ```sql
      select rolname, rolinherit, rolbypassrls, rolcanlogin
      from pg_roles
      where rolname in ('app_user', 'app_login');
      ```

      Expected: `rolbypassrls = f` for both. If `t` — refuse to
      promote, the database is misconfigured and RLS is not
      protecting tenant data.

- [ ] **Set-Cookie carries `Secure` once TLS is live.** better-auth's
      default for `useSecureCookies` is `true` whenever the
      request is HTTPS or `NODE_ENV=production`. The Dokploy
      Traefik reverse proxy terminates TLS and sets
      `X-Forwarded-Proto: https` on the forwarded request;
      better-auth reads it. Verify by curl:

      ```bash
      curl -i -X POST https://aqua.example.com/api/auth/sign-in \
        -H 'Content-Type: application/json' \
        -d '{"phone":"+91XXXXXXXXXX"}'
      ```

      Look at the response headers. Expected: a `Set-Cookie`
      line containing `Secure; HttpOnly; SameSite=Lax`. If
      `Secure` is missing — `BETTER_AUTH_URL` may be `http://`
      (must be `https://` in production), or the reverse proxy
      isn't setting `X-Forwarded-Proto` correctly. Don't assume
      better-auth adds it automatically just because the origin
      is HTTPS — check the actual header.

- [ ] **BETTER_AUTH_SECRET and PARENT_LINK_SECRET set, or app
      refuses to boot.** Both are required in production per
      `lib/env.ts:62-79`. Missing either → `Invalid environment
      configuration` thrown at the first `import` of `lib/env.ts`,
      which is the first thing every Server Component / route
      handler does. Boot fails before any request is served.
      Verified by the unit tests on `parseEnv`. Confirm in Dokploy:
      both vars exist on the web Application's env.

- [ ] **`/p/[token]` still ships zero `<script>` tags from the
      deployed build, not a local one.** The CI guard
      (`scripts/e2e-parent-link-zero-js.ts`) checks this against
      a real `next build` artifact. After go-live, curl the
      deployed URL with a forged token and grep for `<script`:

      ```bash
      curl -s https://aqua.example.com/p/anything | grep -c '<script'
      # expected: 0
      ```

      Forged tokens render the "expired" page (`app/p/[token]/route.ts:115`),
      which is the same code path that ships to a real token —
      the assertion holds either way.

- [ ] **Worker is alive and registered for schedules.**
      Dokploy → worker → Logs → look for
      `[worker] started — listening on sessions.generate` after
      every deploy. A missing line means the worker failed at
      startup (env var or DB connection); check the surrounding
      logs.

- [ ] **A real coach can see tomorrow's session card.** Walk
      the demo runbook once against the deployed build (not a
      local `pnpm dev`). On a fresh tenant, the dashboard's
      "today" lane strip should have at least one card — that's
      the worker having materialised sessions on the schedule
      pg-boss fired. If the strip is empty, the worker's
      schedule registration didn't run for that tenant (re-run
      the migrate step, or call the createTenant path again).

- [ ] **Backups are landing in S3.** Tomorrow morning, log into
      the S3 bucket and confirm a new file under the configured
      prefix exists. Then run the restore drill (Paths A or B
      above) at least once.

## Known follow-ups

- **CI image build.** Adding `docker build` + GHCR push to
  `.github/workflows/ci.yml` is small but is its own change.
  Until that lands, building the image is a manual `docker
  build -t ghcr.io/<org>/aqua-web:latest . && docker push …`
  before each deploy.
- **Registry-based rollback UI** requires enabling per-deploy
  image tagging. Worth doing once the image-build CI lands.
- **Auto-deploy on push** to `main` is also a one-line webhook
  setup once GHCR pushes have the webhook configured.
