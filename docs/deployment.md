# Deployment and recovery — current operator runbook

**Status:** tracked configuration is prepared for separate Dev and Production
VPSs. Neither a live R2 upload/restore nor a live Production deploy is
certified by this document. Do not mark `PILOT_RELEASE_GATE=passed` from
code or a dry run. Historical, superseded plans are in
[`deployment-legacy.md`](deployment-legacy.md); do not follow them.

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

1. Provision the **separate** VPS/Dokploy projects, TLS hosts `<base>`
   and `ops.<base>`, and a private GHCR registry credential with only
   `read:packages`. Verify `dokploy-network` exists on **each** target.
   Do not paste credentials into tracked files or CI logs.
2. Add the variables listed in `docker-compose.dokploy.env.example` or
   `docker-compose.production.env.example` to the corresponding Dokploy
   Compose Environment editor. Dokploy writes `.env` adjacent to its
   checkout. Required: Dev `AQUA_IMAGE_TAG` / Prod
   `AQUA_IMAGE_DIGEST=sha256:<64 hex>` resolved from the approved tag,
   URL-safe `POSTGRES_PASSWORD` and
   `APP_LOGIN_PASSWORD`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (HTTPS
   tenant host, not ops), `PARENT_LINK_SECRET`, all four `R2_*` values
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
   then `https://<base>/api/health` returns 200 with `worker: healthy`.
   Run host-boundary probes (`/login` only on tenant host, `/ops/login`
   only on ops host), check `Secure; HttpOnly; SameSite=Lax` cookies,
   and inspect the actual image digest. On redeploy, **verify** Dokploy
   recreates the one-shot migrate container; Compose `config --quiet`
   alone cannot prove how its UI handles a previously completed job.

Local configuration checks use **dummy values only**:

```sh
AQUA_IMAGE_TAG=sha-000000000000 POSTGRES_PASSWORD=ci-dummy-postgres \
APP_LOGIN_PASSWORD=ci-dummy-app BETTER_AUTH_SECRET=ci-dummy-auth \
BETTER_AUTH_URL=https://ci.invalid PARENT_LINK_SECRET=ci-dummy-parent \
R2_ACCOUNT_ID=ci-dummy-account R2_ACCESS_KEY_ID=ci-dummy-access \
R2_SECRET_ACCESS_KEY=ci-dummy-secret R2_BUCKET=ci-dummy-bucket \
AUDIT_CHECKPOINT_SECRET=ci-dummy-checkpoint \
docker compose -f docker-compose.dokploy.yml --profile backup config --quiet
# Validate Production with the digest of the exact approved tag (dummy here).
AQUA_IMAGE_DIGEST=sha256:0000000000000000000000000000000000000000000000000000000000000000 \
POSTGRES_PASSWORD=ci-dummy-postgres APP_LOGIN_PASSWORD=ci-dummy-app \
BETTER_AUTH_SECRET=ci-dummy-auth BETTER_AUTH_URL=https://ci.invalid \
PARENT_LINK_SECRET=ci-dummy-parent R2_ACCOUNT_ID=ci-dummy-account \
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
host, ops at `ops.<base>`; it does not resolve tenant subdomains.
Wildcard TLS, cookie scope and tenant slug validation need a separate
design and proof before enabling `<slug>.<base>` routing.
