# Remediation ledger — role, content and permission audit (2026-10-09)

Input: `docs/audits/2026-10-09-role-content-permission-audit.md`
(report SHA-256 `e84d308ec233297a090047f7dd9d88c9fd487573c586d80616c0dc5bdf0f94e0`).
Checkout: branch `fix/comprehensive-review-findings`, HEAD `870cf1a`, with the
audited unstaged/untracked work intact (diff digest reproduced before edits:
`bf24c9ba6901fb71673b5f738e426ae79aa33aab43beb0b6434f0424d6cde3f7`).
No commits, pushes, branch changes, worktrees or tier1 edits. The audit report
is unmodified. Changes are uncommitted.

## Approved product decisions (2026-10-10)

1. Accountant enabled with narrow financial entry + payer-only projection.
2. Human Worker: `staff.roster` removed (template + forward migration),
   `staff.self` retained, `/worker` self-service landing.
3. Single-location friend pilot; location guards still enforced in code.
4. Owner-escalation default for reception invoice void and historical staff
   correction.
5. Make-up credits kept, tightened (management grant, validated + audited
   redemption, serialized double-redemption protection).
6. Owner does not coach; owner-coach execution deferred.

## Finding status (final)

| ID | Contract implemented | Status | RED evidence | GREEN evidence | Review |
|---|---|---|---|---|---|
| A01 | `programs.write` + session location; full ctx; audit/notification preserved | verified | `tests/review-session-lifecycle-authority.test.ts` 2 failed (coach/reception/restricted-admin cancel+reschedule) | 8/8; tier1 session-lifecycle/reschedule/guard 66/66 | backend review: verified; substitution sibling fixed |
| A02 | manager grant, `visibleMember`, absent-source proof, target validation, row lock, `makeup.grant`/`makeup.redeem` audits, past-target + 23505 hardening | verified | `tests/review-makeup-authority.test.ts` 10 failed | 12/12; tier1 makeup 8/8 | backend review: verified; cross-batch redemption is the documented approved exception |
| A03 | shared `visibleMember` on progress read + assessment write + deep page | verified | `tests/review-assessment-scope.test.ts` 3 failed | 5/5; tier1 assessments/skill-framework 11/11 | backend review: verified |
| A04 | target staff location within caller scope | verified | `tests/review-staff-attendance-authority.test.ts` 5 failed | 6/6; staff board 9/9 | backend review: verified; insert-path audit times added |
| A05 | worker template `staff.self` only, home `/worker`; forward migration `20261010085740_worker_self_service_scope.sql`; `/worker` landing | green — **gate blocked by human-owned tier1 pin** | `tests/review-worker-authority.test.ts` 4 failed | 6/6 incl. migration simulation (tenant-custom home preserved, non-system untouched, idempotent) | human change required: `tests/tier1/roles-permissions.test.ts:107` `worker: ["staff.self"]` |
| A06 | issuer-target ordinal trust on reset AND relogin AND resend; token-free issuance audit | verified | `tests/review-owner-credential-issue.test.ts` 2 failed | 8/8; 40 neighbor tests; resend sibling fixed | backend review: verified; relogin audit/outbox tx not atomic (documented) |
| A07 | full ctx + allowed-location predicates on every dashboard aggregate/filter | verified | `tests/review-dashboard-scope.test.ts` 2 failed | 5/5 (incl. C02); tier1 owner-dashboard 9/9 | backend review: verified |
| R01 | void requires `settings.manage`; reception sees escalate copy | verified | `tests/review-invoice-void-authority.test.ts` 1 failed | 4/4; 368 neighbor tests; preamble 334/334 | backend review: verified |
| R04 | historical dates require `settings.manage`; reception today-only | verified | same file as A04 | 6/6 | backend review: verified; reception UI never offered a date picker |
| C01/R02 | accountant redirect to `/owner/fees`, permission-shaped nav, payer-only projection, action refuses full 360 without attendance.read/members.write | verified | `tests/review-accountant-projection.test.ts` 5 failed | 8/8; browser: lands on fees, no medical/DOB/guardian/consent, no plan-mutation tab | UI review: verified after fixes |
| M01 | reception current-day/site close summary (payments.record) + `/reception/close`, closed state, owner reopen only | verified | `tests/review-reception-close.test.ts` 5 failed | 5/5; browser closed state + "ask the owner" | UI review: refresh-after-commit copy fixed |
| M02 | `/reception/dues` narrow call list (invoices.read + location), 44px Call action | verified | same file (listDeskDues missing) | 5/5; browser list + ₹1,800 due | UI review: Call action added |
| C03 | invoice-based caption; café gated by `cafe.pos` + `payments.record`; close/dues entries | verified | component tests updated | reception browser: new caption, café hidden, entries present | UI review: verified |
| C02 | money/decision hero (recorded today, outstanding, overdue), needs-you ordering, cancelled-session exclusion, section rename | verified | C02 regression RED via missing `money` field | dashboard 5/5 + 29 neighbors; browser 390/1280 | UI review: retitled to "Payments recorded today", skeleton fixed |
| C04 | Announcements in Operations nav (messaging.send), same route from Settings | verified | — (config) | owner desktop browser: entry present | UI review: verified |
| C05 | closed/reopen state, dynamic reason help (>₹500), >₹2,000 owner rule, refresh-before-retry, busy release | verified | `tests/mobile/collections-report.test.tsx` 5 failed | 5/5; browser closed state with Reopen (owner) | UI review: inputs raised to 16px |
| C06 | honest documents copy, no internal task IDs; D01 one-login-role staff copy; D02 "Academy participation" vs "Paid plan" | verified | — (copy) | component tests; browser member page | UI review: verified |
| R03 | non-managers cannot target tenant-wide or out-of-scope audiences | verified | `tests/review-announcement-sender-scope.test.ts` RED | 7/7 (refusals with zero rows + owner positive) | backend review: verified |
| D01 | owner-coach execution path | deferred | — | — | decision recorded: owner does not coach for pilot; staff copy corrected |
| D02 | lifecycle semantics | copy verified; coupling rule deferred | — | — | product rule for billing/participation coupling deferred |
| M03 | guardian/consent withdrawal + retention/offboarding | **blocked — legal/counsel decision** | — | — | exact decision needed: who verifies guardian evidence, withdrawal/erasure policy, retention of financial records |
| M04 | owner business-audit review | verified (runbook) | — | `docs/pilot-operations-runbook.md` §1 | console optional later |
| M05 | parent venue + help, zero-JS preserved | verified | extended `tests/mobile/parent-recent-attendance.test.ts` RED (venue undefined) | 7/7; browser venue + help + no-JS screenshots | UI review: verified |
| M06 | ops monitoring/backup ownership | **blocked — external verification required** | — | runbook §2–3 | deployed monitoring/offsite restore remain human release conditions |
| A02 UI | Grant hidden without `programs.write` | verified | panel test | makeup panel test + browser (owner sees Grant) | UI review: verified |
| H01–H04 | structural/system-context items | partially addressed | — | `callerIsLegacySystem` documented; core-feature semantics decision deferred | H02 always-on-core decision still open; H03 guardian binding deferred; H04 scanners now green |

## Verification (2026-10-10)

- `pnpm typecheck` PASS · `pnpm lint` PASS · `pnpm build` PASS (100 routes,
  `/worker` included; max First Load JS 131 kB vs 150 kB).
- `pnpm test` (rebuilt disposable DB, 55433): **2686 passed / 9 failed /
  8 skipped / 2703 total**. Failure analysis:
  - `tests/tier1/roles-permissions.test.ts` (1) — human-owned pin, exact
    change above.
  - `tests/tier1/platform-auth-actions.test.ts` (7) — pre-existing legacy
    password/2FA Ops tests; this tree's Ops login is phone + WhatsApp OTP.
    Human-owned fixture/decision; unrelated to the remediation diff.
  - `tests/tier1/platform-tenants-list.test.ts` (1) — passes on a fresh
    disposable DB (verified on 55437); fails on the reused suite DB because
    the default-limit list pages the fixture out (the test's own comment
    documents this fragility).
- `tests/review-*.test.ts`: 15 files / 95 tests PASS (all nine findings +
  action-context forwarding + accountant projection + reception close).
- Production E2Es: `e2e:role-bypass` 25/25 (16 attacks + 9 controls);
  `e2e:host-boundary` all probes (needs a reachable DB — health returns 503
  without one); `e2e:parent-link-zero-js` PASS (0 scripts); `e2e:offline-privacy`
  exit 0; `e2e:platform-form-leak` 7/7 forms.
- Scanners: migrations, location-scope, tenant-conventions, ops-actions,
  runbook-sync, scripts-exist, focus-contrast, platform-leads, compose-secrets,
  dokploy/production compose, deploy-workflows — all PASS. `check:bundle`
  (100 routes) and `check:fonts` (55.2/60 kB) PASS.
- Browser acceptance (Playwright, fresh disposable demo DB + dev + worker):
  Owner 390/1280 (money hero, collections closed state, Announcements nav),
  Reception 390 (caption, café hidden, close/dues, invoice without Void or
  Reverse), Accountant (fees landing, payer-only member view), Coach 390
  (today + register), Ops 1280 (phone + WhatsApp OTP via capture mock, tenants),
  Parent 390 with JS disabled (venue, help, money, 0 scripts), `/worker` 404s
  for non-workers. Screenshots: `.playwright-mcp/audit-remediation/`.
- Console/server errors during acceptance: only the deliberate
  missing-member and `/worker` 404s.

## Reviews and their resolutions

- Backend review (Group 1): 1 High (`callerHasPermission` template fallback
  could override a revoked permission set) fixed; Mediums on resend gate,
  substitution scope, makeup target/23505, audit requestId/times, action-ctx
  forwarding, migration assertions — all fixed with tests.
- Backend review (Group 2): High action-map gap (`getMemberPayerAction` +
  two new actions) fixed and preamble 334/334; roster write-affordance,
  deleted-location filter, insert-path audit times fixed.
- UI review: P1 keyboard-focus ring on marine hero, input 15px→16px,
  accountant plan-mutation leak; P2 hero label, loading skeleton, close-day
  refresh copy, dues Call action; P3 date formats and a genuine duplicated
  "runway runway" accessible name — all fixed with pins.

## Footprint (uncommitted)

66 tracked files changed relative to the audit baseline plus 22 new files
(9 review regressions, 3 mobile regressions, 2 services-less pages, worker
route group, member-payer component, close-day component, 1 migration,
runbook + this ledger). Full list: `git status --short` / `git diff`.
Pre-existing user work was preserved; no tier1 file and no applied migration
was edited. One new forward-only migration:
`db/migrations/20261010085740_worker_self_service_scope.sql`.

## Human-owned and external blockers (release)

1. `tests/tier1/roles-permissions.test.ts:107` — update worker matrix to
   `["staff.self"]` (owner of that test).
2. `tests/tier1/platform-auth-actions.test.ts` — legacy password/2FA Ops
   expectations must be reconciled with the phone/WhatsApp flow (human-owned;
   not caused by this remediation).
3. M03 guardian/privacy legal decisions.
4. M06 real external monitoring + offsite backup/restore drill.
5. Real Ops/tenant transport for the friend pilot (capture mock only today).
6. Counter desktop/tablet acceptance decision; single-site pilot assumed.
7. `tests/tier1/platform-tenants-list.test.ts` fragility on reused suite DBs
   (passes fresh; human-owned test hygiene).
