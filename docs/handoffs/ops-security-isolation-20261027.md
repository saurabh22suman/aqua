# Ops authentication, credential audit and isolation — 27 October 2026

Status: requested fixes implemented locally; functional/independent review PASS. Dependency clearance CHANGES REQUIRED (baseline advisories). Final production-build attestation is external as described below. No commits, pushes, PRs, merges or deployment.

Owner: current Codex chat. Worktree: `/home/soloengine/thedutchrabbit/aqua-worktrees/ops-security-isolation-20261027`.
Branch: `fix/ops-security-isolation-20261027`; base/initial HEAD: `d1425e7f4dcdd31abe283c8d7e2d1f2b3fbf46c8`.
Independent of all three owner UI lanes and preserved Ops audit worktrees.
Inherited 24 harness paths plus coordinator queue/preview helpers are setup, not product changes.
Own disposable DB port 55584, web port 3184. Every heavy job uses lane_job.py and the shared machine lock.

## Acceptance and boundaries

- Shared, persistent Ops password attempt throttling, including unknown accounts and concurrent requests; generic refusals, expiry/recovery and failed-attempt audit without passwords, codes or bearer tokens.
- Operator login/reset credential issuance through opsAction with actor, tenant, target membership, purpose and expiry; audit succeeds before credential can leave the transaction. Denied/malformed/cross-tenant targets do not issue credentials. Never put platform IDs in tenant-user foreign keys.
- Runtime tenant RLS and location restriction tests: list and direct-ID paths, writes where supported, missing scope, pooled connection reuse, roles and no-location/system cases.
- Preserve configured credentials, existing tenant/member permissions, bigint money, consent and offline data. No new dependency/schema/architecture changes without authorization. Human approved password + authenticator; existing configured credentials are preserved.
- Strict intended RED before every implementation change. Only tests/tier1/platform-auth-actions.test.ts has explicit human approval for the MFA contract patch; other tier1 files remain untouched. Final independent review and appropriate serial gates required; report actual verification limits.

## Threat model

Attackers can submit arbitrary login identities/passwords concurrently, guess membership IDs or phones, and replay requests from stale/viewer sessions. Only validated platform sessions establish issuer identity. PostgreSQL transactions/advisory locks and existing audit storage must work across app processes. Logging must not create a bearer credential disclosure. Tenant GUC is set from authenticated server context; RLS is not a substitute for location authorization or protection against arbitrary SQL execution. Fixtures and fault injection target only this worktree's proven disposable DB.

## Checkpoint

Worktree and frozen harness provisioned. Dependency install passed. Disposable DB preparation queued; no production implementation changed yet. Preparing focused credential-audit RED tests while awaiting MFA preference.

## Initial RED and policy decision

Initial guarded tests:9 intended failures /1 pass before any product edits (`evidence/ops-security-20261027/red-initial.log`). Failures cover absent dual audit, audit failure returning credential, absent failed-login audit/lockout/concurrency/expiry, and session persisting after audit failure. Raw failure output is private: synthetic tokens were printed by the assertion framework; fixture sessions were removed. No real credential used.

Human approved password + authenticator MFA. Existing credentials preserved; legacy passwordless Ops endpoint must not bypass it. New MFA/password-spray intended RED queued before those implementation edits. Credential audit implementation is now in place and focused GREEN queued. No owner UI files changed.

## Checkpoint — core fixes and enrolment RED

- `green-security-1.log`: 16 pass / 5 fail. Credential audit and throttling were
  green; MFA lazy Drizzle query escaped ALS scope, and two new RLS verification
  queries had the same test harness mistake. Fixed by awaiting inside the scope;
  no scope guard, pool role or RLS policy was weakened.
- `green-core-red-enrolment.log`: core four files **21/21 pass**. New enrolment
  scaffold **2 intended RED / 1 pass** before enrolment implementation. Actual
  failure: preparation returned null instead of provisioning the existing user.
- Implemented non-destructive terminal-only enrolment after that RED. Current
  queued check: `green-enrolment-env.log`, includes all five security files plus
  both updated non-protected env login regression files. Not yet clean GREEN.
- Protected `tests/tier1/platform-auth-actions.test.ts` is unchanged. Prepared a
  proposed patch in chat outputs and requested explicit human permission under
  the Aqua TDD protected-path rule. Continue independent work while pending.
- Runbook: `docs/ops-authenticator-cutover.md`. Future deployment requires
  enrolment, verified proxy headers and revocation of old Ops sessions; none of
  these changes has been applied to staging/production or real credentials.

Human explicitly approved the prepared protected test patch in this chat.
Applied ONLY `tests/tier1/platform-auth-actions.test.ts` from the reviewed proposal;
other tier1 tests remain untouched. This updates the obsolete WhatsApp-only
contract while preserving validation, host/origin separation, deny-role,
suspension, expiry, replay, session identity and logout checks.

Independent read-only reviewer `ops_security_review` found no confirmed blocker
in the pre-refactor owned implementation, with additional verification requested
for expiry, reuse/concurrency and TOTP audit rollback. No tests were run by that
reviewer; root remains responsible for actual gates. Review excludes inherited
harness and later refactor until follow-up.

## Independent review follow-up and pending verifications

- Read-only review approved the helper extractions as behavior-preserving.
- Reviewer confirmed a newly reachable inherited pre-hydration defect: Verify
  is disabled from React's initial empty code state, so native input cannot
  enable it before JS loads. Own Chrome test includes an intended failing
  native-submit assertion. Do not change the form until that RED is observed.
- Reviewer identified browser setup cleanup outside the protected finally.
  Corrected the test driver so provisioning/launch/setup failures close owned
  browser handles and pools and remove synthetic fixture users where created.
- Supplemental MFA cases now cover expiration, completed/reused challenges,
  concurrent verification (one success), and audit-failure promotion rollback.
- Additional intended RED queued: suspended DB operator with an incorrect
  password must have the same public feedback as an unknown account. The DB
  path currently checks suspension before proving the password. No fix yet.
- Extended existing unprotected location fixture tests for unresolved/unknown
  identities, an empty location grant, and explicit background actor versus
  identified human. Existing default-off behaviour remains intentional; no
  configuration policy has been changed.
- The pending security check now also verifies the covered helper refactor.
  Its name `green-enrolment-env.log` predates the supplemental feedback RED;
  report actual per-test results, not a misleading all-GREEN label.

## Wider isolation regression milestone

- `green-security-location-regressions.log`: **480 pass / 3 failed**, 21 files.
  All core security, enrolment, both env login regression files, protected auth,
  RLS all-table/policy checks, user/membership scope, no-superuser, preamble,
  tenant audit and location suites passed except three adapted-test assumptions.
- Two failures were the old mocked owner-reset action's fake actor `u1` reaching
  the newly required audited pipeline. Updated the unit mock to assert trusted
  UUID actor/scope/tenant forwarding, retaining the real DB rollback/deny tests
  in credential-audit.test.ts. Added a viewer early-denial unit case.
- One protected-file expectation assumed malformed nonempty phone returned400.
  The disabled Ops endpoint deliberately returns403 before phone issuance logic;
  corrected to403, retaining invalid-empty400, no-send and origin/host denials.
  This is within the human-approved MFA test update; no other tier1 file changed.
- `green-regression-fixtures.log`: **24/24 pass**, all three affected files.
- Existing WhatsApp notification regressions were adapted to deny valid legacy
  Ops OTP completion and HTTP requests. Kept live OTP expiry, wrong-attempt,
  resend/replay protections on the continuing tenant PIN-reset flow. Consent,
  guardian selection, outbox isolation and delivery tests remain intact. These
  adapted WhatsApp tests have not yet been run.
- Quality gates queued next. Own Chrome check still pending; native Verify
  defect remains unmodified until intended browser RED is observed.

## Chrome/native-submit and one-time-code checkpoint

- `quality-3-browser-red.log`: typecheck, lint, Ops/action scanner, location
  scanner (142 service files), tenant conventions, all111 migration names and
  focus contrast passed. Initial Chrome eight functional scenarios passed.
- Initial fully JS-disabled native probe was **BLOCKED/readiness**, not product
  RED: Next15 streamed the form into hidden HTML without its inline reveal.
  Corrected the test to withhold client hydration bundles while allowing inline
  streaming reveal. `browser-native-red/results.json` then observed the actual
  intended RED: Verify remained disabled after six digits, false!=true.
- Changed only Verify pending-disable logic to rely on required/pattern native
  validation before hydration. `browser-green.log`: **Chrome9/9 PASS**,1280×900,
  including visible keyboard focus, wrong credentials/code, password-only denial,
  completed MFA, host-only cookie/apex404, legacy403, logout, viewer and native
  password+authenticator POST before hydration. Dev preview, not deployed.
- Pure auth helpers now use protected names `db/platform-auth-totp.ts` and
  `db/platform-auth-attempt.ts`; the existing auth protected glob still covers
  these extracted responsibilities. Other protected tests remain untouched.
- A further RFC6238§5.2 check found actual cross-challenge replay: a consumed
  code could complete a different valid password challenge. New
  `red-replay-and-regressions.log`: **2 intended RED / 23 PASS** (including
  adapted WhatsApp notification and Ops entry regressions).
- Implemented non-secret time-step replay state in the existing login audit,
  serialized by the existing account lock and user row lock, atomically with
  session promotion. No schema/dependency added. GREEN is queued, not claimed.
  Public pure verifyTotp API remains boolean; ledger check is in login verifier.
- Independent reviewer is inspecting this addition and has prepared a separate
  Chrome review in chat work/, awaiting final source freeze. Builder screenshots
  visually reviewed; live independent checks still pending.
- References: RFC6238§5.2 https://www.rfc-editor.org/info/rfc6238/ and PostgreSQL16
  transaction advisory locks. No certification or blanket security claim.

## Final-source regression checkpoint — 16:10 UTC

- `green-replay-regressions.log`: **10 files, 86/86 PASS** after the
  cross-challenge one-time-code fix. Covers all new security suites, protected
  platform authentication/action tests and adapted WhatsApp/Ops entry regressions.
- Independent follow-up found no concrete replay/concurrency/rollback defect in
  the counter ledger. The independent live Chrome job is queued against this
  frozen product source; evidence stays in chat work/, separate from builder proof.
- Full four-shard suite and final quality checks queued through the shared slot.
  Auth form-leak/host-boundary, dependency audit and final build/font evidence are
  still pending. No full-gate success is claimed at this checkpoint.
- Owned inventory: 37 files excluding evidence and 26 unchanged inherited
  harness/runner paths; no dependency, schema or migration change. Inventory
  lives in chat work/ops-security-owned-files.json.
- Owner work remains separate. Reviewed dependency refresh snapshot
  `20261027T160825Z` transfers four shared fixes with previous-hash guards and
  backups. Owner combined acceptance remains pending; it is not part of this
  Ops security worktree.

## Complete-suite and independent review checkpoint — 16:45 UTC

- Full guarded sharded suite: **469/469 files, 3869 pass, 0 fail, 1 skip**.
  The one inherited live R2 round-trip is disabled because object-store
  credentials are absent. No store request was made; no new skip was introduced.
- Final quality phase passed: typecheck, zero-warning lint, Ops scanner,
  location scanner142services, tenant conventions,111migration names and
  focus contrast. No package/lock/schema/migration changed.
- Independent reviewer completed **6/6 actual Chrome scenarios**, exit0,
  and separately inspected all six screenshots: functional PASS and visual PASS
  at1280×900. Pending authority denial, real completion, errors/focus, keyboard
  logout and pre-hydration native submissions verified. No hydrated console
  warning/error or pageerror. Redirect ERR_ABORTED requests and deliberately
  withheld native-probe bundles are classified rather than hidden.
- The first independent run was a reviewer state mistake: React reset the
  uncontrolled email on error and the script refilled only Password. Native
  validation prevented a second POST. Baseline login-form.tsx is unchanged;
  the corrected script refills both fields. Original failure evidence retained.
- Existing server-side React method/function-action dev warning confirmed at
  base d142; explicit POST is intentionally preserved by H1 coverage.
- First adapted H1 e2e stopped on a **test locator ambiguity**, not a credential
  disclosure: Next route announcer and actual code error both have role=alert.
  Changed only this e2e's locator to require the actual Invalid/expired text;
  auth-e2es rerun queued. Production and Vitest test source remain unchanged
  since the complete suite; final build will type/lint-check the driver too.
- `pnpm audit --prod --json` exited1 with **34 pre-existing advisories**:
  1critical,11high,18moderate,4low. Package,lock,Next config and Dockerfile bytes
  equal the verified base. New dependency risk introduced by this change: none.
  Dependency clearance remains CHANGES REQUIRED, not a waived green gate.
- Critical Next/sharp advisory describes SVG optimization on glibc Linux.
  Declared runtime is node22-alpine, default SVG optimization is disabled and no
  next/image usage was found. This source assessment is not proof about the
  running deployment or an exploit test. More directly applicable: the high
  Next Server Actions CPU-denial advisory matches the app's features. Maintainer
  minimum patched15.x version is15.5.28. A separate dependency patch is needed
  before release; no automatic upgrade/Next16 migration was performed.
- Full assessment and primary links: chat work/ops-security-advisory-assessment.json.
  Final build/font attestation is still pending and must use an external log so
  the source/build receipt cannot invalidate itself. No deployment authorized.

## Pre-build handoff freeze

- H1 rerun PASS: all8forms retain POST; live native password, wrong-authenticator
  action response and gated invitation POST contain no credential in URL/body.
  The only intervening source edit was a more specific test-driver error locator;
  no production or Vitest test source changed after the full3869-test run.
- Host-boundary e2e PASS for configured and legacy host pairs, encoded paths,
  endpoint allowlists and same-host entry redirects. Startup connection refusals
  are bounded readiness retries, not failed assertions.
- Independent live/visual review complete. Implementation, source/test review,
  disposable RLS/location verification and final quality checks are complete.
- Final build/bundle/font job runs after this handoff is saved, with logs outside
  this worktree. To preserve the exact build receipt, this file is not edited
  after that job. Its actual result and BUILD_ID are recorded in the chat's
  `work/ops-security-final-results.json` and user output
  `outputs/ops-security-local-review-20261027.html`. If those attestations are
  absent, final build completion has NOT been established.
- Main/regional environments, real operator credentials and tenant/offline data
  remain untouched. Future enrolment and old Ops-session revocation are planned
  cutover steps only. Owner integration/Chrome acceptance remains a separate
  unfinished task, with its own supervision record and recurrence.
