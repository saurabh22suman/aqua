# Deployment — Aqua on Dokploy

**Read this top-down on the first deploy.** The first section is
the step-by-step procedure for going live; the sections after it
are reference material — read them when a step needs detail, not
before.

## What ships

One Dokploy instance on one VPS, with three Applications (`web`,
`worker`, `migrate` one-shot) plus one Dokploy-managed Postgres
database. The migration step runs as a one-shot Application with
the privileged `MIGRATION_DATABASE_URL` connection — **never**
from the web/worker containers at boot.
`tests/tier1/no-superuser-on-request-path.test.ts` enforces this
at the source level: any code path that imports `@/db/client` and
references `MIGRATION_DATABASE_URL` on the request path fails CI.

The worker is not optional. Without it, pg-boss schedules never
fire, sessions never materialise, and the symptom is invisible —
the next coach to open an empty register sees a blank "today"
list and assumes nothing is wrong with the data.

The platform surface is on its own subdomain (`ops.<base>`),
separated from the tenant surface (`<base>`) by `middleware.ts`
(host-based route gating) and pinned by
`scripts/e2e-host-boundary.ts` (a CI e2e that hits each surface
with explicit `Host` headers and asserts the boundary).

## First deploy — step-by-step procedure

For the first deploy only. Re-running for fixes is just steps
**6** and **9** below; the rest is one-time.

### 0. Pre-flight — DNS, secrets, registry

**0a.** Decide on a base domain. The demo uses
`aqua.soloengine.in` (operator decides the real domain).

**0b.** Set up DNS for two hostnames: `<base>` and `ops.<base>`.
Two A records, one per hostname, both pointing at the VPS IP.
Any registrar works — Cloudflare Registrar, Porkbun, Namecheap,
GoDaddy. Cloudflare (the company) is **not** required for this
procedure as long as you're only on hostnames, not per-tenant
subdomains: Dokploy + Traefik issue a Let's Encrypt cert per
hostname automatically (HTTP-01 challenge, since each hostname has
its own working A record; no DNS-01 needed). You get two certs
that auto-renew.

**Cloudflare (the proxy) becomes mandatory for B
(per-tenant subdomains)** — Dokploy's
[certificates docs](https://docs.dokploy.com/docs/core/certificates)
don't document a DNS-01 wildcard path, so `*.aqua.soloengine.in`
isn't natively issuable from Dokploy. The future-work section on
B describes that constraint and the rate-limit reasoning. For
today's deploy (A only, two hostnames), no Cloudflare.

**0c.** Generate the four secrets. One terminal:

```bash
node -e "console.log('POSTGRES_PASSWORD=' + require('crypto').randomBytes(24).toString('base64'))"
node -e "console.log('APP_LOGIN_PASSWORD=' + require('crypto').randomBytes(24).toString('base64'))"
node -e "console.log('BETTER_AUTH_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('PARENT_LINK_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

**`APP_LOGIN_PASSWORD` and the password embedded in `DATABASE_URL`
must match** — `lib/env.ts`'s parser enforces this with
`passwordOf()` (lib/env.ts:96-106). A drift crashes the web
container at first request with no clue why.

**0d.** Decide on a GHCR image path. Conventions: `ghcr.io/<org>/aqua-web:latest`
is fine; production can move to immutable tags (`sha-<short>`)
once rollback needs to span multiple deploys.

**0e.** Sign in to Dokploy on the VPS. Install instructions:
[Dokploy installation](https://docs.dokploy.com/docs/core/installation).
The Traefik reverse proxy comes with Dokploy — no separate
installation.

### 1. Provision the Postgres database

In Dokploy: **Create Project** → name `aqua-prod`. Inside it,
**Create Service → Database → Postgres 16**. Set:

- **Database Name**: `aqua`
- **User**: `aqua`
- **Password**: the `POSTGRES_PASSWORD` from step 0c
- **External Access**: **off** — the database should not be
  reachable from the internet. Only Dokploy's internal project
  network (which carries the three Applications) sees it.

### 2. Restore-drill task — register, do Path A now

> **"An untested backup is not a backup."** Once fee data
> exists the cost of finding out changes.

Before any real data lives in the database, register this task
in your task tracker (or just in the runbook for the next person):

> **Restore drill — Path A (local Docker, today)**
> 1. Tomorrow morning, after Dokploy's daily backup cron
>    (step 8) has run at least once, follow the Path A procedure
>    in the **Backups → Restore drill** section below.
> 2. The drill confirms: backup file exists in S3; pg_restore
>    succeeds against a throwaway Postgres; row counts in the
>    restored DB match row counts in the live DB (`tenants`,
>    `users`, `sessions`, `tenant_features`).
> 3. The drill confirms the **restore time** — how long from
>    "disaster" to "running again". Anything over an hour means
>    the operator needs a faster drill (Path B, Dokploy-managed
>    Postgres restored from the same S3 bucket, may be quicker).

**Do the drill now** even though the DB is empty — the goal
is to verify the S3 destination, the cron, and the restore
commands work end-to-end before a real failure means learning
this in the worst possible circumstances. With an empty DB, the
smoke-test commands return `0 rows` everywhere; that's fine — the
drill is about the round trip, not the row counts.

> **Restore drill — Path B (Dokploy-managed Postgres, before
> the money chain ships).** Path A is the local smoke test;
> Path B is the production-realistic restore. Schedule as a task
> that blocks the money-chain work: **no fee invoices ship until
> a Path B restore drill has succeeded against a real S3 backup**.
> The drill provisions a second Dokploy-managed Postgres (same
> S3 destination, different project name) and uses Dokploy's
> Restore UI to pull the latest backup into it. Smoke-test the
> row counts. **A backup you haven't restored is a backup you
> don't have.**

### 3. Build and push the image

The CI image-build workflow is on the to-do list (see **Future
work**). For the first deploy, build and push manually on the
local machine:

```bash
docker login ghcr.io -u <org> --password-stdin   # paste PAT with write:packages
docker build -t ghcr.io/<org>/aqua-web:latest .
docker push ghcr.io/<org>/aqua-web:latest
```

The image is multi-purpose: `CMD ["node", "server.js"]` is the
default (web); per-service overrides below. The Dockerfile at
`Dockerfile` (committed) is what gets built — verified end-to-end
by the local compose: `docker compose -f docker-compose.prod.yml
up -d --build` brings all three services online clean, web
`/api/health` returns 200, worker logs
`[worker] started — listening on sessions.generate`. **Go-live
check:** verify the GHCR push shows the image at
`https://ghcr.io/<org>/aqua-web:latest` in the Packages tab.

### 4. Configure Dokploy — registry, applications, domains

#### 4a. GHCR registry

Dokploy → **Settings → Registry → Add Registry**. Pick a name
(e.g., `ghcr-main`), Type **Docker Hub** (Dokploy uses Docker
Hub type for any registry with image:tag pull; GHCR itself is
URL-configurable per the
[GHCR registry doc](https://docs.dokploy.com/docs/core/registry/ghcr)).
Username = `<org>`, Password = PAT with `write:packages`,
Registry URL = `https://ghcr.io`. Click **Test**; confirm the
connection succeeds.

#### 4b. Create the four services

In the `aqua-prod` project, create each Application with the
fields below.

**`migrate`** — one-shot Application (restart policy `no`):

| Field             | Value                                            |
| ----------------- | ------------------------------------------------ |
| Source type       | Docker                                           |
| Image             | `ghcr.io/<org>/aqua-web:latest`                  |
| Run Command       | `node_modules/.bin/tsx db/deploy.ts`              |
| Restart Policy    | `no`                                             |

Env vars:

```
MIGRATION_DATABASE_URL=postgresql://aqua:${{project.POSTGRES_PASSWORD}}@postgres:5432/aqua
APP_LOGIN_PASSWORD=${{project.APP_LOGIN_PASSWORD}}
DATABASE_URL=postgresql://app_login:${{project.APP_LOGIN_PASSWORD}}@postgres:5432/aqua
```

**`web`** — the public surface:

| Field             | Value                                            |
| ----------------- | ------------------------------------------------ |
| Source type       | Docker                                           |
| Image             | `ghcr.io/<org>/aqua-web:latest`                  |
| Run Command       | `node server.js`                                  |
| Restart Policy    | `unless-stopped`                                  |
| Domain            | `<base>` (e.g., `aqua.soloengine.in`)            |
| HTTPS             | Enabled, certificate = Let's Encrypt (auto-issued) |
| Container port    | 3000                                              |
| Health check      | `["CMD","node","-e","fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]`, interval 10s, timeout 5s, retries 5 |
| Update Config     | `{"Parallelism":1,"Delay":"10000000000","FailureAction":"rollback","Order":"start-first"}` |

Add a **second domain** to this same Application:
`ops.<base>` (e.g., `ops.aqua.soloengine.in`). Same HTTPS toggle,
same container port. The same `web` container serves both
subdomains; `middleware.ts` routes by Host.

Env vars (note `BETTER_AUTH_URL` is the apex, not ops — the
platform TOTP login on `ops.<base>/ops/login` reads the cookie
which is host-scoped to ops):

```
DATABASE_URL=postgresql://app_login:${{project.APP_LOGIN_PASSWORD}}@postgres:5432/aqua
BETTER_AUTH_SECRET=${{project.BETTER_AUTH_SECRET}}
BETTER_AUTH_URL=https://<base>
PARENT_LINK_SECRET=${{project.PARENT_LINK_SECRET}
NODE_ENV=production
DEMO_MODE=false
OFFLINE_SYNC_ENABLED=
```

> **Go-live check #1: `BETTER_AUTH_SECRET` and `PARENT_LINK_SECRET`
> are set, and `APP_LOGIN_PASSWORD` matches the password embedded
> in `DATABASE_URL`.** `lib/env.ts:62-79` throws on missing
> either; `lib/env.ts:96-106` throws on password mismatch. The
> web container refuses to boot otherwise — but you want to see
> the error in Dokploy's logs, not discover it after DNS is
> pointed. Save the env vars; click **Deploy** on `web` once to
> see it boot successfully (don't add it to a domain yet — the
> deploy will fail at the cert stage if the domain's DNS isn't
> ready). Then save the env vars back, save the application
> without re-deploying, and continue.

> **Go-live check #2: the dev image builds with `MIGRATION_DATABASE_URL`
> set in the build stage.** The committed Dockerfile has this
> env var set (a bug-fix landed in the `fix(D3-followup)` commit;
> without it, `pnpm build` fails at page-data-collection with a
> misleading "Invalid environment configuration" error). If you
> forked or modified the Dockerfile, confirm `ENV MIGRATION_DATABASE_URL`
> is present in the build stage. The test suite doesn't catch
> this — it's a build-time issue.

**`worker`** — pg-boss consumer:

| Field             | Value                                            |
| ----------------- | ------------------------------------------------ |
| Source type       | Docker                                           |
| Image             | `ghcr.io/<org>/aqua-web:latest`                  |
| Run Command       | `node_modules/.bin/tsx worker/index.ts`            |
| Restart Policy    | `unless-stopped`                                  |
| Domain            | **none** — worker has no HTTP listener           |
| Health check      | none                                              |

Env vars:

```
DATABASE_URL=postgresql://app_login:${{project.APP_LOGIN_PASSWORD}}@postgres:5432/aqua
NODE_ENV=production
```

> **Go-live check #3: the worker has no `MIGRATION_DATABASE_URL`.**
> `tests/tier1/no-superuser-on-request-path.test.ts` enforces
> this at the source level. A stray `MIGRATION_DATABASE_URL` in
> the worker's env is a privilege-escalation path — `app_login`
> has only what the worker needs (table CRUD on the `public`
> schema + `pgboss`); `aqua` has the keys to the database.
> Confirm: only `DATABASE_URL` and `NODE_ENV` in the worker env.

> **Go-live check #4: worker scale stays at 1.** pg-boss locks
> each job to a single consumer via
> `SELECT FOR UPDATE SKIP LOCKED`. Two workers pulling the same
> queue would race and double-process. Cluster Settings → Mode →
> Replicated, Replicas = 1. The test suite doesn't enforce this —
> a misconfiguration silently corrupts session counts.

### 5. Wire dependencies and the deploy order

For `web`: **Dependencies → Add → migrate** (`service_completed_successfully`).
For `worker`: same.

Dokploy's deploy order with these dependencies:

1. **`postgres`** is up (always, before any Application).
2. **`migrate`** runs once, exits 0 on success. Dokploy holds
   dependent Applications until this succeeds. **If migrate
   fails**, the deploy halts — fix forward, re-deploy migrate,
   the dependents resume when it succeeds.
3. **`web`** and **`worker`** deploy in parallel after migrate.

> **Go-live check #5: migrate ran cleanly.** After the first
> deploy, Dokploy's migrate logs show
> `Roles bootstrapped: app_user (nologin), app_login (login, noinherit).`
> and `deploy migration complete. N tenant(s) scheduled.`
> (N = 0 on a fresh deploy — that's fine). Any SQL error in
> between is a migration bug; the engine rolls back the whole
> transaction, so the database is left in its pre-migrate state.

### 6. First deploy

Trigger a deploy on each Application (Deploy button in Dokploy).
Order: `migrate` first, then `web` and `worker` will follow once
`migrate` exits 0.

Watch the migrate logs for the message in check #5. Then watch
the web logs for `✓ Ready in N ms`. Then watch the worker logs
for `[worker] started — listening on sessions.generate`.

### 7. The role-privileges query (production Postgres)

Connect to the production Postgres as the privileged user
(`MIGRATION_DATABASE_URL`'s role):

```bash
psql "$(echo $MIGRATION_DATABASE_URL)" -c "
  select rolname, rolinherit, rolbypassrls, rolcanlogin
  from pg_roles
  where rolname in ('app_user', 'app_login');
"
```

> **Go-live check #6: `rolbypassrls = f` for both `app_user` and
> `app_login`.** `bootstrap-roles.ts` creates both roles *without*
> `SUPERUSER` or `BYPASSRLS` by construction — Postgres defaults
> new roles to neither, verified locally. But some managed
> providers hand you a superuser-equivalent role by default;
> `bootstrap-roles.ts` running successfully doesn't prove the
> resulting roles are unprivileged if the provider's role grant
> is upstream of it. If `rolbypassrls = t` for either, refuse
> to promote — RLS is not protecting tenant data.

### 8. Set up S3 backups

Settings → S3 Destinations → add the S3 bucket (Backblaze B2 +
Cloudflare R2 work fine; AWS S3 works; any S3-compatible store).
Bucket should not live on the same VPS as the database.

Postgres → Backup tab → set the destination bucket, the database
name (`aqua`), a cron schedule (daily 03:00 UTC is fine), a prefix
(`aqua-prod/`), and **Enabled = on**. Click **Test**; confirm
a backup file lands in the bucket.

The default backup command is
`pg_dump -Fc --no-acl --no-owner -h localhost -U ${databaseUser} --no-password '${database}' | gzip`
— per Dokploy's docs.

> **Go-live check #7: backup test succeeded.** Log into the S3
> bucket, confirm a file under `aqua-prod/` exists. Now (with
> empty data) run **Path A** of the restore drill (below) to
> confirm the round trip — restore into a local Postgres, smoke
> test row counts. This is the **Restore drill — Path A**
> task you registered in step 2.

### 9. Set up auto-deploy (later)

Optional. Once the image-build CI lands (Future work), every push
to `main` produces a new image, and Dokploy's webhook can deploy
it automatically. For now, after a code change: rebuild the
image locally, push to GHCR, click Deploy on each Application.

### 10. The platform login warm-up

`next start` compiles each route on first visit, not at server
start — the platform login → verify → landing sequence measured
~2.5s of compile time stacked across three routes on a cold
server. Do one throwaway login (wrong code is fine, or a real
one) right after the first deploy so `ops.<base>/ops/login`,
`ops.<base>/ops/verify`, and `ops.<base>/ops` are already
compiled. After that, the flow is fast for the rest of the session.

### 11. Go-live verification (the live checks)

These are curl/sql/grep against the deployed URL. Do them from
a machine outside the VPS (your laptop) — the checks are about
what a real visitor sees, not what the container thinks.

```bash
DOMAIN=<base>                                       # e.g., aqua.soloengine.in
```

**11a. Health.** `curl -sS https://$DOMAIN/api/health` returns
`{"status":"ok"}`. HTTP 200.

**11b. Tenant login reachable, platform login NOT on apex.**
```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://$DOMAIN/login            # 200
curl -sS -o /dev/null -w "%{http_code}\n" https://$DOMAIN/ops/login        # 404
curl -sS -o /dev/null -w "%{http_code}\n" https://ops.$DOMAIN/login       # 404
curl -sS -o /dev/null -w "%{http_code}\n" https://ops.$DOMAIN/ops/login   # 200
```

> **Go-live check #8: host boundary is enforced in production.**
> Tenant login only on the apex; platform login only on
> `ops.<base>`. If the cross-over results are reversed, the
> `ops.<base>` subdomain isn't routing to the Dokploy-managed
> Traefik entry for the web Application, or the middleware
> isn't compiling (check `pnpm build` output for
> `ƒ Middleware`).

**11c. `Set-Cookie` carries `Secure`.**
```bash
curl -i -X POST https://$DOMAIN/api/auth/sign-in \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+91XXXXXXXXXX"}' | grep -i 'set-cookie'
```
Expected: a `Set-Cookie` line containing `Secure; HttpOnly; SameSite=Lax`.
If `Secure` is missing, `BETTER_AUTH_URL` may be `http://`
(must be `https://` in production), or Traefik isn't setting
`X-Forwarded-Proto: https` correctly.

**11d. `/p/[token]` ships zero `<script>` tags.**
```bash
curl -s https://$DOMAIN/p/anything | grep -c '<script'
# expected: 0
```
Forged tokens render the "expired" page
(`app/p/[token]/route.ts:115`), which is the same code path that
ships to a real token — the assertion holds either way.

**11e. Worker is alive.**
In Dokploy → worker → Logs, look for
`[worker] started — listening on sessions.generate` after every
deploy. A missing line means the worker failed at startup (env
var or DB connection); check the surrounding logs.

### 12. After go-live — monitoring cadence

**Daily.** Log into the S3 bucket, confirm a new backup file
under `aqua-prod/` exists from yesterday's cron.

**Weekly.** Open Dokploy → postgres → Metrics: CPU, memory,
disk. The Postgres is the load-bearing resource; the rest of
the stack is stateless web + worker.

**Quarterly.** Run the restore drill (Path A is fine for the
quarterly check; Path B is more realistic but takes more setup
time). A backup you haven't restored is a backup you don't have.

## Backups

Dokploy → Postgres → Backup tab: S3 destination bucket,
database name (`aqua`), cron schedule (daily 03:00 UTC), prefix
(`aqua-prod/`), **Enabled = on**. Click **Test**; confirm a
backup file lands in the bucket.

Default backup command
(per [Dokploy restore docs](https://docs.dokploy.com/docs/core/databases/restore)):
`pg_dump -Fc --no-acl --no-owner -h localhost -U ${databaseUser} --no-password '${database}' | gzip`.
The custom-format dump includes schema and data, compressed with
gzip; restores via `pg_restore -d <db> <dump>.fc`.

### Restore drill — Path A (local Docker, fastest)

Restoring on top of a live production database is unsafe. Test
restores on a separate, throwaway Postgres.

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

On an empty prod DB, all counts return 0 — that's fine. The
drill is about the round trip, not the data.

### Restore drill — Path B (Dokploy-managed Postgres, realistic)

1. Provision a second Dokploy-managed Postgres (any project name;
   can share the S3 destination).
2. Dokploy → second Postgres → Backup tab → **Restore** → pick
   the latest backup file from S3.
3. Smoke-test via Dokploy's internal PgAdmin or a temporary
   Application that connects to it.

Cadence: at go-live, then quarterly. **No fee invoices ship
until a Path B restore drill has succeeded against a real S3
backup.**

## Domain, TLS, health check

**Domain** — point an A record at the VPS IP. Cheap registrars
(Cloudflare Registrar, Porkbun, Namecheap) all work. Two A
records: `<base>` and `ops.<base>`.

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
Swarm health check to the `node -e` shell shown in step 4b.
Interval 10s, timeout 5s, retries 5. This is the same check that
gates zero-downtime deploys AND the automatic rollback —
Dokploy considers a deploy successful only when the new
container is healthy. A wrong healthcheck string that always
passes (or always fails) silently breaks both.

## Rollback

**Automatic (Swarm rollback on health check failure).** This is
the default when the health check is configured. Dokploy brings
up the new container, waits for it to be healthy; if it isn't,
Swarm tears it down and reverts to the previous image. Catches:
image won't start, env var boot-fail, DB connection refused,
anything that surfaces as a non-200 on `/api/health`. Configure
once via the `Update Config` shown in step 4b.

**Manual (registry-based rollback to a specific deploy).** For
the failures the health check doesn't catch — bad deploy that
passes health but breaks a route, mid-deploy regression in
business logic, "this worked yesterday, revert it now". Enable
in Deployments → Rollback Settings → enable Rollback → pick
the registry (GHCR). Each deploy's image is tagged with the
deployment ID; rollback to any previous one from the
Deployments tab. **Pre-condition: every deploy must produce an
image** — for now this is the manual `docker build && docker push`
from step 3.

**What doesn't roll back automatically:** the database. A migration
that broke on `main` stays broken on `main`; you fix forward with
a new migration. The `db/migrations` folder is forward-only by
design — never edit an applied migration (AGENTS.md, absolute
rule).

## Reference — env vars per service

**Shared project-level vars** (Dokploy supports project-shared
env vars — set once, referenced from every service):

```
POSTGRES_PASSWORD=<long random>     # only for Dokploy's Postgres DB creation UI
APP_LOGIN_PASSWORD=<long random>    # must equal the password embedded in DATABASE_URL
BETTER_AUTH_SECRET=<random 32+ chars, base64 or hex>
PARENT_LINK_SECRET=<random 32+ chars>
```

The two passwords must be equal — `lib/env.ts`'s parser enforces
this. Set them once at the project level; reference them as
`${{project.NAME}}` from each Application's env.

### `web` env

```
DATABASE_URL=postgresql://app_login:${{project.APP_LOGIN_PASSWORD}}@postgres:5432/aqua
BETTER_AUTH_SECRET=${{project.BETTER_AUTH_SECRET}}
BETTER_AUTH_URL=https://<base>
PARENT_LINK_SECRET=${{project.PARENT_LINK_SECRET}
NODE_ENV=production
DEMO_MODE=false
OFFLINE_SYNC_ENABLED=
```

`DATABASE_URL` uses Dokploy's internal Postgres hostname
(`postgres` — the Dokploy-generated service name on the project
network).

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
migrate step runs `bootstrapRoles` (creates `app_user`/`app_login`),
runs migrations, then `grantAppUserOnPgBossSchema` to wire the
worker up. **All three of these need the privileged role** —
the app role has no CREATE on `pgboss.*`.

## Reference — Dockerfile

```
# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next build touches lib/env.ts at page-data-collection time — BOTH
# DATABASE_URL and MIGRATION_DATABASE_URL are required unconditionally
# by lib/env.ts's parser (MIGRATION_DATABASE_URL has its own
# non-production-bypass check); missing either fails the build
# with a misleading "Invalid environment configuration" error.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV MIGRATION_DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S aqua && adduser -S aqua -G aqua -u 1001

# Standalone Next.js server for web. Standalone output doesn't
# include public/ or .next/static — copy them in separately.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Full source + node_modules for the worker and the migration
# step (db/deploy.ts), which run via tsx directly rather than
# through Next's bundler.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/db ./db
COPY --from=build /app/lib ./lib
COPY --from=build /app/worker ./worker
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/package.json ./package.json

RUN chown -R aqua:aqua /app
USER aqua
EXPOSE 3000
CMD ["node", "server.js"]
```

`scripts/` is deliberately **not** in the runtime image — those
files are CLI utilities for the developer's machine and for
the migrate step, not for the web/worker.

## Reference — local Docker verification

`docker-compose.prod.yml` exists for this purpose only — its
header comment is explicit. Dokploy manages its own real secrets
per service in production; the compose file's credentials are
throwaway local values.

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps    # all three healthy
curl -s http://localhost:3000/api/health        # {"status":"ok"}
docker compose -f docker-compose.prod.yml logs --tail=20 worker
# [worker] started — listening on sessions.generate
docker compose -f docker-compose.prod.yml down -v
```

To exercise the worker end-to-end, insert one tenant + register
a pg-boss schedule directly (no `scripts/` in the image — local
test only). With one test tenant and a `*/1 * * * *` schedule,
the worker log shows `[sessions.generate] tenant <id>: 0 session(s) created`
within a minute.

## Reference — why this stack

### Why one Dokploy instance on one VPS, not separate

- Single pane of glass (Dokploy UI for backups, restarts, scaling).
- Internal network between apps and DB — the Postgres port is
  never exposed to the internet. Dokploy's database feature
  creates a private service on the project network; only the
  three Applications on the same project can connect.
- Backups via Dokploy's built-in S3 destination (off-server
  storage).
- Restore testing is straightforward (Path A above).

### Why Dokploy-managed Postgres, not external managed

A managed Postgres (Neon, Supabase, RDS) is the right call when
the SLA justifies the operational overhead. For the pilot and
the first production cut, single-VPS Dokploy-managed Postgres is
the right trade: same Dokploy UI for everything, same network,
no cross-provider auth.

### Why the worker is its own Application, not a sidecar

pg-boss holds the queue lock; web and worker can scale
independently. The worker is stateless — restart it, all
schedules resume. Two workers is unsafe (see **Go-live check
#4**); for horizontal scale later, partition the queue by
tenant-id prefix.

### Why the platform lives on its own subdomain

See [PR #104 description](#) for the security reasoning. Short
form: the platform uses TOTP-based auth with its own
`platform_session` cookie and never touches better-auth. Putting
it on `ops.<base>` narrows the cookie's reach (browsers scope
`Set-Cookie` without `Domain=` to the exact host that set it)
and makes the platform-vs-tenant boundary something the routing
layer enforces, not just the layout auth gates.

## Future work

### B — per-tenant subdomains (`<slug>.<base>`)

The next routing change after A. Each tenant gets its own URL
(`aquaworli.aqua.soloengine.in`); the home resolver scopes to
the current subdomain's tenant; the same better-auth session
works across subdomains because the cookie is host-scoped, not
`Domain=`-scoped.

**Blocked on:** Cloudflare-in-front for wildcard TLS. Dokploy's
[certs page](https://docs.dokploy.com/docs/core/certificates) only
describes manual cert paste + `traefik.me` (30-day self-signed).
Neither scales to wildcard `*.aqua.soloengine.in`. The
[DNS providers page](https://docs.dokploy.com/docs/core/dns-providers)
lets Dokploy create A/CNAME records via Cloudflare's API but
doesn't issue DNS-01 ACME challenges through that integration.
**Cloudflare in front** (the production SaaS pattern anyway)
handles the wildcard cert + renewal + HSTS at the edge, Dokploy
sees HTTPS at the origin.

**Why this is hard, not just expensive: Let's Encrypt
rate-limits.** HTTP-01 works for one hostname per cert; wildcard
requires DNS-01. Even setting DNS-01 aside, LE rate limits
**50 certificates per registered domain per week** and
**5 duplicate certificates per week**. A per-tenant cert strategy
(one cert per `<slug>.<base>`) hits these limits at ~50 new
tenants per week, which is the operator's realistic onboarding
cadence. SAN certificates cap at 100 names per cert. **Don't
try to scale past a few tenants without DNS-01 or a wildcard
CA — the rate limit will surface as "your cert couldn't be
issued" at the worst possible moment, not a soft warning.** The
Dokploy UI will keep accepting new domains and let you assign
HTTPS — the cert issuance just fails silently.

**Size estimate:** 4-5 working days. New `middleware.ts` extension
that extracts the subdomain and looks up `tenants.slug` (one DB
query, indexed on `slug`); new `requireTenantCtx()` to replace
`requireDefaultCtx()` on tenant-side layouts (8 layout files);
home resolver scoping; e2e scripts updated; demo runbook
rewrite; the middleware boundary test extended with `<slug>.<base>`
probes. The auth model itself doesn't change — better-auth's
session is already tenant-agnostic (it carries `user_id` only);
`resolveCtxFor` already takes a slug.

**Open questions before starting B:**

1. **Slug format.** Today slugs are free-form (`demo-academy`,
   `kicks-academy`). Subdomains need to be lowercase + valid
   per RFC 1035 (no underscores, ≤ 63 chars per label). Add a
   validation step to `createTenant` or to the seed.
2. **Multi-tenant users.** A user with memberships in multiple
   tenants logs in to whichever subdomain they typed. The home
   resolver scopes to that subdomain's tenant. Is this the
   intended UX? (I think yes — the alternative is a "which
   club?" picker, which is more friction for the common case
   of one role at one club.)
3. **Cookie on apex.** After B, the apex `<base>` still hosts
   `/login` (the tenant picker). The better-auth cookie set at
   apex is host-scoped — a user who logs in at apex and
   navigates to `aquaworli.<base>` won't carry their session.
   Fix: redirect apex `/login` to a tenant URL, OR set the
   better-auth cookie with `Domain=.<base>` at apex (the
   alternative is a separate login per subdomain).

### CI image build

Add `docker build` + GHCR push to `.github/workflows/ci.yml` as
a new job that runs on push to `main` and on tags. Image
builds today: ~2 minutes (the existing `pnpm build` is the
dominant cost; `pnpm install --frozen-lockfile` adds another
minute on cold cache). Tag every image with `sha-<short>` and
`latest`. Webhook Dokploy to deploy on `latest` change.

### Per-tenant feature toggles UI for expiry

`/ops/tenants/[tenantId]/tenant-feature-toggles.tsx` shows
"Override expires {date}" but the input to set the expiry is
not exposed. Tracked under 1.8 in
`docs/five-day-work-guide.md`. Doesn't block pilot; flag for the
post-pilot hardening pass.

### Audit-log retention

`platform_audit_log` and (planned) tenant-side `audit_log` have
no retention policy. Long-running tenants accumulate rows
indefinitely. Add a partitioning or rotation policy before
the 12-month mark on the first paying tenant.
