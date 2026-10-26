# Deployment and recovery — current operator runbook

**Status:** tracked configuration is prepared for separate Dev and
Production VPSs, and a **staging** deployment unit is prepared but **not
deployed**. Neither a live R2 upload/restore nor a live Production
deploy is certified by this document. Do not mark `PILOT_RELEASE_GATE=passed`
from code or a dry run. Historical, superseded plans are in
[`deployment-legacy.md`](archive/deployment-legacy.md); do not follow them.

## Hosts

The tenant surface and the platform (ops) surface are **sibling hosts**,
not a host and its subdomain:

| Surface | Host | Serves |
|---|---|---|
| Tenant apex | `aqua.preprabbit.in` | `/login`, `/owner`, `/coach`, `/reception`, `/worker`, `/parent`, `/p/*`, `/check-in/*`, `/api/auth/*` |
| Platform (ops) | `aquaops.preprabbit.in` | `/ops/*` only — every other path 404s |
| WhatsApp mock (capture) | `wa.preprabbit.in` | The hosted mock the app POSTs Cloud-API-shaped messages to |

`BETTER_AUTH_URL` is the tenant apex (`https://aqua.preprabbit.in`).
`OPS_HOST` names the platform host (`aquaops.preprabbit.in`). The
platform host is **not** a subdomain of the apex any more, so the app
cannot infer it: `OPS_HOST` is a required variable in both tracked
Compose files, and the routing layer (`middleware.ts`) treats that host
as the platform surface. The legacy `ops.<base>` shape is still
recognised as well, so an older deployment keeps working — the apex
host never gains `/ops` either way. Both hosts point at the same `web`
container; the host header decides which surface answers.

### Messaging

Release 1 has no real WhatsApp provider (the Cloud API adapter is
post-pilot work), so the hosted mock at `wa.preprabbit.in` is the only
working transport. The Compose files therefore default to
`WHATSAPP_PROVIDER=capture`, `AQUA_DEPLOYMENT_STAGE=preview` and
`WHATSAPP_CAPTURE_URL=https://wa.preprabbit.in`. The app POSTs to
`<WHATSAPP_CAPTURE_URL>/v23.0/<from>/messages`; the mock answers with
the Cloud API response shape.

The preview stage is what makes that honest: the layout shows a
"messages are captured, not delivered" banner on every page, and
`capture` is refused at boot without it. When a real provider lands, or
when the database holds real academy records, set
`WHATSAPP_PROVIDER=disabled` and `AQUA_DEPLOYMENT_STAGE=production` in
the Dokploy Environment editor. `disabled` means sends fail loudly
rather than pretending to deliver — including the ops WhatsApp
sign-in, which then needs the `OPS_EMAIL` + `OPS_PASSWORD` operator
door instead.

## Which deployment owns each VPS

| | Dev VPS | Production VPS |
|---|---|---|
| Manager | Dokploy **Docker Compose** service | Separate Dokploy **Docker Compose** service |
| Git source | `main`, `docker-compose.dokploy.yml` | `main`, `docker-compose.production.yml` |
| Project / volume | `aqua-dev` / `aqua-pgdata-dev` | `aqua-prod` / `aqua-pgdata-prod` |
| Trigger | Human presses Deploy in Dokploy | Human verifies release gate + Production environment approval, then presses Deploy in Dokploy |
| Image | `ghcr.io/saurabh22suman/aqua:sha-<12>` on all app services | GHCR **digest** of that published and Dev-verified tag (`AQUA_IMAGE_DIGEST=sha256:<64 hex>`); independent credentials and database |
| Routing | Existing Dokploy Traefik `dokploy-network` | Existing Traefik network on the Production VPS, confirmed by the operator |

Each project runs `db` → one-shot `migrate` → `web` and **one** `worker`.
The `backup` profile is dormant during normal deployment. Only web joins
the external Traefik network (`expose: 3000`, never `ports:`); neither
database nor worker has a public port. A second worker adds contention;
pg-boss locks concurrent claims but retries still require idempotent jobs.
The DB volume name is pinned per VPS. **Never mount a Dev volume on Prod.**

`docker-compose.local.yml` is an older *local-only* verification file. It
builds on the host and publishes 3000; it must not be selected as a Dokploy
source or production deployment file. The old SSH `deploy-dev` trigger is
inert while `DEV_DEPLOY_ENABLED` is unset and fails rather than deploying
if someone sets it. There is no VPS-only deploy script.

## Staging environment — prepared, NOT deployed

**Status: the staging environment is PREPARED; it is NOT deployed.** The
deployment unit exists in this repository as `docker-compose.staging.yml`,
with a placeholder environment (`docker-compose.staging.env.example`) and a
machine-checked isolation gate. On the host, the Dokploy **staging project
exists** with its public environment configuration saved, a **private R2
bucket** with a scoped token, the **HTTPS routes and DNS records** saved,
and a **mode-600 credential file** holding fresh staging secrets.

What is NOT true, and must not be claimed:

- **No staging deploy has been run.** Staging autodeploy is disabled, and
  no deployment has been started.
- **No staging endpoint is live.** The routes are saved but not applied
  until a deploy, and the **TLS certificates are not verified**.
- **No staging database exists.** Nothing has been deployed, so nothing has
  been migrated or seeded. No database was reset.
- **The staging secrets are not yet in Dokploy.** They sit in a mode-600
  file on the host for the human to paste into the Dokploy Environment
  editor. They are not in this repository and are never printed here.
- **Production is untouched.** The production project, environment and
  compose file are unchanged, and its autodeploy is unchanged.

The coordinator's own record of this setup, with the project IDs and the
credential-file path, is `docs/handoffs/dokploy-staging-setup.md` in the
ui-system lane. **Do not follow the older, incomplete notes in that file**;
its "Follow-up setup" section supersedes them.

| | Dev | Staging | Production |
|---|---|---|---|
| Manager | Dokploy **Docker Compose** service | Dokploy **Docker Compose** service (project exists; autodeploy off) | Separate Dokploy **Docker Compose** service |
| Git source | `main`, `docker-compose.dokploy.yml` | `main`, `docker-compose.staging.yml` | `main`, `docker-compose.production.yml` |
| Project / volume | `aqua-dev` / `aqua-pgdata-dev` | `sportsip-staging` / `sportsip-staging-pgdata` | `aqua-prod` / `aqua-pgdata-prod` |
| Internal network | `aqua-dev-internal` | `sportsip-staging-internal` | `aqua-prod-internal` |
| Hosts | `aqua.preprabbit.in`, `aquaops.preprabbit.in` | `sportsip-staging.preprabbit.in`, `sportsip-staging-ops.preprabbit.in` (routes saved, not applied) | the production hosts |
| Image | `ghcr.io/saurabh22suman/aqua:sha-<12>` | the **same** published `sha-<12>` tag as Dev | GHCR **digest** of the approved tag (`AQUA_IMAGE_DIGEST=sha256:<64 hex>`) |
| Object store | the Dev bucket | a **private** staging bucket with a token scoped to that bucket only | the production bucket, unchanged |
| Data | the Dev database | **none yet** — the database is created by the first deploy | the Production database |

### Unique resources — the reason this unit exists

Two Compose projects on one Docker host share everything Docker namespaces
by **name**. Get one name wrong and a staging preview writes into the Dev
pilot's database. The staging unit therefore pins three names of its own:

- project `sportsip-staging`
- database volume `sportsip-staging-pgdata`
- internal network `sportsip-staging-internal`

**Never** `aqua-pgdata-dev`, `aqua-dev-internal`, `aqua-pgdata-prod`,
`aqua-prod-internal`, `aqua-pgdata-local` or `aqua-pgdata`. The only
resource it shares with the other units on purpose is Dokploy's external
`dokploy-network`, which every unit joins so Traefik can route to `web`.

The gate that enforces this is `scripts/check-staging-compose.ts` (see
below). It is a pure source parse: no container, no image, no database, no
network.

```sh
# The staging isolation gate. Exits non-zero and names every violation.
pnpm tsx scripts/check-staging-compose.ts
# Expect: Staging compose check passed (docker-compose.staging.yml).

# The same gate against the shared required-secrets contract.
pnpm check:compose-secrets docker-compose.staging.yml
```

### Mocked providers, and the one explicit capture origin

Staging runs with `WHATSAPP_PROVIDER=capture` and
`AQUA_DEPLOYMENT_STAGE=preview`: messages are captured by a mock that
speaks the WhatsApp Cloud API shape and **never delivered to a real
person**, and the preview stage makes the deployment say so on every page.
No paid provider is involved.

`WHATSAPP_CAPTURE_URL` is **required** in the staging compose file — it
has no default, precisely so a staging deployment cannot capture into
another environment's mock inbox by accident. Set it explicitly:

- Prefer a dedicated staging capture origin.
- The approved existing mock (`https://wa.preprabbit.in`) may be reused for
  the **synthetic demo only** — the Splash Sports Club data, where every
  name, phone and amount is invented. Do not leave it pointed there once
  the staging database holds a real academy's records.

### Manual secret provisioning

Secrets are **provisioned by hand in the Dokploy Environment editor** and
never committed. `docker-compose.staging.env.example` lists every variable
with a `<placeholder>` and no real value; the human copies the names into
the staging service's Environment editor and replaces each placeholder
there. Dokploy writes its own `.env` next to its checkout on the VPS.

**The staging secrets already exist, held off to the side.** A mode-600
file on the host carries fresh staging values for the database password,
the app-login password, the auth/parent/audit secrets and the ops
password; the object-store entries are separate. Nothing in that file is
in this repository, and no value is printed here. The human still has to
paste them into Dokploy — that step has not happened, and until it does
the deploy refuses to render.

Every value in the compose file is `${VAR:?message}`, so a missing secret
refuses the deploy instead of starting on a placeholder. The staging
values must **differ** from the Dev values:

- `POSTGRES_PASSWORD`, `APP_LOGIN_PASSWORD` — a different database.
- `BETTER_AUTH_SECRET`, `PARENT_LINK_SECRET`, `AUDIT_CHECKPOINT_SECRET` —
  a shared auth secret would let a staging session be replayed against a
  Dev host.
- `R2_*` — the staging bucket is private and its token is scoped to that
  bucket only; reusing the Dev bucket would put staging exports beside
  Dev's.

The two hosts are siblings, not subdomains: `BETTER_AUTH_URL` is the
staging apex and `OPS_HOST` is the staging ops host. `OPS_EMAIL` and
`OPS_PASSWORD` are the env operator door (both or neither, password ≥ 12
characters).

### Immutable image promotion

Staging runs the **same published build as Dev** — a staging preview of a
different image proves nothing, and a staging-only build would be a fork
that nobody promotes. Promotion is therefore:

1. A green `CI` run publishes one GHCR tag `sha-<first 12 of main commit>`.
   Record the commit, the registry digest and the CI run ID.
2. Set `AQUA_IMAGE_TAG` to that tag in the staging Dokploy environment and
   deploy. Never `:latest`; rollback is setting the previous tag back.
3. Compare the pulled image digest on staging with the published digest. A
   SHA-shaped **tag can still be re-pointed in a registry**, and
   `docker inspect` of `.Config.Image` confirms the tag only.

Production remains on the **digest** of the approved tag, and staging is
not a step on the Production release path.

### DNS, TLS and health verification

DNS and TLS for staging are **prepared**: the routes and the letsencrypt
settings are saved in Dokploy for
`sportsip-staging.preprabbit.in` and `sportsip-staging-ops.preprabbit.in`,
and both A records resolve to the VPS. What is missing is the **deploy**
that applies the routes, and the certificate verification that follows it.
The verification sequence, once the human has entered the secrets and
pressed Deploy, is:

1. **TLS hosts** for the staging apex and the staging ops host, and a
   `dokploy-network` that exists on the target. Do not paste credentials
   into tracked files or CI logs.
2. **Dokploy Domains** route both staging hosts to **web**, internal
   container port 3000, HTTPS. No Caddy, no host port mapping — the
   staging unit publishes no port at all.
3. **Render check before deploying** (dummy values only, nothing starts):

   ```sh
   AQUA_IMAGE_TAG=sha-000000000000 POSTGRES_PASSWORD=ci-dummy-postgres \
   APP_LOGIN_PASSWORD=ci-dummy-app BETTER_AUTH_SECRET=ci-dummy-auth \
   BETTER_AUTH_URL=https://ci.invalid PARENT_LINK_SECRET=ci-dummy-parent \
   OPS_HOST=ci-dummy-ops-host OPS_EMAIL=ci-dummy@invalid \
   OPS_PASSWORD=ci-dummy-ops-password R2_ACCOUNT_ID=ci-dummy \
   R2_ACCESS_KEY_ID=ci-dummy R2_SECRET_ACCESS_KEY=ci-dummy \
   R2_BUCKET=ci-dummy-bucket AUDIT_CHECKPOINT_SECRET=ci-dummy-checkpoint \
   WHATSAPP_CAPTURE_URL=https://ci.invalid \
   docker compose -f docker-compose.staging.yml --profile backup config --quiet
   # Expect: no output and exit 0.
   ```

   `--profile backup` matters: the dormant profile is not rendered without
   it, so the check would skip the one service that holds the privileged
   connection.
4. **After the deploy** — the same probes the Dev unit uses, against the
   staging hosts: DB `pg_isready`, the migrate job exiting 0, web and
   worker starting, `https://<staging-apex>/api/health` returning 200 with
   `worker: healthy`, the bare-domain 307 probes (apex → its own door,
   ops host → `/ops/login`), `Secure; HttpOnly; SameSite=Lax` cookies, and
   the actual pulled image digest. On redeploy, **verify** Dokploy recreates
   the one-shot migrate container; `config --quiet` alone cannot prove how
   its UI handles a previously completed job.
5. **Backups** are the dormant `backup` profile. It holds the privileged
   connection because `pg_dump` needs a privileged role, and it is
   accepted **only** as a dormant, operator-run job — never a runtime
   service, and never a second worker. A staging timer, if one is
   installed, must point at `docker-compose.staging.yml` with its own
   paths-only environment file; nothing installs it for you.

### The synthetic demo on staging

The staging database starts **empty**. `SEED_SPLASH_CLUB=true` plus a
chosen `SEED_SPLASH_CLUB_PIN` seeds the synthetic club during the migrate
step — see [Synthetic demo club](#synthetic-demo-club-splash-sports-club). A
demo reset means re-seeding **this** database. It never means resetting
another environment's database.

## Image and release approval

1. A green `CI` run on `main` publishes one GHCR tag `sha-<first 12 of
   main commit>`. Record the commit, registry digest and CI run ID. A
   SHA-shaped **tag can still be re-pointed in a registry**: compare the
   actual pulled web/worker image digest with the published digest on
   both VPSs. `docker inspect` of `.Config.Image` confirms the tag only.
2. Deploy and verify that image on Dev first. Production is still blocked
   until the complete friend-pilot gate and real restore drill pass.
3. `deploy-prod.yml` is a **manual approval workflow, not a deployment**.
   `workflow_dispatch` validates exactly `sha-<12 lowercase hex>` and
   checks `PILOT_RELEASE_GATE=passed`. Its next job waits for GitHub's
   `production` environment approval and then prints the Dokploy handoff.
   The variable and environment/reviewers must be configured by a human;
   this code does not create or change them. A Dokploy UI click is not
   mechanically tied to this workflow: the operator must record its
   successful run ID before changing Production `AQUA_IMAGE_DIGEST`.

## Environment and first deploy (human steps)

1. Provision the **separate** VPS/Dokploy projects, TLS hosts
   `aqua.preprabbit.in` and `aquaops.preprabbit.in`, and a
   private GHCR registry credential with only `read:packages`. Verify
   `dokploy-network` exists on **each** target. Do not paste credentials
   into tracked files or CI logs.
2. Add the variables listed in `docker-compose.dokploy.env.example` or
   `docker-compose.production.env.example` to the corresponding Dokploy
   Compose Environment editor. Dokploy writes `.env` adjacent to its
   checkout. Required: Dev `AQUA_IMAGE_TAG` / Prod
   `AQUA_IMAGE_DIGEST=sha256:<64 hex>` resolved from the approved tag,
   URL-safe `POSTGRES_PASSWORD` and
   `APP_LOGIN_PASSWORD`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (HTTPS
   tenant host, not ops), `PARENT_LINK_SECRET`, `OPS_HOST` (bare
   hostname of the platform host — `aquaops.preprabbit.in` — no
   scheme, port or path), `OPS_EMAIL` + `OPS_PASSWORD` (the env
   operator door — both or neither, password ≥ 12 characters), all
   four `R2_*` values
   and `AUDIT_CHECKPOINT_SECRET`. Use **different** values/buckets per
   VPS. The backup profile also needs these values, but only it and
   `migrate` receive `MIGRATION_DATABASE_URL`; worker receives R2 and
   checkpoint settings, web does not. Missing variables fail Compose
   interpolation instead of scheduling failing jobs indefinitely.
3. Confirm in Dokploy that Domains route both hosts to **web**, internal
   container port 3000 with HTTPS. No Caddy, no host port mapping. Check
   registry authentication and the exact source file before clicking
   Deploy. No step in this document assumes that `docker compose config`
   can validate Dokploy-injected Traefik labels.
4. Deploy. Check DB `pg_isready`, migration exit 0, web and worker start,
   then `https://aqua.preprabbit.in/api/health` returns 200 with
   `worker: healthy`. Run host-boundary probes (`/login` only on the
   tenant host, `/ops/login` only on the platform host), check
   `Secure; HttpOnly; SameSite=Lax` cookies,
   and inspect the actual image digest. On redeploy, **verify** Dokploy
   recreates the one-shot migrate container; Compose `config --quiet`
   alone cannot prove how its UI handles a previously completed job.

### Synthetic demo club (Splash Sports Club)

A deployment starts with an empty database. That is right for a real
club and useless for a demo, so the deploy step can seed ONE synthetic
club:

| Variable | Meaning |
|---|---|
| `SEED_SPLASH_CLUB=true` | Seed the club during the `migrate` step |
| `SEED_SPLASH_CLUB_PIN=<6-12 digits>` | The PIN the seeded owner / coach / receptionist sign in with |

What it writes: the tenant **Splash Sports Club** on the `swimming`
preset (three swim programs, a four-lane pool facility), the location
**Splash Pool**, staff roles **owner**, **coach** and
**receptionist**, eight swimmers (three of them minors, with
guardians), the batch **Evening Squad** (Mon/Wed/Fri 18:00), a priced
**Monthly Swimming** plan (₹3,000, priced against the pool) and one
live subscription on it.

Everything about it is invented — names, phones, dates, amounts.

Notes:

- The PIN has **no default on purpose**. A fixed credential on a
  publicly reachable host is a credential everybody can use. The
  seeder refuses to run without a usable one, and the deploy step
  fails with that message.
- The flag is **not** `DEMO_MODE`: `DEMO_MODE` means "this process is
  a local demo" and the app refuses to SERVE in production with it set.
- The seeder is idempotent. Leave the flag true and every redeploy
  refreshes nothing and duplicates nothing. Flip it back to `false`
  once the demo is done — the seeded data stays.
- Only the `migrate` (one-shot) service receives these two variables;
  the web and worker containers never see them.

### The platform sign-in (env operator door)
`OPS_EMAIL` + `OPS_PASSWORD` are **required** in both tracked Compose
files, and they are what makes the platform sign-in work:

- With both set, `db/platform-auth.ts` routes the platform login to
  `db/platform-auth-env.ts`: the email and password are compared in
  constant time and the session is created fully authenticated — **no
  TOTP, no registered operator phone, no WhatsApp message**. The
  operator row is found-or-created on first sign-in.
- The email + password form is rendered on `/ops/login` whenever the
  pair is set. The WhatsApp door stays available alongside it for
  operators who have a registered phone.
- Both or neither: `lib/env.ts` refuses to boot when only one is set,
  and the password must be at least 12 characters.

Go-live check (from outside the VPS):

```sh
# The email + password form is on the page — and the form posts with
# method="post", so the password never reaches the query string.
curl -sS https://aquaops.preprabbit.in/ops/login | grep -c 'name="password"'
# Expect: 1
```

Then sign in at `https://aquaops.preprabbit.in/ops/login` with those
credentials and confirm `/ops` renders the overview.

### Bare-domain probes (both hosts)

The bare domain is an entry point: each host must answer `/` with a
**307** to its own door, and the redirect must stay on the host that
was asked for.

```sh
# Tenant apex -> the tenant door. Same host, /login.
curl -sS -o /dev/null -D - https://aqua.preprabbit.in/ \
  | grep -iE '^HTTP|^location'
# Expect: HTTP/2 307 and location: https://aqua.preprabbit.in/login

# Platform host -> the platform door. Same host, /ops.
curl -sS -o /dev/null -D - https://aquaops.preprabbit.in/ \
  | grep -iE '^HTTP|^location'
# Expect: HTTP/2 307 and location: https://aquaops.preprabbit.in/ops
```

A 404 on `/` means the deployed image predates the entry-point route.
A redirect to the **other** host's path means `OPS_HOST` does not
match the host Dokploy routes to `web` — the app would send the
tenant apex to `/ops`, which the routing layer then refuses. Fix
`OPS_HOST` and redeploy; do not work around it by routing the hosts
differently.

Local configuration checks use **dummy values only**:

```sh
AQUA_IMAGE_TAG=sha-000000000000 POSTGRES_PASSWORD=ci-dummy-postgres \
APP_LOGIN_PASSWORD=ci-dummy-app BETTER_AUTH_SECRET=ci-dummy-auth \
BETTER_AUTH_URL=https://ci.invalid PARENT_LINK_SECRET=ci-dummy-parent \
OPS_HOST=ci-dummy-ops-host \
R2_ACCOUNT_ID=ci-dummy-account R2_ACCESS_KEY_ID=ci-dummy-access \
R2_SECRET_ACCESS_KEY=ci-dummy-secret R2_BUCKET=ci-dummy-bucket \
AUDIT_CHECKPOINT_SECRET=ci-dummy-checkpoint \
docker compose -f docker-compose.dokploy.yml --profile backup config --quiet
# Validate Production with the digest of the exact approved tag (dummy here).
AQUA_IMAGE_DIGEST=sha256:0000000000000000000000000000000000000000000000000000000000000000 \
POSTGRES_PASSWORD=ci-dummy-postgres APP_LOGIN_PASSWORD=ci-dummy-app \
BETTER_AUTH_SECRET=ci-dummy-auth BETTER_AUTH_URL=https://ci.invalid \
PARENT_LINK_SECRET=ci-dummy-parent OPS_HOST=ci-dummy-ops-host \
R2_ACCOUNT_ID=ci-dummy-account \
R2_ACCESS_KEY_ID=ci-dummy-access R2_SECRET_ACCESS_KEY=ci-dummy-secret \
R2_BUCKET=ci-dummy-bucket AUDIT_CHECKPOINT_SECRET=ci-dummy-checkpoint \
docker compose -f docker-compose.production.yml --profile backup config --quiet
pnpm check:dokploy-compose && pnpm check:production-compose
```

## Backups and restore — NOT ready until a live round trip

Both tracked Compose projects include a **one-shot** `backup` profile
(`scripts/db-backup.ts`, PostgreSQL **16** `pg_dump` in the runtime
image). The 30 newest custom-format `db-backups/*.dump` objects are
retained; R2 upload must succeed before any older object is pruned.
`scripts/backup-compose.sh` refuses to start a stopped/unhealthy DB and
never starts it implicitly. Neither web nor worker has the privileged
database URL. No backup is scheduled merely by merging this code.
Dokploy may move its checkout on a redeploy: verify the timer's two
absolute paths again after any Dokploy project/source relocation.

On **each VPS**, the human must locate the actual Dokploy checkout and
its adjacent `.env`, then install the tracked timer and a local file
containing **paths only**, not secrets:

```sh
# On the Dev VPS; use the independent Production checkout on Prod.
# Check the paths first; Dokploy checkout paths vary by installation.
sudo install -d -m 700 /etc/aqua
# /etc/aqua/dev-backup.env (create as root, mode 600):
# AQUA_BACKUP_SCRIPT=/absolute/path/to/checkout/scripts/backup-compose.sh
# AQUA_COMPOSE_FILE=/absolute/path/to/checkout/docker-compose.dokploy.yml
sudo install -m 644 deploy/aqua-backup@.service /etc/systemd/system/
sudo install -m 644 deploy/aqua-backup@.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start aqua-backup@dev.service   # inspect real upload logs
sudo systemctl enable --now aqua-backup@dev.timer
sudo systemctl list-timers aqua-backup@dev.timer
```

On Production use `/etc/aqua/prod-backup.env`,
`docker-compose.production.yml` and `aqua-backup@prod.timer` on its
**different** VPS. The timer runs daily at **03:00 UTC**, with
`Persistent=true` to retry after a powered-off period. An upload error
fails the service; alert on timer/service failures and check new R2
objects daily. Dokploy volume snapshots are supplementary, not a
logical offsite backup.

**Human restore drill (separate throwaway PostgreSQL 16, never the live
volume):** obtain the actual uploaded custom-format dump from R2 and
verify its `PGDMP` header; bootstrap `app_user`/`app_login` roles on a
fresh target **before** `pg_restore --no-owner --no-privileges`; confirm
`pg_restore` exits with zero errors, row counts in tenants/members/
invoices/payments match the source snapshot, and every tenant table's
RLS is enabled and forced. Check grants/role attributes (`rolbypassrls`
must be false), host auth, and measure restore time. Test the live R2
round trip in `tests/db/db-backup.test.ts` using human-supplied test
credentials. A local `--dry-run`, fake object store or successful dump
into a local throwaway DB **does not** complete this gate. Do not put
real connection strings, keys, tokens or dump contents into the report.

Example verification SQL against the **throwaway** restored database:

```sql
-- Both queries must return no rows; then check row counts against
-- the source snapshot from before the backup was taken.
select rolname from pg_roles
where rolname in ('app_login', 'app_user') and rolbypassrls;

select c.relname from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
  -- Platform-wide audit rows may carry a tenant reference for filtering,
  -- but platform_audit_log is not a tenant-scoped table.
  and c.relname <> 'platform_audit_log'
  and exists (select 1 from pg_attribute a
              where a.attrelid = c.oid and a.attname = 'tenant_id'
                and not a.attisdropped)
  and (not c.relrowsecurity or not c.relforcerowsecurity);
```

## Rollback and outstanding verification

Restore the previous **published, verified tag** on Dev or the digest
of that tag in the Production Dokploy Compose environment, then redeploy;
verify the migrate job
completes, image digest matches, worker heartbeat returns, hosts work,
and critical money/attendance flows still load. There are **no down
migrations**. A code rollback does not reverse schema changes: rehearse
older-web/newer-schema compatibility and take a logical backup before
each schema-bearing promotion. Restore to an isolated target before
considering a full database replacement.

Before a friend pilot: Dev DNS/TLS/registry and one-worker checks,
role-specific walkthrough at owner **390×844 and 1280×900**, coach and
reception **390×844**, ops **1280×900**, parent zero-JS, real R2 upload
and restore, and a healthy nightly worker export/checkpoint. Production
additionally needs a separate VPS, Production environment reviewers,
`PILOT_RELEASE_GATE` after the entire human release checklist, and
explicit Dev-to-Prod image digest promotion. None is silently granted
by this PR.

## Per-tenant subdomains (future)

The current middleware serves tenant routes at the configured base
host, the platform surface at `OPS_HOST`; it does not resolve tenant
subdomains. Wildcard TLS, cookie scope and tenant slug validation need a separate
design and proof before enabling `<slug>.<base>` routing.
