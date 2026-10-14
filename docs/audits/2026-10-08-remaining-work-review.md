# Aqua: current codebase review and remaining work

**Remediation continuation:** this report retains the review-time evidence.
Current code changes, approved scope and verification are tracked in
[`../review-fixes-status.md`](../review-fixes-status.md).

**Reviewed:** 2026-10-08, local working tree on `feat/whatsapp-auth-notifications`,
HEAD `870cf1a`, including its uncommitted WhatsApp, frontend, tooling and
documentation changes. This describes this checkout, not remote `main`.

## Verdict

The core operational product and local WhatsApp demonstration are substantially
implemented. Real-data pilot readiness and Production readiness remain blocked
by concrete authorization, confidentiality, data-integrity and deployment gaps.
Completing the mock frontend did not close those broader release requirements.

Older plans are not a reliable completion percentage: several pending entries
are already implemented, while some completed entries have remaining tails.
The lists below distinguish defects, unfinished features and unverified gates.

## Review and verification

Reviewed plans/scope/design, routes/actions, auth, critical domain services,
tenant/location boundaries, migrations/grants, messaging/outbox/worker paths,
offline persistence, sampled UI components, tests and deployment workflows.
Earlier audits were hypothesis lists; important findings were checked against
current source and selected defects were reproduced. This is not a live
walkthrough of every route or an instrumented trace of every query.

Mutating probes and the complete suite used a new disposable PostgreSQL 16
container, `aqua-comprehensive-review`, at `127.0.0.1:55436`. The suite used
database `aqua`; independent probes used `aqua_review_probe`. Existing demo
databases were not reset. Probe transport was intercepted locally; no real
WhatsApp messages were sent. The browser print probe used the synthetic demo.
The demo web server was stopped during framework tests and restored afterwards.

| Check | Result |
|---|---|
| One fresh `pnpm db:deploy` | PASS: 104/104 migrations, pg-boss initialized. |
| `pnpm test:sharded` | **FAIL: 324/324 files observed, 2,540 passed, 8 failed, 1 skipped.** |
| Failing files | `tests/tier1/platform-auth-actions.test.ts`: 7 legacy password/TOTP expectations; `tests/tier1/announcements.test.ts`: 1 genuine first-deploy privilege failure. |
| `pnpm typecheck && pnpm lint` | PASS. |
| Migration, location, ops-action, platform-lead and tenant-convention scanners | PASS. Passing scanners did not detect the semantic scope defects below. |
| Compose, deployment-workflow, script-existence and runbook-sync scanners | PASS. |
| `pnpm audit --prod` | **18 advisories: 7 high, 8 moderate, 3 low.** No exploitability conclusion follows from the count. |
| `pnpm check:lines` | Reports 25 modules above 350 lines and 17 more above 300; report-only in the current workflow. |
| Most recent build/bundle check in this conversation | PASS: 96 routes, maximum 131 kB; `/ops/login` 125 kB, `/login/reset` 126 kB, limit 150 kB. Not rebuilt during this review. |
| Most recent focused WhatsApp/frontend/focus tests | PASS: 36 tests across 5 files; these files also ran in the full suite above. |

Complete-suite evidence: `/tmp/opencode/aqua-comprehensive-tests.log` and
`/tmp/aqua-test-shards-TrTFjc/`. Screenshot of the blank print state:
`.playwright-mcp/aqua-review-staff-qr-print.png`. These paths are local evidence,
not portable CI artifacts. No remote deployment, R2 round trip or repository
reviewer setting was verified.

## 1. Fix before using real pilot data

### Authorization and confidentiality

1. **Preserve and enforce resource scope in every action/service.**
   `lib/actions/enrolment.ts:39` passes only `tenantId` to a service where missing
   identity means unrestricted system access (`lib/services/location-access.ts:58`).
   Transfer/status paths lack member/source/destination location checks
   (`lib/services/transfer.ts:57`, `lib/services/member-status.ts:21`). Attendance
   history lacks location/coach-assignment checks
   (`lib/services/attendance-history.ts:53,110`); enrolment-history visibility and
   reversal reads need the same closure (`lib/services/enrolment.ts:22`,
   `lib/services/payment-reversals.ts:174`). These are same-tenant resource-access
   defects, not demonstrated cross-tenant RLS bypasses. Add direct-action negative
   tests with actual restricted contexts, not page-only tests.

2. **Validate attendance roster eligibility in the mutation transaction.**
   `lib/services/register.ts:248` accepts any same-tenant member after checking the
   session's location. A synthetic non-enrolled member was successfully marked
   present. Decide trial/makeup, inactive-member and cancelled-session semantics
   before adding the relationship guard. The action's session check alone does
   not authorize a member/session pair (`lib/actions/coach.ts:204`).

3. **Authorize parent-link issuance and validate the target.**
   `lib/actions/parent-link.ts:48–64` uses `members.write`, also held by reception,
   and signs the supplied member UUID without checking that member's existence
   or site. Its owner-layout argument does not protect a separately callable
   action. This finding is source-confirmed; no new receptionist HTTP replay was
   performed. Define the intended issuer permission and enforce it before
   returning an audited child attendance/financial link.

4. **Secure offline data across logout, expiry and account switches.**
   `public/sw.js:46,76–86` caches coach HTML by URL; `lib/offline/idb.ts:1–13`
   stores queues without tenant/user identity. `lib/actions/tenant-auth.ts:27`
   invalidates the session but does not purge/restrict either store. The global
   registrar still registers regardless of tenant offline enablement
   (`components/sw-registrar.tsx:5`). The SSR fix is complete, but the earlier
   cache-disclosure mechanism remains source-confirmed. Decide preservation or
   discard of unsynced marks, then implement identity-scoped storage and negative
   logout/account-switch browser tests.

### Integrity and accounting

5. **Reconcile restricted grants on the first deployment.**
   `db/deploy.ts:179–181` bootstraps grants before migrations;
   `db/bootstrap-roles.ts:42–112` restricts only existing tables and assigns broad
   defaults to new ones. Immediately after one fresh deployment, the app role
   had announcement UPDATE/DELETE and notification DELETE. The complete suite
   reproduced this failure. Fix deploy/migration privilege reconciliation and
   test one genuinely fresh deploy. Do not rely on CI's reset-then-deploy sequence
   (`.github/workflows/ci.yml:211–229`), which runs bootstrap twice.

6. **Make PIN-failure counting atomic.**
   `lib/services/pin-lockout.ts:23–44` performs a separate read and update. Five
   concurrent synthetic failures left **2 failures and no lock**. Serialize or
   atomically increment, and cover success/expiry races. The public email-login
   bypass is closed, but this counter race is not.

7. **Make refused transfers true no-ops and use tenant-local business dates.**
   `lib/services/transfer.ts:95–155` deletes source rows before refusal checks and
   reconstructs one with a new ID/date. A `target_full` refusal changed the
   original enrolment. Both this service and `lib/services/register.ts:238` use
   UTC today, which is the prior business date during early IST hours. Preserve
   exact rows on refusal and test the midnight boundary.

8. **Close centralized transaction-coincident audit coverage.**
   Core member creation/edit, enrolment, attendance, status and transfer are not
   all covered by the required `audit_log` writes. Probe enrolment/attendance/
   transfer produced no core audit rows, and attendance `marked_by` was null.
   References: `lib/services/register.ts:60–171,179–295`,
   `lib/services/people.ts:292`, `lib/services/member-status.ts:41`,
   `lib/services/transfer.ts:163`. Domain transition history and post-commit
   activity events do not substitute for atomic audits. Define replay/no-op
   semantics and verify rollback with actor attribution.

9. **Keep authoritative money exact, including aggregates.**
   `lib/services/invoice-issue.ts:158–184` adds line values as numbers before
   converting to bigint. Two individually accepted synthetic lines totaling
   **9,007,199,254,740,993 paise** persisted an invoice subtotal of
   **9,007,199,254,740,992 paise**. This is an extreme kernel-boundary reproduction,
   not an ordinary counter-payment discrepancy. Address aggregate bounds or
   bigint arithmetic and audit Number conversions in payments/reversals/reads
   (`lib/money/arithmetic.ts:6`, `lib/services/payments.ts:115–139`).

## 2. Remaining messaging work

### Current-branch defects reproduced in this review

10. **Respect the Parents-only WhatsApp audience.**
    `lib/messaging/notification-events.ts:17–24` treats a non-batch announcement as
    all active members and forwards their selected destinations. A Parents-only
    probe queued a message to an adult member's own phone without any guardian.
    Define guardian-only audience selection and test adult/minor/multiple-contact
    combinations against the actual announcement-to-outbox path.

11. **Recheck staff scope at dispatch, not just active membership and phone.**
    Enqueue checks site/coach scope (`lib/messaging/notification-enqueue.ts:34`),
    but `lib/jobs/whatsapp-notifications-job.ts:37–45` does not recheck the event's
    location/assignment/role eligibility. Removing a queued receptionist's site
    grant still resulted in one send. Preserve the scope needed for current
    authorization and suppress recipients who are no longer entitled.

### Production functionality

- **Production ops authentication currently has no usable delivery channel.**
  Ops login now requires WhatsApp; `getMessageProvider()` returns null for
  cloud/disabled (`lib/messaging/provider.ts:76–83`), and both release Compose
  files disable messaging. Resolve this release dependency before promoting the
  new auth flow. The functioning local mock is not production authentication.
- Real Cloud adapter; platform-auth and tenant-owned WABA credential routing;
  encrypted tenant credentials, explicit provisioning and rotation; approved
  templates; verified/signed inbound and delivery callbacks; deduplication;
  delivery/read status; provider-compatible retries/backoff and idempotency.
- Operational outbox visibility, exhausted-retry recovery, retention/cleanup for
  challenges and message payloads, monthly cost/usage reporting, and explicit
  essential/suppressible classification in delivery evidence.
- Scheduled overdue reminders/dunning (V-14), rather than just invoice-issued
  and payment-recorded notifications. Actual PDF receipt sharing is not wired;
  the current send is a text notice and the PDF is downloadable separately.
- C-43 is now **partially implemented** by the durable mock outbox/worker; it is
  no longer accurate to say there is no notification queue. Real callbacks and
  production transport remain absent. C-43a email fallback still needs a current
  scope decision, given the WhatsApp-first/no-SMS direction.

## 3. Frontend and reporting work still open

12. **Staff check-in QR printing currently hides the poster.**
    `app/globals.css:103–107` hides every direct main child except the member-card
    print wrapper. `components/premises-qr-card.tsx:20` has no such wrapper.
    On `/owner/staff/check-in-qr`, Chromium print-media inspection found the QR
    container and every other main child at `display:none`. Fix print isolation
    per artifact and add a print-render regression.

13. **Retention counts can be wrong when inactive members have recent marks.**
    `lib/services/owner-reports.ts:230–255` subtracts all distinct members with
    recent attendance from an active-only denominator. One active member with
    no attendance plus one left member with attendance yielded **0 at risk**
    instead of **1**. Filter the numerator to the same eligible cohort; review
    zero/partial/absent semantics and test inactive/deleted members.

- Further interaction/accessibility closure: `components/member-status-panel.tsx:33`
  has no inline catch for transport failures, and its reason input at line 56
  lacks a label. `components/members-board.tsx:61` refetch has no error recovery
  or stale-response guard. Invoice/payment inputs still suppress outlines in
  places; verify their replacement focus treatment in Chromium, not just the
  global token. Existing fixed labels/targets are not a blanket certification.
- Full target-board/state comparison remains unclosed. Map shipped PR1–PR3 and
  October fixes onto UR tasks instead of treating all UR-01–UR-15 as unstarted.
  Complete populated/empty/loading/error/permission-limited/long-data and print
  acceptance at the role viewports; verify real-device speed separately from
  bundle-size success.
- Parent progress, schedule/announcement expansion is deferred; read-only fees,
  runway, attendance and receipts already exist and should not be rebuilt.
- The Documents tab is an explicit placeholder, not upload support
  (`components/member-detail/member-documents-panel.tsx:3–18`).

## 4. Unfinished product scope

| Area | Remaining work / current boundary |
|---|---|
| Payroll | V-28–V-34: pay rules, advances, draft computation, review/adjustments/lock, payslips, audited pay reads/denials, payroll exports. Shifts, staff attendance, premises QR and leave V-23–V-27 are implemented. |
| Profitability | Full program/batch/location revenue attribution, coach costs, batch profitability and contribution report V-35–V-37. Existing collections/plan-revenue charts are not a P&L. General operating expenses remain a later module. |
| Bookings | Price-rule management UI, usable staff booking UI, self-service/cancellation/closure scope V-05–V-07. Services/pricing/exclusion constraints exist, but `/reception/bookings` intentionally 404s. Confirm business-hours slot generation and walk-in billing semantics before enabling it. |
| Café/wallet | Wallet ledger services exist; wallet-to-café settlement and wallet UI do not. Order void UI is still absent. Anonymous walk-in orders cannot be billed without a member; credit limits remain undecided. |
| Swimming/worker operations | Lane allocation V-12, facility chemistry/incident logs V-13, worker tasks/maintenance V-50, member QR attendance scanner V-21, public self-registration V-22. A printable member identity QR is not a check-in scanner; staff premises QR is a different implemented flow. |
| Reports | Full cohort/lapse/stage-duration/cost-per-session tails and CSV export for every report. Basic attendance, enquiry-source conversion, aggregate retention, coach load and utilisation cards already exist. |
| Ops support | O-12 plan-management UI and O-13 restricted/audited subscription support lookup remain pending. Effective config, entitlements, provisioning, leads and activity views exist. |
| Module kernel | M-02 facility/activity/resources expand-contract cleanup is deferred; existing facility sub-units support current usage. Do not confuse it with a missing booking exclusion constraint or missing skill bridge. |
| Import | Pilot CSV import exists; XLSX, arbitrary mapping/saved presets and 24-hour undo from the original plan are deferred/unimplemented. Supplied-code conflicts currently skip without comparing identity (`lib/services/member-import-match.ts:18–22`); decide explicit conflict reporting versus intentional code-only matching. |

## 5. Consent/privacy and operational release gates

- Capture/evidence and send-time communications suppression exist. The user-facing
  per-purpose withdrawal workflow V-45 does not. A manually updated test consent
  row is not a withdrawal UI.
- Processing-withdrawal offboarding V-45a and erasure/financial retention V-47
  need the already-required counsel/product decisions. Add person-scoped export
  V-46, per-tenant signed DPA/version C-05a, and the breach runbook/drill V-48.
  Include new outbox, log and challenge data in the retention/erasure inventory.
- Prove real Dev deployment: registry pull/digest, TLS/host routing, persistent
  volume, one-shot migration recreation, one worker and healthy heartbeat.
- Install and verify the backup timer, perform a real R2 upload/download and
  timed isolated restore, and prove nightly export/checkpoint success. Local
  dump/fake-store tests and tracked Compose alone do not satisfy these gates.
- Rehearse code rollback against newer schema; run the burst/load test and query
  plans; complete production-mode auth/role/offline/parent E2Es, secret rotation
  and the release review on the promoted image.
- Complete the business parallel run/reference month and reconciliation evidence,
  then obtain the human Production approval. None was observed in this review.
  Per-tenant subdomains remain a separate future design, not current routing.

## 6. Verification, maintenance and documentation closure

- Human-owned Tier1 auth expectations must be updated to the approved OTP design;
  fix the announcement grant defect rather than weakening its test. Add regressions
  for the newly reproduced defects. The booking-pricing clock/override interaction
  and near-midnight staff-test skips still need deterministic fixtures.
- Update `scripts/e2e-platform-form-leak.ts:106–114,286–300`: it still scans old
  login/verify components and fills nonexistent email/password fields on the
  current login. That can report success without testing the new credentials.
- Strengthen semantic action/resource/audit coverage. Current scanners pass while
  the concrete authorization/audit findings remain reproducible.
- Review compatible dependency fixes and actual runtime reachability. The current
  18 advisories include Next-transitive PostCSS/sharp, source-map-js and Better
  Auth's optional development/test dependency chains. No updates or suppressions
  were made by this review.
- S-06 error-monitoring integration and S-05b mutation tooling remain unevidenced
  in the package/config. Request IDs and stdout logs are not Sentry delivery.
  Keep any future analytics off parent/student surfaces.
- Refactor oversized modules along responsibility boundaries, prioritizing
  `db/preset-engine.ts`, `lib/services/staff-invitations.ts`,
  `lib/services/register.ts` and invoice panels. Extend audit/request correlation
  coverage where inline writers still omit it. Extend partition horizons through
  reviewed migrations before the current 2028-12 limit.
- Reconcile current execution docs: stale PR #193 status, old password/TOTP
  walkthroughs, all-pending UR plan, missing-billing parent notes, obsolete
  gateway/font/Tailwind examples and conflicting K-05/C-47 completion notes.
- Current WhatsApp/UI work is still uncommitted. Package it into reviewed changes
  with PR `ci` and protected-path checks green, then have the human merge. Remote
  reviewer settings were not rechecked; the label alone is not human approval.

## Recommended order

1. Close resource authorization, roster eligibility and offline confidentiality.
2. Fix first-deploy grants, PIN concurrency, transfer rollback/dates, core audits
   and exact money; add meaningful negative/concurrency/rollback regressions.
3. Fix WhatsApp audiences/scope and resolve Production ops authentication.
4. Fix QR printing/retention reporting and remaining UI/error/acceptance gaps.
5. Get a fully green single-fresh-deploy gate and current auth E2Es, reconcile the
   docs, and complete the real deployment/backup/role/cutover gates.
6. Build payroll/profitability and agreed booking/café/parent expansions in plan
   dependency order. Later phases remain later: offline POS, inventory, expenses,
   discounts, accounting integration, quota/platform billing, extra locales and
   intelligence. Gateway/e-mandate work is not an R1 missing requirement.
