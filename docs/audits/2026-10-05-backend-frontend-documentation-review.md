# Backend, frontend and documentation review — 2026-10-05

## Verdict

**The architecture is substantially implemented, but the documentation is only partially aligned and the checked-out application has confirmed security and workflow defects. Fix the high-priority findings before using real pilot data.** Typecheck, lint, builds and convention scanners pass; the complete test suite does not pass after one fresh deployment.

Reviewed checkout: `chore/opencode-development-setup`, HEAD `870cf1a22f6423362965ca20cd413783bc4afc4f`, including the existing local tooling/documentation changes. This is a review of that checkout, not a claim about the latest remote `main`. Existing user changes and the September 27 assessment were preserved. No application fixes, dependency changes, migrations, commits or deployments were made; this report is the retained review artifact.

The September 27 assessment was used as a lead list, not as verification for this review. Previously reported findings were checked against the current source. The authentication bypass, additional resource-scope gaps, failed-transfer mutation and live frontend failures below extend that assessment.

## Method and verification

Repository-wide review covered architecture, scope, task/release/design documents; routes and Server Actions; auth and role grants; tenant/database scopes, schema and migration/bootstrap order; critical member/scheduling/money services; worker jobs and storage boundaries; UI components, offline state, navigation and error handling; CI and deployment configuration. Manual investigation focused on high-risk boundaries. This is a broad audit with full-suite execution, not an instrumented trace of every SQL query or a browser walkthrough of every route.

All mutating verification used synthetic records in a disposable PostgreSQL 16 container, `aqua-review-20261005`, bound to `127.0.0.1:55505`. Database `aqua` was used for the full suite; separate database `aqua_browser` for probes and browser fixtures. The existing `aqua-db` and other local application databases were not modified. Node 22.23.2 and pnpm 11.22.0 were used.

| Check | Observed result |
|---|---|
| `pnpm typecheck && pnpm lint` | PASS before temporary probe scripts were created. |
| One fresh `pnpm db:deploy` | PASS: 102/102 migrations and pg-boss initialization. Privilege verification immediately afterwards exposed BE-07. |
| `pnpm test:sharded` after that single deployment | **FAIL: 316/316 files, 2,497 passed, 2 failed, 1 skipped.** Failures: append-only announcement privileges and the date-dependent booking-pricing fixture. The live R2 case was skipped. |
| `pnpm exec vitest run tests/tier1/bookings-pricing.test.ts -t 'snapshots the resolved price' --maxWorkers=1` | PASS: 1 passed, 7 filtered out. |
| Same booking-pricing file without the name filter | FAIL: 7 passed, 1 failed. Confirms the interaction with the earlier advance-window override, QA-01. |
| Second `pnpm db:deploy`, then `pnpm exec vitest run tests/tier1/announcements.test.ts --maxWorkers=1` | PASS: 10 tests. This demonstrates how repeat bootstrap masks the first-deploy defect; it does not make the first-deploy gate green. |
| `pnpm check:bundle` | PASS, with its production build: 93 routes, maximum reported First Load JS 131 kB against 150 kB. |
| `pnpm check:fonts` | PASS, with its own production build: 3 Latin WOFF2 files, 55.2/60 kB. |
| `pnpm e2e:parent-link-zero-js` | PASS against a production build: valid and invalid parent links both contain zero script tags. |
| `pnpm e2e:host-boundary` | PASS: 19 host/path probes. Initial connection retries were server startup polling. |
| Migration, focus-contrast, script-existence, ops-action, platform-leads, location-scope, tenant-convention, Compose and deployment-workflow scanners; runbook-sync check | PASS. Their limits are illustrated by findings that these scanners do not detect. |
| `pnpm audit --prod` | NON-CLEAN: 16 advisories — 5 high, 8 moderate, 3 low. See QA-02; this is not a count of proven exploitable request-path defects. |
| Synthetic service probes | Reproduced lockout bypass and lost failure increments; location write/read bypasses; non-roster attendance; failed-transfer date/ID changes; missing audit rows; oldest-first parent history; and one-paise loss at the money kernel's large-number boundary. |
| Live production-server browser probes | Reproduced FE-01–FE-05 and observed FE-07/FE-08. Owner routes checked at 390×844 and 1280×900; coach/reception at 390×844; ops overview at 1280×900; parent at 390×844 with JavaScript disabled. |

Browser route samples: owner home, members, member payments, fees, reports, schedule, academy settings and staff; coach today, schedule, members, me and populated register; reception today, members, populated member invoice, collect-payment, café and me; authenticated ops overview; valid parent page with attendance and money. Sampled staff pages loaded successfully with no document-level horizontal overflow. These observations do not certify every form, permission combination, empty state or target-board layout.

Evidence logs and screenshots were captured under `/tmp/opencode/aqua-review-*`; temporary reproduction scripts were removed. Runtime browser checks used clean/blocked service workers except the explicitly isolated offline-cache reproduction. No real R2, VPS, remote GitHub settings or production account was accessed. The standalone role-bypass, platform-form-leak and full offline E2E drivers were not rerun in this review.

## Backend findings

### BE-01 — High: public email sign-in bypasses PIN lockout

**References:** `lib/auth/server.ts:49`, `app/api/auth/[...all]/route.ts:4`, `lib/services/credentials.ts:207`, `lib/services/credentials.ts:239`.

Enabling Better Auth email/password exposes `/api/auth/sign-in/email`. The catch-all forwards it to Better Auth without the `users.pin_locked_until` check used by the custom phone/PIN path. The stored synthetic email is derived from the phone number. An account locked out through the intended login door can therefore still authenticate through the public email door with its PIN; incorrect guesses through that door also bypass the application's per-account failure bookkeeping.

**Reproduction:** set a synthetic account to five failures with a future lock timestamp. `pinLogin(phone, correctPin)` returned 401. A request to the actual `auth.handler` for `/api/auth/sign-in/email` with the same credentials returned **200 and a session cookie**. This is a handler-level probe, not a claim that a real user's account was attacked.

**Correction:** enforce account lockout consistently at the credential-verification boundary, or disable the unintended public endpoint while preserving the supported internal credential path. Add a negative HTTP-path test for a locked account. The custom PIN route calls `auth.api.signInEmail` internally without forwarding a Request; do not assume that the HTTP handler's per-IP limiter protects that custom route.

Context7 was consulted for installed Better Auth 1.7.1. The returned docs were not version-pinned to 1.7.1; the public handler/disabled-path/rate-limiter behavior was also checked in the installed package source and the bypass was reproduced locally.

### BE-02 — Medium: concurrent PIN failures undercount attempts

**Reference:** `lib/services/pin-lockout.ts:23–44`.

The failure counter performs a separate SELECT and UPDATE without a transaction lock or atomic increment. Concurrent requests can read the same old value and overwrite one another. The comment claiming that the worst outcome is an early lock is incorrect; lost increments delay the lock.

**Reproduction:** five concurrent `recordPinFailure` calls from a zero counter left **2 failures and no lock**, rather than five failures and a lock.

**Correction:** serialize the counter update or increment and compute the lock condition atomically. Test concurrent attempts and races with a successful login/lock expiry.

### BE-03 — High: location-scoped staff can mutate other sites through multiple actions

**References:** `lib/actions/enrolment.ts:39`, `lib/services/location-access.ts:58`, `lib/services/transfer.ts:57–171`, `lib/actions/transfer.ts:29–34`, `lib/services/member-status.ts:21–53`, `lib/actions/people.ts:129–135`.

Three sibling paths violate the intended resource boundary:

- Enrolment drops actor/location context and calls the service with only `tenantId`. Missing identity is interpreted as an unrestricted system caller.
- Batch transfer has no source/member/destination location-access check, even when actor context is supplied.
- Member status transitions have no member location-access check. A location-checked page is not a guard on a separately callable action.

**Reproduction with location scoping enabled:** an A-site context enrolling into B was refused; the action's tenant-only context succeeded. The A-site context transferred a member into B successfully and changed a B-site member from active to paused successfully.

**Impact:** unauthorized same-tenant roster/status changes. Tenant RLS still confines these operations to the tenant; this is not a demonstrated cross-tenant bypass.

**Correction:** preserve authenticated context and validate all affected resources in the mutation transaction. Separate authenticated staff and deliberate system contexts so losing an actor cannot silently widen access. `scripts/lib/location-scope-scan.ts:30–41` explicitly allowlists several paths based on page checks, which do not protect direct actions.

### BE-04 — High: attendance-history actions bypass coach assignment and location restrictions

**References:** `lib/actions/attendance.ts:35–58`, `lib/services/attendance-history.ts:53–95,110–150`, `lib/services/roles.ts:95–103`, `lib/services/enrolment.ts:22–45`.

Both attendance-history actions require only `attendance.read`, which coaches hold. The services select the supplied member/batch within the tenant without a coach assignment check or location check. A coach can request another coach's member/batch history directly even though the normal coach member-detail path is assignment-scoped. Reception can similarly read another site's history. The member-enrolment-history action has the analogous missing location check.

**Reproduction:** the A-site scoped context obtained a B-site member's attendance-history row. The coach exposure follows the same action/service path: no role/assignment branch narrows it.

**Correction:** enforce member/batch visibility in each read service, including assignment scoping for coaches; test actions against unrelated members, batches and locations. Do not rely on the caller having first loaded a protected detail page.

### BE-05 — High: attendance accepts members outside the session roster

**References:** `lib/actions/coach.ts:200–212`, `lib/services/register.ts:248–295`, `db/schema/scheduling.ts:139–147`.

The action checks session visibility, then the service upserts any same-tenant member ID. It never validates an effective enrolment or allowed trial/makeup relationship. Separate member and session foreign keys enforce tenant coherence, not membership in that session's roster.

**Reproduction:** an A-site session with no enrolments accepted a present mark for a B-site member. This can corrupt attendance, absence signals, assessments' surrounding context and parent-visible history.

**Correction:** verify roster eligibility inside the marking transaction, with explicitly decided trial/makeup rules; also decide whether cancelled sessions and inactive/deleted members may be marked. Add negative member/session relationship tests.

### BE-06 — High: parent-link issuance has insufficient role and target checks

**References:** `lib/actions/parent-link.ts:12–24,48–64,84–115`, `lib/services/roles.ts:66–83`.

The action's owner/admin-only contract is implemented with `members.write`, which receptionists hold. Its comment incorrectly treats the owner layout as protection for the action. It signs a caller-supplied member UUID without checking member existence, member location or the intended issuer restriction.

**Impact:** a receptionist can reach the legitimate signing path for a shareable child attendance/financial URL outside the documented issuer/site boundary. The signature protects the token from forgery, not from unauthorized issuance by the application.

**Evidence level:** source-confirmed action-to-grant-to-signing path; a signed-in receptionist HTTP POST to this specific action was not performed. The missing member lookup is visible in the complete action body.

**Correction:** explicitly authorize issuance and validate the target member/location before returning a signed link, inside the audited operation. Add role, missing-member and forbidden-site action tests. Keep token values out of audit payloads.

### BE-07 — High: one fresh deployment leaves append-only table privileges too broad

**References:** `db/bootstrap-roles.ts:42–100,110–113`, `db/deploy.ts:174–179`, `db/migrations/20260918125000_u06_announcements.sql:29–95`, `.github/workflows/ci.yml:211–229`.

Bootstrap revokes restricted privileges only on tables that already exist. Broad default privileges then apply to tables created by later migrations; narrower GRANT statements do not revoke those inherited grants.

**Reproduction immediately after one fresh deploy:** announcement UPDATE = true, announcement DELETE = true, notification DELETE = true. The full suite failed the corresponding privilege assertion. A second deploy re-ran bootstrap against the existing tables, and the announcement suite passed 10/10.

**Impact:** the intended app-role immutability boundary is missing on first deployment. This is not an observed public HTTP endpoint allowing arbitrary SQL, and audit-log triggers provide separate protection for audit rows.

**Correction:** reconcile exact restricted grants after table creation as part of every deployment, with suitable deployment/migration concurrency handling. CI must exercise a genuinely fresh database with **one** deploy; its current reset-then-deploy sequence masks this defect.

### BE-08 — Medium: core mutations lack centralized atomic audit records

**References:** `lib/services/register.ts:60–171,179–295`, `lib/services/people.ts:292–349`, `lib/services/transfer.ts:95–177`, `lib/services/member-status.ts:41–55`, `lib/actions/coach.ts:212–243`, `tests/tier1/tenant-audit-coverage.test.ts:53–87`.

Direct member creation/update, enrolment, attendance and transfer do not write `audit_log` in their mutation transaction. Status transitions write their domain history table but not the required centralized audit. Attendance's `markedBy` column is declared but not populated by the upsert. Post-commit activity events are a separate analytics stream, not an atomic audit replacement; activity enqueue failure can also make an action report failure after its attendance row committed.

**Reproduction:** the successful enrolment/attendance/status/transfer probes produced **zero tenant audit rows**. The coverage test checks an enumerated list of other services and does not cover these core paths.

**Correction:** add actor-attributed transaction-coincident audits and negative rollback assertions; define no-op/replay audit semantics. Preserve the distinction between audit and at-least-once activity data. E-02's documented TODO cleanup is narrower than global F-15 coverage.

### BE-09 — Medium: a refused transfer rewrites the source enrolment

**Reference:** `lib/services/transfer.ts:95–155`.

The service deletes the original source rows before checking capacity/duplicate-target refusal. On refusal it inserts a new source row dated today, instead of restoring the original row or rolling back. Multiple original source enrolments are also collapsed into one.

**Reproduction:** a source enrolment dated `2026-09-01` was transferred to a full destination. The service returned `target_full`, but the retained source row had a new ID and date `2026-10-04` (the UTC date at probe time).

**Impact:** a failed operation changes historical eligibility and can make past session membership calculations wrong.

**Correction:** perform refusal checks before destructive writes, or throw/rollback the transaction; preserve the source exactly on failure. Check exact rows/dates/IDs, not only the returned error.

### BE-10 — Medium: enrolment and transfer business dates use UTC instead of tenant-local today

**References:** `lib/services/register.ts:238`, `lib/services/transfer.ts:105`.

`new Date().toISOString().slice(0,10)` dates an admission/transfer as the previous day between 00:00 and 05:29 IST. Member creation already uses `todayInZone`; these paths do not.

**Evidence:** the probe ran on October 5 IST and wrote October 4 to the source enrolment. Use the tenant's timezone inside the transaction and add controlled-clock boundary tests.

### BE-11 — Medium: large accepted invoice inputs lose paise during aggregation

**References:** `lib/services/invoice-issue.ts:44–69,156–182,193–202`, `lib/money/arithmetic.ts:6–9`, `lib/services/payments.ts:113–138`, `lib/services/payment-reversals.ts:81,120–130`.

Amounts are stored as bigint, but invoice subtotal/tax totals are reduced as JavaScript numbers. Individual valid safe integers can sum beyond the exact-number range. The general arithmetic assertion checks integer-ness rather than safe-integer-ness, and several financial read/write paths convert bigint back to Number.

**Reproduction at the internal invoice-service boundary:** a no-GST invoice with line amounts `Number.MAX_SAFE_INTEGER` and `2` was accepted. Exact database line sum = `9007199254740993`; saved subtotal = `9007199254740992`: **one paise lost**.

**Scope:** these are deliberately extreme synthetic values, not an observed ordinary counter-payment error or a demonstrated current public route accepting arbitrary invoice lines. The confirmed issue is the kernel's accepted-input/aggregation invariant and the missing bound.

**Correction:** keep authoritative arithmetic as bigint, or enforce demonstrably safe bounds on inputs, aggregates and conversions. Add an invoice invariant comparing exact line sums with saved totals.

### BE-12 — Medium: reversal listing omits payment location visibility

**References:** `lib/actions/payment-reversals.ts:42–49`, `lib/services/payment-reversals.ts:174–200`.

Unlike the reversal mutation and invoice-payment listing, this read accepts tenant-only context and selects by payment ID without checking the associated payment's location. A location-scoped financial reader with `payments.read` can obtain another site's reversal amount/reason when it knows that ID.

**Evidence level:** current source confirms the missing check; the earlier assessment reproduced it on its disposable database. This particular payment/site probe was not repeated here. Accept full actor context and apply payment/location visibility before returning rows.

## Frontend findings

### FE-01 — High: sign-out leaves a readable offline roster behind

**References:** `public/sw.js:46,76–86`, `lib/actions/tenant-auth.ts:27–30`, `lib/offline/idb.ts:1–13`, `lib/hooks/use-offline-register.ts:81–105,181–183`, `components/sw-registrar.tsx:5–14`.

Coach HTML is cached by URL in a shared origin-wide cache. Signing out invalidates the server session but does not purge/restrict the cache or IndexedDB. Queue entries and roster snapshots are also not associated with an authenticated user/tenant namespace. Registration/caching is not conditioned on the tenant's attendance-sync flag.

**Live reproduction:** login as the synthetic coach, cache the populated register, sign out through Better Auth, confirm `/api/auth/get-session` is null, go offline and revisit the register URL. The page still exposed **16 roster rows and a synthetic member name**. The seeded tenant had offline sync disabled.

**Impact:** the next user of a shared/lost signed-out device can read cached member data; queued data may also survive account changes. This is local-device disclosure, not a remote cross-tenant database leak.

**Correction:** define and implement logout/account-switch/expiry handling for cached personal data and pending writes. Scope persisted data to identity and prevent replay under another actor. Decide how unsynced attendance should be preserved or discarded before coding that policy.

### FE-02 — Medium: reception's invoice expansion fails after a payment exists

**References:** `components/member-detail/invoice-expanded.tsx:74–97`, `lib/actions/payment-reversals.ts:48`, `lib/services/roles.ts:66–83`, `app/(reception)/reception/members/[memberId]/page.tsx:77–83`.

Invoice load unconditionally fetches reversals for every payment. Receptionists may read invoices/record payments, but do not hold `payments.read`; the reversal action throws. The catch sets the entire expanded invoice to failed, hiding its receipt and further payment controls.

**Live reproduction at 390×844:** a valid ₹500 invoice with ₹100 already paid expanded to **“Could not load this invoice.”**, with no Record payment button. Server logs identify the `payments.read` denial. The dedicated collect-payment route is a separate path; this finding concerns the member-detail workflow.

**Correction:** make invoice rendering respect allowed read permissions; decide how reception sees reversal-adjusted history without granting refund authority. Add a real receptionist action/component integration case with a pre-existing payment rather than mocks that always return reversals.

### FE-03 — Medium: changing facility leaves a stale member list on screen

**References:** `components/members-board.tsx:38–57`, `components/facility-switcher.tsx:25–30`, `app/(owner)/owner/members/page.tsx:22–25,65–69`.

The server supplies new filtered `initialMembers`, but the client retains the old array in `useState(initialMembers)`. There is no reset/effect or facility-keyed remount on query navigation.

**Live reproduction:** All facilities showed 18 synthetic members. Selecting a site containing one member updated the URL/switcher but still showed 18 rows, including main-site names. Reloading the same URL showed the correct one row.

**Correction:** synchronize data and filter state with the new facility/navigation, while handling existing search/status filters explicitly. Add a client-navigation test rather than testing only fresh page loads.

### FE-04 — Medium: network failures strand money controls in a permanent busy state

**References:** `components/member-detail/invoice-expanded.tsx:104–115,303–319`, `components/member-detail/member-invoices-panel.tsx:190–206`.

Async mutation chains set busy before awaiting, but lack catch/finally cleanup. A rejected action never reaches `setBusy(false)` and gives no actionable error.

**Live reproduction:** abort the Record payment Server Action request in Playwright. The control remained disabled as **“Saving…”**, with no status/error message. The request was aborted before reaching the server; no payment was submitted by this probe.

**Correction:** always release busy in finally, surface a retryable failure, and refresh/verify state before retry if a response could have been lost after commit. Cover thrown transport errors as well as `{ok:false}` service responses.

### FE-05 — Medium: register render accesses browser storage during SSR

**References:** `lib/hooks/use-offline-register.ts:181–183`, `lib/offline/idb.ts:15–17`.

The hook performs `kvSet` in `useMemo`, during render. Client components also render on the server, where IndexedDB does not exist; the unawaited rejected Promise is not handled.

**Observed production-server log:** opening the populated coach register produced `ReferenceError: indexedDB is not defined` and an `unhandledRejection`. The page returned 200 in this run; a process crash was not observed.

**Correction:** move browser persistence to an appropriately gated effect, handle failures, and honor the offline policy. Add a server-render test; browser-only hook tests cannot reveal this boundary violation.

### FE-06 — Medium: parent “recent” attendance shows the oldest eight marks

**Reference:** `lib/services/parent-view.ts:208–227`.

The query says it selects recent history but orders session dates ascending before limiting to eight. As the member history grows, the same old marks remain visible and newest marks disappear.

**Reproduction:** ten marks dated October 1–10 returned October **1–8**, omitting October 9–10. Select newest rows first, then reverse the selected subset if chronological display is desired. Add a history case larger than the limit.

### FE-07 — Medium: parent HTML retains low-contrast colors after the staff token fix

**References:** `app/p/[token]/route.ts:113–116,249–251,269–274`, `app/globals.css:8,14–18`, `DESIGN.md:33–38`.

The raw parent document duplicates the older color palette rather than using the darker AA foregrounds now in `globals.css`. Browser inspection found 11–13px meaningful labels/invoice text using `#7B918D`.

Measured contrast: old muted text/paper **3.35:1**, muted/deck **2.91:1**, old present green/present soft **2.99:1**. These fail the 4.5:1 normal-text requirement. The zero-JS contract passed; it does not establish contrast compliance.

**Correction:** share server-readable approved palette values with the parent renderer and measure actual parent text/status pairs. Global CSS/focus-token checks do not cover this separately rendered document.

### FE-08 — Low: labels and touch targets remain inconsistent

- `components/members-board.tsx:64–74`: member search has no associated label or ARIA label, confirmed at both owner viewports.
- `components/member-enrolment-panel.tsx:270–275`: enrolment batch selector lacks an accessible name.
- `components/member-detail/invoice-expanded.tsx:403–408`: void-reason input relies on a placeholder without a label.
- `app/(owner)/owner/staff/page.tsx:22–36`: Roster, Invitations and Add staff links rendered at **36px height**, below the documented 44px minimum, including on mobile.
- `components/member-detail/invoice-expanded.tsx:321`: Confirm reversal lacks the shared minimum-height treatment.

Add meaningful labels and use shared control sizing. These are specific source/browser findings, not an exhaustive accessibility certification.

## Verification and maintenance findings

### QA-01 — Medium: booking-pricing tests depend on date and preceding test state

**References:** `tests/tier1/bookings-pricing.test.ts:48–58,294–318,320–333`, `lib/services/booking-pricing.ts:180–198`.

The advance-window test leaves a seven-day override in place. The following snapshot test selects the next Monday after today. When today is Monday before 14:00 IST, that next-Monday 14:00 slot is more than seven exact days away, so creation is correctly refused and the test fails for an unrelated reason.

This failed in the complete suite and again in the isolated full file; the same snapshot test passed alone without the preceding override. Reset fixture state and use controlled clocks. The human-owned `tests/tier1/**` files were not edited.

### QA-02 — Dependency advisories require an updated disposition

`pnpm audit --prod` now reports **16** advisories, versus five in the September assessment/remediation notes. Paths include Next's older transitive PostCSS, optional Better Auth → drizzle-kit → esbuild tooling, and Better Auth → Vitest → jsdom → undici. The latter adds 11 advisories to the earlier set (3 high, 5 moderate, 3 low).

Presence in a production dependency graph does not demonstrate that a test-tool WebSocket/cache/interceptor or attacker-authored CSS path is exposed in the deployed application. No exploitability probe was performed for these advisories. Review compatible dependency updates and actual runtime reachability; do not describe the old five-advisory result as current or suppress the findings without a disposition.

## Documentation matching

**Aligned:** Next 15/Postgres/Drizzle/pg-boss topology; tenant and pre-tenant scoped access; bigint database storage; counter-recorded payments and no R1 gateway; CSV/operator consent import; parent token route and production zero-JS property; the current manual Dokploy/digest deployment runbook; remaining payroll/profitability, real messaging, document-upload and live-backup work.

**Needs reconciliation:** current rules/as-built claims, old task state, and superseded target descriptions coexist without a consistent current-status index.

| Document/reference | Mismatch or ambiguity | Recommended correction |
|---|---|---|
| `DESIGN.md:61–64` | Says parent runway is open and blocked because billing data does not exist. Parent money/runway rendering is now implemented. | Replace that current instruction with the shipped status and actual remaining expansion. |
| `DESIGN.md:84–103,269–273,325`; `docs/project-scope.md:781–785`; plan S-02 | Old palette/Tailwind-config examples and white-on-mango primary pattern conflict with Tailwind v4 CSS tokens/AA fixes. Scope/S-02 still say 45 kB fonts; current budget is 60 kB. The Lucide sample is itself a barrel import despite the individual-path rule. | Make the approved token/pattern examples match `globals.css`, `--accent-strong`, current import policy and measured font budget. |
| `docs/ui-redesign-implementation-plan.md:3–8,62–69,127–157` | Says all UR tasks are unstarted and Reports/check-in are broken. Those fixes and shared AA/primitives already shipped through PR1–PR3. | Map superseding PR tasks/evidence to the UR list; retain genuinely unfinished visual work rather than restarting solved tasks. |
| `docs/pilot-release-checklist.md:39–55`; `docs/pilot-remediation-checklist.md:9–10` | Current boards still say PR #193 is open, although local git history includes its merge `9228d52`. Release checklist's general deployment wording still promises auto-Dev deployment; active workflow/runbook uses manual Dokploy and approval-only Production handoff. | Update current boards to the reviewed commit and current operator workflow; preserve dated historical evidence as history. |
| `docs/implementation-plan.md:814` versus `1721–1740` | C-47 still says jobs have no audit because actor ID is NOT NULL; E-01 and current jobs have nullable system actors and audits. Also says renewal due date is period end; code uses the following day. | Update the old C-47 status note. Distinguish targeted E-02 cleanup from the still-incomplete global audit contract, BE-08. |
| `docs/implementation-plan.md:2132–2143` | K-05 is called complete service-side and immediately listed as deferred in the fast-follow table. Parent fees are also listed under deferred expansion although read-only money shipped in PR2. | Separate shipped ledger/parent money from deferred wallet-to-café UI, progress and announcements. |
| `docs/project-scope.md:9,239–242,297,723,745,850`; `docs/architecture.md:116,1777–1789` | Stale pre-development/gateway/upload/Excel wording and target observability claims can be mistaken for shipped capability. Scope still says branch invoice numbering; implemented numbering is tenant/FY under the recorded one-GSTIN decision. Sentry/PostHog/Stryker dependencies/config are not evidenced in the current package/setup. | Mark future capabilities explicitly; align R1 text with confirmed scope, CSV-only import, tenant/FY numbering and actual observability. Do not treat unstarted setup tasks as completed. |
| `docs/unenforced-design-rules.md:58–64` | Describes the owner layout as checking only session existence. Current layout has role-to-surface checks and pages also guard reads. | Mark that section historical/superseded; the remaining direct-action resource issues are BE-03–BE-06. |
| `CLAUDE.md` dotenv guidance; `scripts/e2e-parent-link-zero-js.ts:44–67` | Guidance describes a shared loader honoring `AQUA_NO_DOTENV=1`; this E2E has its own loader that ignores that switch. | Align loader behavior or document the exception. Explicit disposable URLs and sanitized optional settings were supplied for the E2E in this review. |
| `Dockerfile:62` | Refers to removed `docker-compose.prod.yml`. | Point the comment to current release Compose files. |

Dated older audit/status reports are historical evidence, not all candidates for rewriting. The problem is when current execution instructions repeat their obsolete state. The new report also does not convert local source/tests into proof of a live backup/deployment.

## Suggested fix order

1. **Authentication and resource authorization:** BE-01/BE-02, BE-03–BE-06 and BE-12. Add negative action/HTTP tests using actual roles/context, not page-only checks.
2. **Cache confidentiality and data integrity:** FE-01; single-fresh-deploy grants BE-07; exact transfer rollback/date handling BE-09/BE-10; centralized audits BE-08; exact money bounds BE-11.
3. **Operational UI recovery:** FE-02–FE-05, newest parent history FE-06, parent contrast/labels/targets FE-07/FE-08; repair QA-01's clock/fixture isolation.
4. **Documentation and dependency disposition:** reconcile the current execution/status docs with verified shipped behavior and unfinished work. Re-run the full gate from one fresh deployment and relevant role/offline E2Es on the fixed artifact.

Roster exceptions, logout handling of unsynced marks, reception reversal visibility and money bounds need explicit product semantics before implementation. Live R2 round-trip/restore and actual VPS release verification remain unobserved; the current deployment runbook correctly records them as unfinished.
