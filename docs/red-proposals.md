# RED proposals — Phase 3 (documents, impersonation)

Two Phase-3 RED items are unresolved. These proposals capture
the design options and ask for a sign-off before implementation.
While the human reviews, work continues on the GREEN Phase 3
items (staff directory, invitations, receptionist seed,
platform activity log) — none of which depend on either of
these choices.

---

## 3.1 · Documents — token scheme

### What's approved

Option B (app-issued proxy token) per
`docs/five-day-work-guide.md:113`. The proxy route shape:

```
GET /api/documents/[token]
```

streams from R2, never exposes an R2 URL. Tokens are issued by
the app, not by R2. Role-gating happens server-side. Every
access writes an audit row.

### Open question — pre-expiry revocation

A token has a short TTL by default. The remaining question:
**does the academy need to revoke a token before its TTL
expires?** The use cases:

| Use case | Revoke before TTL? |
|---|---|
| Guardian accidentally shares a fee-link on a WhatsApp group | Useful |
| Receptionist resigned; their phone still has links | Useful |
| Token issued for one-off view in 30s | Never |
| Routine session attendance photo | Never |

The naïve fix would be a denylist table
(`revoked_document_tokens(jti PK, revoked_at, reason,
revoked_by)`) checked on every render — one indexed lookup.

### Proposal — short TTL + denylist, both cheap

1. **TTL by purpose.** Default 15 minutes; `parent_view` /
   `guardian_view` / `data_export` style tokens use 7 days
   (matching C-44's magic-link rule). A purpose claim carries
   the lookup-time rules, the TTL is just an expiry.
2. **Issued tokens are signed JWTs**, claims:
   `tenant_id`, `document_id`, `person_id`, `purpose`, `exp`,
   `iat`, `jti`. Signed HS256 with a per-tenant signing key
   derived from a server-side secret. The verification path is
   symmetric between issuing service and proxy route.
3. **Denylist table** lives per tenant (RLS-scoped); each row
   is `jti`. The proxy route joins the denylist lookup into
   the same transaction that records the access audit — one
   indexed `WHERE jti = $1` lookup per request, with a soft
   eviction policy that GC's denylist entries older than their
   token's `exp` (so the table is bounded).
4. **Default revocation posture is "no"** — if the academy
   owner never revokes anything, the denylist stays empty, and
   the join is a no-op. The capability is unused but available.
5. **Children's documents** carry `purpose: 'minor_id'` or
   `purpose: 'minor_photo'` (per scope §7.1). The proxy route
   enforces an extra rule: a token with that purpose ALSO
   requires the request to carry a verified `viewer_user_id`
   claim bound to the same `person_id` as a parent on the
   child record, OR a staff session with `staff.documents.read`.
   Without that, no `minor_*` token renders. This is what
   makes "no unauthenticated URL resolves to a child's
   photograph" defensible (3.4's Done When).

### What's NOT in scope of this proposal

- The R2 SDK choice (3.2 notes "@aws-sdk/client-s3 needed —
  ask before adding") — orthogonal to the token scheme.
- The audit destination (architecture §8.10 audit_log table
  for tenant mutations is not yet built). The proxy writes
  are queued to land into that table once it ships.

### Cost of doing nothing while waiting

If the denylist is approved, the issuing service is `+1`
table, `+1` lookup per render. If it is rejected, the JWT
path is `+1` table (none) but rule 5 (children's documents)
gets stronger: issuance is one-shot, the URL is shown to the
requester exactly once, and re-issue requires the operator's
action.

The denylist path is the right default — it makes the system
behave correctly under operational mistakes without redesign.

---

## 3.8 · Support impersonation

### What's approved

Platform staff acting as a tenant user. The hard rules (per
`docs/five-day-work-guide.md:120`):

- Stated reason required.
- Fully audited.
- Persistent banner to the impersonating operator.
- Impossible to start from a tenant session.

### Proposal — operator role, dedicated pool, scoped
context, banner injection

1. **Role gate on initiation.** Only platform operators with
   `support.impersonate` (a new permission, proposed to be
   granted to the existing `admin` role by default)
   can initiate. The action is parse-then-permission with
   the reason as required input — the standing rule's
   preamble doesn't allow skipping the parse step.
2. **Two-layer context.** On initiation: open a dedicated
   Postgres session via the existing `withPlatformAdmin()`
   (already in db/scope.ts), hold the operator's
   `actor_id`. Stack an impersonation context: `withTenant()`
   on the chosen tenant, with the operator's id as the
   session's `app.user_id` AND a separate `app.impersonating`
   flag set. The flag is read by the layout/header to render
   the persistent banner.
3. **`app.impersonating` is read-only from a tenant surface.**
   The route shell checks the flag in layout.tsx and renders
   a banner with: the operator's display name, the tenant
   context they're impersonating, the time the session
   started, and a "Return to platform" link that closes the
   impersonation session. The banner is position-fixed and
   cannot be dismissed.
4. **Audit.** Every mutation made under impersonation writes
   to `platform_audit_log` with `detail: { impersonation:
   { reason, operator_id, tenant_id, started_at } }`. Reads
   that are themselves audited (V-33, V-33a) carry the same
   envelope. The impersonation entry itself is a
   `support.impersonate.start` / `support.impersonate.end`
   row pair.
5. **Tenant-side session blocks initiation.** The platform
   shape is unambiguous: the initiating request runs through
   a platform session, never a tenant session. The
   `platformAuthStatusAction` returned by the action confirms
   `kind: 'authenticated'` AND no tenant on the request. Any
   tenant cookie on the same request → 400, not silently
   permitted.
6. **Inactivity timeout.** If the operator doesn't make a
   request for 30 minutes, the impersonation session ends
   itself (a server-side TTL keyed to last activity). Forces
   the operator to re-confirm the reason before resuming.
7. **No impersonation of tenants with status `suspended` or
   `churned`.** Reading a suspended tenant is fine (platform
   admins already can), acting on its data under an
   impersonated identity would let an operator bypass the
   suspension. The list of tenants the operator CAN pick is
   filtered to `trial` and `active`.

### What's NOT in scope of this proposal

- Cross-tenant **read** impersonation — today the platform
  admin can read across tenants already (1.4). The
  impersonation here is for **acting**, not reading.
- A co-pilot / over-the-shoulder mode where the operator
  walks a tenant owner through a flow. That's a separate
  product feature, not impersonation.
- Audit destination for tenant-side mutations (architecture
  §8.10). The proposal says "every mutation writes" — the
  actual table is unbuilt, the proposal does not block on
  its existence (3.8's `app.impersonating` flag becomes the
  audit-shaped marker on the platform_audit_log row,
  sufficient for this task's done-when).

### Cost of doing nothing while waiting

Nothing in the GREEN Phase 3 work depends on 3.8 — staff
directory, invitations, receptionist seed, platform activity
log all build without impersonation. Picking up the
implementation later does not regress anything shipped.

---

## What to do next

Continue Phase 3 GREEN items:
- 3.5 Staff directory (build on the existing `staff` service)
- 3.6 Invitations (invite-by-phone, accept, revoke, resend)
- 3.7 Receptionist seed (the `assertStaff` permission fix
  was verified on the existing receptionist row already;
  add a permanent seed-path check so it never regresses)
- 3.9 Platform activity log (extend `recentActivity`)

These ship without waiting for the REDs above. The REDs
land as separate PRs once their proposals are signed off.
