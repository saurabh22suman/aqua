# Pilot operations runbook — audit review, monitoring and recovery

Created as the practical M04/M06 deliverable for the 2026-10-09 role/content/
permission audit. This is an operator runbook, not a console: it describes the
minimum human procedure for reviewing sensitive business changes, watching the
worker, and owning backup/restore. It deliberately does not promise a GUI that
does not exist yet.

## 1. Owner business-audit review (M04)

Sensitive tenant mutations write `audit_log` rows in the same transaction as
the mutation. Until the Owner business-audit viewer ships, review with the
tenant's read-only tooling (SQL client, BI export or the Ops audit support
path). Always scope by tenant and keep the output private.

```sql
-- Last 50 sensitive financial/identity events for one tenant.
select created_at, actor_id, action, entity_type, entity_id,
       before, after
from audit_log
where tenant_id = :tenant_id
  and action in (
    'invoice.void', 'payment.record', 'payment.reverse',
    'member.transfer', 'session.cancel.notification',
    'owner.reset_link_issued', 'staff.login_link_issued'
  )
order by created_at desc
limit 50;
```

Rules:
- Review at least weekly during the pilot, and on any cash variance or
  disputed correction.
- `after` payloads never contain tokens or credentials by contract; if you
  ever see a token there, stop and report it as a security incident.
- The Ops tenant Audit tab shows **platform** events; it is not the tenant's
  business log. Use the query above for tenant business changes.
- Historical staff-correction changes are Owner/Admin-only in the app; the
  audit row carries the reason and (where changed) before/after times.

## 2. Worker and outbox monitoring (M06)

- Health: `GET /api/health` returns coarse DB/worker status. The worker
  writes heartbeats (`worker_heartbeats`); a stale heartbeat means jobs are
  not draining.
- Queues: pg-boss owns the `pgboss` schema. Check failed/stuck jobs:

```sql
select name, state, count(*)
from pgboss.job
group by name, state
order by name, state;
```

- Notifications/outbox: queued messages live in `message_log` /
  notification outbox rows. The WhatsApp job stops retrying after 5 attempts;
  anything exhausted must be investigated by Ops (retry is a deliberate
  system action, not a Reception capability).
- Non-production transport is **mock/capture only**. Do not report a captured
  message as delivered. Real Ops authentication and tenant messaging require a
  supported transport decision (open item, §19.7 of the audit).
- Escalation: tenant Owner sees a service-impact message; Ops owns retry,
  monitoring and restore drills. No receptionist or coach holds worker
  credentials.

## 3. Backup and restore (M06, external)

The repo contains backup tooling and Compose configuration, but **no local
file proves offsite recoverability**. Before treating the pilot as
production-grade, complete and record:

1. Scheduled encrypted backup of Postgres + object storage (retention agreed).
2. Offsite upload verified (checksum recorded) — not just a local dump.
3. An isolated restore drill: restore exact backup bytes into a disposable
   database/instance, run `pnpm db:deploy`, verify counts and a sample parent
   link/receipt, and record the elapsed time and operator.
4. Keep the drill evidence (date, backup id, checksums, verifier) with the
   release checklist.

## 4. Known pilot boundaries

- Single-location pilot by product decision (2026-10-10); location guards are
  enforced in code, but multi-site acceptance is a pre-multi-site release task.
- Reception closes the day from `/reception/close` (current day, its sites);
  only Owner/Admin reopen a closed count with a reason.
- Accountant signs in to `/owner/fees` (finance-shaped navigation); no
  medical/guardian/consent or operational mutations.
- Human Worker (`/worker`) has self-service only: own shifts, check-in, leave.
- Parent `/p/[token]` is read-only and zero-JavaScript; venue + academy help
  line are shown with the next session.
