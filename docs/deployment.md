# Deployment — Aqua on Dokploy

**Read this top-down on the first deploy.** The first section is
the step-by-step procedure for going live; the sections after it
are reference material — read them when a step needs detail, not
before.

## What ships

One Dokploy instance on one VPS. **Dev ships as a single Docker Compose
service** (`docker-compose.dokploy.yml`: `db`, `migrate`, `web`, exactly
one `worker`) pulling the immutable GHCR tag; the per-Application layout
further down is the original plan, retained as reference for the eventual
production cut (still blocked by the release gate). In both shapes the
migration step is a one-shot process holding the privileged
`MIGRATION_DATABASE_URL` connection — **never** from the web/worker
containers at boot.
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

## Dev deployment — Dokploy Docker Compose (approved 2026-09-23)

Dev runs as **one Dokploy Docker Compose service** in project
`aqua-dev`, built from the tracked `docker-compose.dokploy.yml`:
`db` (postgres:16), `migrate` (one-shot), `web`, and exactly one
`worker`. The image is the immutable GHCR tag published by
`publish.yml` (`ghcr.io/saurabh22suman/aqua:sha-<12>`) — nothing is
built on the VPS. Traefik is the one Dokploy already runs: no Caddy,
no host port 3000, `web` is reached over `dokploy-network` via
`expose`.

The SSH `deploy-dev` workflow is **inactive**: its job is gated on the
repository variable `DEV_DEPLOY_ENABLED == 'true'`, which is unset, so
every `publish`-completed trigger is skipped instead of failing. Do
not enable it while this Compose service owns the stack — SSH compose
and Dokploy compose would double-manage the same containers. Dokploy's
own Deploy (UI or deploy webhook/API) is the trigger.

### Setup (once)

**1. Pre-flight.** Generate the secrets (§0c), pick the Dev base
domain, point two DNS A records at the Dev VPS (`<DEV_BASE>` and
`ops.<DEV_BASE>`), and create a GHCR PAT with `read:packages`. On the
VPS, `docker login ghcr.io -u <user> --password-stdin` so a compose
pull works even outside Dokploy's registry path.

**2. Create the service.** Dokploy → Create Project `aqua-dev` →
Create Service → **Docker Compose**. Source: Git repo
`saurabh22suman/aqua`, branch `main`, **Compose Path**
`docker-compose.dokploy.yml`. Never paste a raw compose file — the
tracked file is the source of truth.

**3. Environment.** Environment tab → add every name from
`docker-compose.dokploy.env.example` (placeholders only in the repo):
`AQUA_IMAGE_TAG`, `POSTGRES_PASSWORD`, `APP_LOGIN_PASSWORD`,
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `PARENT_LINK_SECRET`. Rules:
`APP_LOGIN_PASSWORD` equals the password embedded in the
`DATABASE_URL` references; `BETTER_AUTH_URL=https://<DEV_BASE>` (the
apex, not ops); `AQUA_IMAGE_TAG` is `sha-<12>`, never `latest`.
Dokploy writes these to the `.env` next to the compose file; Compose
does not inject them into containers automatically, which is why the
file references each one explicitly with `${VAR:?}`.

**4. Registry.** Settings → Registry → add `ghcr` (Type Docker Hub,
URL `https://ghcr.io`, username, PAT). Click Test.

**5. Domains.** Compose service → Domains tab → Add Domain → service
`web`, container port `3000`, hosts `<DEV_BASE>` and `ops.<DEV_BASE>`,
HTTPS on, Let's Encrypt. Dokploy injects the Traefik labels at deploy
time. A domain change needs a redeploy (Compose labels, no hot
reload). No port is published on the host: the domain's container
port is internal routing only.

**6. Deploy.** Press Deploy. Order is enforced by `depends_on`:

1. `db` healthy (`pg_isready`);
2. `migrate` runs `db/deploy.ts` and exits 0 — bootstrapRoles →
   runMigrations (advisory-locked, forward-only) → pg-boss schema,
   queues and per-tenant schedules → `app_user` grants;
3. `web` and `worker` start in parallel.

If migrate exits non-zero, web/worker do not start. Fix forward with a
new migration; never edit an applied one. On any redeploy the stack is
force-recreated and migrate re-runs — every step is idempotent.

**7. Worker scale stays 1.** Do not add `deploy.replicas`, `scale`, or
Swarm mode. pg-boss locks each job to a single consumer; two workers
double-process silently.

### Health verification

- `curl -fsS https://<DEV_BASE>/api/health` → 200
  `{"status":"ok","worker":"healthy"}`; same on `ops.<DEV_BASE>`
  (`/api/health` is allowlisted on both hosts).
- Worker logs `[worker] started — listening on …`; the heartbeat beats
  every 15s and is stale at 45s (`lib/health/worker-heartbeat.ts`). In
  production a missing worker is a 503, so the web healthcheck gates
  the deploy on the worker too.
- Migrate logs `Roles bootstrapped: app_user (nologin), app_login
  (login, noinherit).` and `deploy migration complete. N tenant(s)
  scheduled.`
- Tag check: `docker inspect --format '{{.Config.Image}}'
  <web-container>` ends in the `AQUA_IMAGE_TAG` value.
- Host boundary: the four-curl matrix in §11b below.

### Backups — status: NOT claimed ready

Verified in the `feat/deploy-dokploy-compose` PR (2026-09-23):

- The `postgres:16` container ships `pg_dump`.
  `docker exec <db-container> pg_dump --format=custom --no-owner
  --no-privileges -U aqua aqua > /tmp/aqua-dev.dump` produced a valid
  custom-format archive (PGDMP header, 0.79 MB locally).
- `pnpm db:backup --from-file /tmp/aqua-dev.dump --dry-run` accepted
  it and named it `db-backups/<UTC>.dump`.

Gaps, stated plainly:

- The runtime image deliberately does not copy `scripts/` (see the
  Dockerfile), so `pnpm db:backup` cannot run inside web/worker/migrate
  containers, and those containers carry no `pg_dump`. A real upload
  must run from a repo checkout with `R2_*` exported, using
  `--from-file` on a dump pulled from the VPS.
- The R2 upload/retention path is **not tested**: the live round-trip
  in `tests/db/db-backup.test.ts` skips without credentials, and no
  live Dev backup has been run. Do not treat backups as ready until
  (1) `R2_*` are set, (2) that test's live case runs, and (3) one real
  dump is uploaded and restored into a throwaway Postgres (Path A in
  §Backups).
- `R2_*` and `AUDIT_CHECKPOINT_SECRET` are not wired into the Compose
  services yet (parity with `docker-compose.prod.yml`). The worker's
  scheduled `audit.checkpoint` and `activity.export` jobs need all four
  `R2_*` plus the secret and fail loudly without them. Decide before
  relying on those jobs.
- A tracked host-side backup script + cron/timer is still to be added.
  Dokploy Volume Backups on `aqua-pgdata-dev` is a secondary snapshot
  (a live `pgdata` copy; stop the stack for a consistent restore), not
  a substitute for a logical dump.

### Rollback

Set `AQUA_IMAGE_TAG` back to the previous immutable tag (for example
`sha-290cbfdf8773`) and Deploy. Compose recreates the stack, migrate
re-runs idempotently, and the web healthcheck (worker heartbeat
included) decides whether the rollback stands. The database has no
down-migrations: take a logical backup before a deploy that carries
migrations and restore only as a last resort. Never touch
`deploy-prod` or `PILOT_RELEASE_GATE` for this.

### Local validation

`AQUA_IMAGE_TAG=sha-000000000000 POSTGRES_PASSWORD=… APP_LOGIN_PASSWORD=…
BETTER_AUTH_SECRET=… BETTER_AUTH_URL=https://ci.invalid
PARENT_LINK_SECRET=… docker compose -f docker-compose.dokploy.yml config
--quiet` validates interpolation. CI runs the same with dummy values,
plus `pnpm check:dokploy-compose` for the invariants (immutable tag, no
build/latest/ports/replicas, one worker, one-shot migrate, migration
dependency, persistent volume, network wiring).

> **The per-Application procedure below is superseded for Dev
> (2026-09-23).** It is retained as reference for the eventual
> production cut, which remains blocked by the PR3 release gate.

## First deploy — step-by-step procedure

For the first deploy only. Re-running for fixes is just steps
**6** and **9** below; the rest is one-time.

### 0. Pre-flight — DNS, secrets, registry

**0a.** Decide on a base domain. The demo uses
`aqua.soloengine.in` (operator decides the real domain).

**0b.** Pick a DNS provider. This procedure assumes Cloudflare
for two reasons: (1) the apex A record + `ops.<base>` A record
both point at the VPS IP; (2) if/when per-tenant subdomains (B)
land, Cloudflare handles the wildcard TLS at the edge (Dokploy
itself doesn't have a documented DNS-01 wildcard path —
[certificates docs](https://docs.dokploy.com/docs/core/certificates)
only describe manual cert paste and `traefik.me`). Cloudflare
account, zone for the base domain, and the two A records all
needed before step 1.

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

### 9. Auto-deploy — Dev deferred, production gated

Two workflows, three files (PR1-C12), with the Dev flow superseded by
the Dokploy Compose path above:

- **`publish.yml`** — on a green `CI` run on `main`, builds exactly
  one image and pushes it as `ghcr.io/<repo>:sha-<12-char commit>`.
  No `latest`, no rebuild downstream. `pnpm check:deploy-workflows`
  enforces these rules in CI.
- **`deploy-dev.yml`** — the SSH path. Its job is gated on the
  repository variable `DEV_DEPLOY_ENABLED == 'true'` (deployment-only
  PR, 2026-09-23). The variable is unset, so a `publish` completion
  leaves the run **skipped, not failed**; no `DEV_*` secrets are
  needed. Do not enable it while the Dokploy Compose service owns the
  Dev stack (double-management). If it is ever enabled: it computes
  the tag from the publish run's commit, SSHes to the Dev VPS, pulls
  and starts that tag (the remote `deploy.sh` uses `IMAGE`/`TAG`),
  verifies `docker inspect aqua-web` matches the tag, then gates on
  `/api/health` (24 × 5s).
- **`deploy-prod.yml`** — `workflow_dispatch` only. A human passes the
  immutable `sha-<short>` tag; anything else (a branch name, `latest`)
  is refused. It runs behind the GitHub **production** environment
  approval and refuses to start until the repository variable
  `PILOT_RELEASE_GATE=passed` is set — which happens only after the
  complete PR3 release gate in `docs/pilot-release-checklist.md` is
  checked. **Never trigger it before that.**

GitHub setup:
- Environments: `development` (Dev secrets, inert until
  `DEV_DEPLOY_ENABLED=true`) and `production` (Prod secrets + required
  reviewers).
- Per environment: `*_SSH_KEY`, `*_HOST`, `*_USER`, `*_APP_DIR`,
  `*_HEALTH_URL` (`DEV_*` / `PROD_*`).
- Repository variables: `PILOT_RELEASE_GATE` (unset until PR3) and
  `DEV_DEPLOY_ENABLED` (unset by design).
- Each VPS app dir carries `deploy.sh`: docker login GHCR with
  `REGISTRY_USER`/`REGISTRY_TOKEN`, then
  `IMAGE=$IMAGE TAG=$TAG docker compose -f docker-compose.prod.yml up -d`.

Rollback: Dev — set `AQUA_IMAGE_TAG` back and Deploy the Compose
service. Production — dispatch `deploy-prod.yml` with an older tag; the
health gate decides whether it stands.

The older Dokploy-webhook auto-deploy idea is superseded by the
immutable-tag flow; do not wire both. The SSH flow is likewise
superseded for Dev by the Compose service (above).

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

### Script-driven backups (`pnpm db:backup`)

The repo ships a second, provider-independent path used by the
VPS deploy workflow and by hand. It dumps custom-format, refuses
an empty/non-archive dump, uploads to R2 under `db-backups/` and
prunes older backups beyond `--retain` (default 7).

```bash
# On a host with the PostgreSQL 16 client:
pnpm db:backup --retain 7
# Without pg_dump on the host (uses the database container's client):
docker exec aqua-db pg_dump --format=custom --no-owner --no-privileges \
  -U aqua aqua > /tmp/aqua.dump
pnpm db:backup --from-file /tmp/aqua.dump --retain 7
```

Requires `MIGRATION_DATABASE_URL` (privileged connection, CLI
only) and all four `R2_*` variables. A run that cannot upload
exits non-zero rather than silently no-op-ing. Suggested cadence:
nightly via cron/systemd timer on the database host, plus one
manual run before any risky migration.

**Restore from a script-driven backup** (the drill below is the
same sequence):

```bash
docker run -d --name restore-target -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:16
# wait for healthy
docker exec restore-target createdb -U postgres aqua
# roles first — policies and grants in the dump reference app_user/app_login
pnpm exec tsx -e "import('./db/bootstrap-roles').then(m => m.bootstrapRoles('postgresql://postgres:test@localhost:5433/aqua', 'restore-pw'))"
aws s3 cp s3://<bucket>/db-backups/<latest>.dump /tmp/backup.dump
pg_restore -h localhost -p 5433 -U postgres -d aqua --no-owner --no-privileges /tmp/backup.dump
psql -h localhost -p 5433 -U postgres -d aqua -c "select count(*) from tenants; select count(*) from members;"
```

Bootstrap roles **before** `pg_restore`; restoring first produces
53 `role "app_user" does not exist` errors on `CREATE POLICY`
(the data still lands, but the policies don't). A clean run has
zero errors.

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

`/api/health` also requires a fresh worker heartbeat (PR1-C8):
web returns 503 when the worker has not beaten for 45s, and in
production a worker that never started is a 503 too. Start the
worker alongside web (the compose file already does) and keep
the retry budget (5 × 10s) longer than the 15s heartbeat
interval; a web-only deploy that never starts the worker will
now fail its health check instead of silently missing every
nightly job.

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

`docker-compose.prod.yml` is both the local verification setup and
the Dokploy Compose deployment. Every secret is required
(`${VAR:?}`) — `POSTGRES_PASSWORD`, `APP_LOGIN_PASSWORD`,
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `PARENT_LINK_SECRET`.
Export them or put them in the repo-root `.env` (Compose
auto-loads it) before `docker compose up`; a missing one refuses
the start instead of falling back to a placeholder.
`pnpm check:compose-secrets` enforces this in CI. The compose file
never carries real secrets (`.env` is git-ignored).

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps    # all three healthy
curl -s http://localhost:3000/api/health        # {"status":"ok","worker":"healthy"}
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
