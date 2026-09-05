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

## H1 · Pre-hydration form submit leaks credentials

### Bug

`app/(platform)/platform/login/login-form.tsx` ships as
`<form onSubmit={onSubmit}>` with no `method` attribute. The
React handler calls `e.preventDefault()` then invokes the
server action via `startTransition`. **That handler only
fires after React has hydrated.** In Next.js dev, the first
compile of a route can take seconds; a click in that window
falls through to the browser's native form submission, which
defaults to `method="get"` against the current URL with form
fields appended as the query string.

I reproduced it directly: a Playwright click on
`/platform/login` before hydration submitted natively and the
URL became
`/platform/login?email=ops%40aqua.local&password=5WO0aX3ZWc4R0qL2`.
The password is now in:
- Browser history (until the user clears it).
- Server access logs (the URL is what gets logged).
- Any `Referer` header sent on a navigation away.
- Any monitoring/analytics tool that captures URLs.

This is a credential-exposure bug, not a demo annoyance.

It is also the third finding on this login form's path:
**F5** closed one as a headless artifact; **G5** fixed a
`startTransition` no-op; **H1** is the hydration race that
underneath both. Three is the "look for siblings" threshold.

### Inventory — every form in the platform surface

`grep -rn '<form' --include='*.tsx' app/` against the whole
tree finds **nine** platform forms with the same shape. None
of the tenant surfaces use `<form>` at all (they use
`<button type="button" onClick={...}>`); the issue is
platform-only.

| # | File | Form | What's at risk |
|---|---|---|---|
| 1 | `app/(platform)/platform/login/login-form.tsx` | platform login | **email + password** |
| 2 | `app/(platform)/platform/verify/verify-form.tsx` | TOTP verify | 6-digit TOTP code |
| 3 | `app/(platform)/platform/features/feature-catalogue.tsx` | feature edit | feature key + name + category |
| 4 | `app/(platform)/platform/presets/[key]/preset-detail-form.tsx` | preset apply | tenant id + preset key |
| 5 | `app/(platform)/platform/tenants/[tenantId]/remove-sample-data-button.tsx` | destructive | tenant id |
| 6 | `app/(platform)/platform/tenants/[tenantId]/tenant-feature-toggles.tsx` | feature toggle | tenant id + feature key + mode |
| 7 | `app/(platform)/platform/tenants/[tenantId]/invite-owner-form.tsx` | invite owner | **phone number** |
| 8 | `app/(platform)/platform/tenants/new/new-tenant-form.tsx` | create tenant | **name + slug + timezone + currency + GSTIN** |
| 9 | `app/(platform)/platform/tenants/[tenantId]/status-transitions.tsx` | suspend / churn | tenant id |

`components/login-form.tsx` (tenant phone login) does not
have this shape — it uses `fetch()` to
`/api/auth/phone-number/send-otp` with a JSON body, no native
form submit. Its pre-hydration failure mode is "button does
nothing," not "credentials in URL." Different bug, not in
scope here.

The platform layout's sign-out form is the one form that
already uses the safe pattern: `<form action={signOutFormAction}>`
— it works without JS. That's the pattern to converge on.

### Fix shape

Two layers. **Both** required; each alone leaves a hole.

**Layer 1 — `method="post"` on every form.**
Belt-and-suspenders: even if a future refactor breaks the
React handler, a native submit goes via POST and credentials
land in the body, not the URL. This is a one-line change per
form. Cheap, mechanical, captures the bug.

**Layer 2 — Next.js Server Action form-action pattern.**
`<form action={serverAction}>` where `serverAction` accepts
`FormData` directly. Works without JS — a pre-hydration
submit posts to the server action endpoint, the action runs
server-side, the browser follows the redirect. This is what
`signOutFormAction` already does.

Refactor required: each action (`loginPlatformAction`,
`verifyPlatformTotpAction`, etc.) currently takes
`input: unknown`. Change to `(formData: FormData)` and read
fields with `formData.get(...)`. Call sites inside the React
handler already build the same object via
`String(formData.get("email"))` etc., so the parsing moves
to the action and the React layer becomes a thin wrapper that
calls `action(formData)` from `useTransition`. The Zod parse
moves into the action — that's already where it lives in the
existing code; the refactor is the signature change, not the
logic.

Each affected form's existing `e.preventDefault()` handler
is replaced by the server-action `action={fn}` attribute.
The button stays `type="submit"`, the input `name`
attributes stay the same (they're what `FormData.get()` keys
on). Mechanical, except for the action signature change.

### Test — proves the fix and the bug

`tests/tier1/platform-form-credential-leak.test.ts`. For each
of the nine forms:

1. Launch a Playwright context with
   `javaScriptEnabled: false`.
2. Visit the form's page. Fill it with sentinel values
   (e.g. `password = "LEAK_CANARY_xyzzy"`).
3. Click submit. Read `page.url` and `page.content()`.
4. **Assert `LEAK_CANARY_xyzzy` is not in `page.url`.** This
   fails today on the login form (the bug) and passes after
   the fix.
5. **Assert `LEAK_CANARY_xyzzy` is not in `page.content()`.**
   Catches accidental echo in error pages.
6. Bonus: assert the submit was a POST, not a GET, by
   inspecting the request method via `page.on("request")`.

The test runs against the dev build, so the hydration race
is reproducible — Next.js's first compile is slow enough
that `javaScriptEnabled: false` matches what a real user
gets in the cold window.

For tenant forms (which use `<button type="button">`) a
similar test asserts the click does nothing without JS, so
the absence of `<form>` is intentional and documented, not
an oversight.

### What's NOT in scope

- Renaming the action signature is. But re-doing the
  redirect logic is not — the server already redirects to
  `/platform/verify` on `needs_totp` and to `/platform` on
  `ok`; the FormData path keeps both.
- Login retry / rate limit logic is not. Lives in
  `platformLogin`, unchanged.
- The "warm up the platform login before sitting down"
  runbook rule is. With the fix it's no longer load-bearing;
  remove it.

### Why one PR

The fix is the same nine files in one shape plus one new
test file. Splitting across PRs would either (a) leave
credential-leaking forms open during the merge window or
(b) force reviewers to read the same refactor nine times.
One labelled PR (auth is in the protected-paths gate; the
F1 standing rule applies — `human-approved-merge` label,
human merges).

### Cost of doing nothing

The platform login form has now produced three findings.
Every other form on the list is structurally identical to
the one that just leaked. The next auditor who clicks
quickly enough to beat hydration has the password in their
terminal scrollback. We can either fix all nine at once or
chase each one as a separate incident.

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
