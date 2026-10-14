# Aqua role, content, responsibility and permission audit

**Date:** 2026-10-09. **Audited branch:** `fix/comprehensive-review-findings`. **Audited HEAD:** `870cf1a22f6423362965ca20cd413783bc4afc4f`. **Includes:** committed checkout, all existing unstaged product changes and relevant untracked product/remediation files. **Audit only:** no product fixes, repository test edits, new migrations, commits, pushes, PRs, branch changes or deployments.

## 1. Executive verdict

**Friend pilot: NO-GO for real academy records or collections.** The primary Owner / Reception / Coach / bearer-link Parent separation is appropriate, but important sibling workflows still mistake an attendance permission for management authority, omit assignment/location checks, or give a lower-trust role a higher-trust credential. Several previous defects are genuinely fixed in this working tree; they must not be counted again as open defects.

This audit identifies **7 authorization defects**, **4 additional incorrect product-role assignments**, **6 missing responsibilities**, **2 duplicated/ambiguous responsibilities**, and **6 content/navigation issues**. Counts are disjoint finding IDs; consequences of an authorization defect are not counted again as additional role findings. No Critical cross-tenant compromise was demonstrated. High and Medium findings below distinguish actual authorization failures from desired product-policy changes.

| Assessment | Verdict | Meaning |
|---|---|---|
| Current role design | CONDITIONAL GO | Keep the main actors, narrow management authority, postpone unsupported human Worker/Member experiences, and resolve Accountant landing. |
| Current authorization model | NO-GO | Seven evidenced same-tenant authority/scope defects remain, despite positive isolation and earlier-fix evidence. |
| Content assignment | NO-GO | Accountant lands on an unauthorized home; counter closing is in the Owner workflow; Owner home prioritizes registers over money/exceptions. |
| Local synthetic UX testing | CONDITIONAL GO | Appropriate in an isolated disposable environment; passing component/service tests are not a completed browser UX acceptance. |
| Friend pilot | NO-GO | Close the listed authorization/core-counter blockers and release evidence gaps before using real data or money. |
| Production | NO-GO | Additionally resolve real Ops OTP transport, privacy/offboarding decisions, deployed backup/restore, current complete gates and human approval. |

**Most important role changes:** (1) Coach marks/assesses assigned resources only; session management and makeup entitlement decisions belong to management. (2) Administrator cannot obtain an Owner bearer login/reset credential. (3) Reception owns a scoped counter close, not unrestricted historical staff correction or invoice void authority. (4) Accountant gets a financial entry and minimal payer data rather than the Owner/member-360 frame. (5) Human Worker has self-service only, never roster/leave approval authority; background jobs remain separate system actors.

## 2. Current branch, HEAD and comparison provenance

Commands executed without fetching or changing refs:

```text
git status --short
git branch --show-current
git rev-parse HEAD
git log -1 --oneline
git diff --stat
git diff --cached --stat
git diff origin/main...HEAD --stat
git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'
git log origin/main..HEAD --oneline
git rev-list --left-right --count origin/main...HEAD
```

- Branch: **`fix/comprehensive-review-findings`**.
- HEAD: **`870cf1a22f6423362965ca20cd413783bc4afc4f`**; latest commit: `870cf1a fix(ui): sweep findings — a11y labels, 44px targets, ops SW guard, favicon`.
- Upstream: **not configured**; the upstream command returned that explicit error.
- Existing local `origin/main`: `0118f2b359c30fd67036ccc0f479e3ca6edaea88`. This ref was used **only for comparison**, not as audit input.
- Merge base: `9228d52341dbad38ab750b4ce5a0e51747e591f7`.
- Divergence: **2 commits only on the existing origin/main ref, 1 only on the audited branch**. Branch-only commit is `870cf1a`; comparison-only commits are `3ef0624` (squashed UI sweep #194) and `0118f2b` (enrolment/roster/link boundary #195). Do not equate this divergent checkout with remote main, or assume the remote fix is installed here: current local fixes were read directly.
- Committed branch difference from merge base: **55 files, 197 insertions, 151 deletions**. Primarily UI labels, inputs/targets, icon and middleware/SW host handling.
- Staged difference: **none**.
- Unstaged tracked difference: **141 files, 2,446 insertions, 2,083 deletions** at capture.
- Untracked: **156 individual files** at capture, including tooling skill trees and product/remediation files; relevant paths are enumerated in Appendix A.

Finding provenance notation: **C** = present in committed HEAD code; **U** = existing unstaged changes; **N** = existing untracked files. A finding can involve an unchanged committed action and a modified service; that is labelled **C + U**, not falsely attributed entirely to new remediation. There were no staged findings because the index was clean.

## 3. Working-tree preservation and verification method

Files were read from the current working directory. Previous September/October reports were hypothesis lists, not current truth. Relevant reads included `PRODUCT.md`, scope/architecture/design, `docs/how-it-works.html`, implementation/role-surface plans, release/remediation checklists, all route path inventories, role/permission/feature seeds, schema index and critical schemas/migrations, seed scripts, action map and high-risk actions/services/jobs, UI panels and existing tests/scanners.

Preservation checks repeatedly hashed tracked **and** untracked files under `app`, `components`, `db`, `lib`, `worker`, `scripts`, `tests`, `docs`, plus `DESIGN.md`, `PRODUCT.md`, `middleware.ts`, `package.json`, excluding this new report. Baseline aggregate SHA-256:

```text
d4dcc6ef26396d38b3a00b0fd8ce4c39b8d9e4be9a2f7282ef2eb1d4b3468067
```

Tracked status digest: `2258425f5b6108600490df5f7a80a0d73999a5052f68a5166a31d3ef6561d10f`. Unstaged diff digest: `bf24c9ba6901fb71673b5f738e426ae79aa33aab43beb0b6434f0424d6cde3f7`. These remained unchanged through the final source review. No unexpected source path changes were detected. Build-generated ignored `.next` artifacts are excluded; see the unsuccessful production E2E attempt below.

### Checks performed in this audit

All database mutation checks used new Testcontainers PostgreSQL 16 instances and synthetic identities. Existing `aqua-db`, the existing WhatsApp verification DB, and real academy records were not reset or seeded by this audit. `AQUA_NO_DOTENV=1` prevented script dotenv fallback; tests needing import-time environment validation received a deliberately unreachable dummy app URL when their database calls were mocked. No real messages were sent.

| Check | Current observation |
|---|---|
| Eight focused existing test files | **28 unique tests pass** after correcting audit-run environment configuration; includes resource/roster, action context, first-deploy grants, offline identity/action, reversal visibility, owner shell and parent recent attendance. |
| Initial focused run | 26 passed / 2 failed because `DATABASE_URL` was absent in mocked action imports. The two affected files then passed 4/4 with the dummy URL. This was a harness environment problem, not an application failure. |
| `tests/tier1/isolation.test.ts` | **5/5 pass** on its own disposable container: current isolation/schema/role checks. The protected test was executed, not modified. |
| Temporary independent reproduction suite | **8/8 pass**, meaning the unwanted operations were reproduced, not that the product is safe. Files only in `/tmp/opencode/aqua-role-audit.{config.mjs,test.ts}`. |
| `pnpm check:location-scope` | PASS; does not detect the reproduced semantic location/assignment gaps. |
| `pnpm check:tenant-conventions` | PASS; 37 convention-scoped migrations. |
| `pnpm check:ops-actions` | PASS; action pipeline coverage, not proof every possible mutation is atomic. |
| Production `pnpm e2e:role-bypass` attempt | **Inconclusive: build failed before HTTP cases**, with missing generated modules for `/owner/batches/[batchId]` and `/owner/enquiries/[enquiryId]`. An existing `next dev` process shares `.next`; no clean isolated build was established. It was not stopped. Do not count this as a proved product defect or a passed role E2E. |
| Full suite / viewport browser acceptance / zero-JS artifact / host E2E | Not completed in this audit. Historical evidence is explicitly separated below. |

Exact focused command:

```bash
AQUA_NO_DOTENV=1 NODE_ENV=test pnpm exec vitest run \
  tests/review-action-scopes.test.ts tests/review-resource-integrity.test.ts \
  tests/db/first-deploy-grants.test.ts tests/offline/identity-isolation.test.ts \
  tests/mobile/invoice-reverse.test.tsx tests/mobile/owner-shell.test.tsx \
  tests/mobile/parent-recent-attendance.test.ts tests/auth/offline-scope-action.test.ts
# Rerun the two environment-affected files with:
AQUA_NO_DOTENV=1 NODE_ENV=test \
DATABASE_URL=postgresql://app_login:unused@127.0.0.1:1/aqua_audit_no_connection \
pnpm exec vitest run tests/review-action-scopes.test.ts tests/auth/offline-scope-action.test.ts

AQUA_NO_DOTENV=1 NODE_ENV=test \
DATABASE_URL=postgresql://app_login:unused@127.0.0.1:1/aqua_audit_no_connection \
pnpm exec vitest run tests/tier1/isolation.test.ts

AQUA_NO_DOTENV=1 NODE_ENV=test \
pnpm exec vitest run --config /tmp/opencode/aqua-role-audit.config.mjs
```

The independent probes checked actual seeded grants, then services with the action's exact context shape or its full Ctx. They are **not authenticated HTTP Server Action replays**. They established: unrelated-session cancellation; absence-free makeup grant/no audit; unrelated-member assessment read/write; other-location staff correction; human-worker shift creation; restricted-admin dashboard leakage; admin Owner reset-token issuance; and always-on core versus disabled billing permission semantics. Temporary fixture setup was corrected to include the required `membership_locations.id` before the final 8/8 run.

Historical `docs/review-fixes-status.md:105–155` reports 332 files, 2,565 passed / 7 failed / 8 skipped, production build/budget/offline/host/role-browser results and human-owned fixture follow-ups. That is **prior-session evidence**, not a green current complete gate asserted by this audit.

## 4. Competitor research: method, sources and applicability

Research preceded role judgments. **Nine comparable products** were investigated using current-access public primary sources. Access date for all entries: **2026-10-09**. Agent-reach Exa returned official help/product excerpts; Jina fetched the Sportzy and ArenaFlow live public pages. Exa subsequently rate-limited a KheloMore search (HTTP 429); it was replaced with independently discovered Indian academy products, not counted as researched. Agent-reach update check reports installed v1.5.0 current.

Evidence limits: official marketing proves a public claim, not a working authorization implementation. Seven products below were examined through returned official-source search excerpts, not authenticated demos/full help-centre crawls. No independently verified recent review sample was obtained, so **common complaints are unverified for every product**. Vendor testimonials and vendor descriptions of manual pain are not presented as independent user-review complaints. No pricing, security certification or market-share claim is used as an audit premise.

| Product / primary sources | Market and business | Public roles and Owner capabilities | Reception / Coach / Parent-member | Finance and multi-location | Strength / complaint evidence / Aqua lesson |
|---|---|---|---|---|---|
| **TeamUp** — [permissions](https://support.goteamup.com/en/articles/9327561-edit-staff-member-permissions), [staff setup](https://support.goteamup.com/en/articles/9327385-adding-staff-member), [instructors](https://support.goteamup.com/en/articles/9327607-creating-instructors-and-adding-them-to-classes-appointments-and-courses) | Global gyms, studios and class businesses | Admin vs Limited Permissions; Instructor is an additional attribute. Admin can grant section access. | Counter role can be assembled from customer/payment/session permissions; instructors can manage all or only sessions they instruct; attendance can exclude payment details. Parent-specific capability not established by these sources. | Separate Revenue, Customer Payments, Discounts and attendance grants. Customer list remains account-wide; multi-location restrictions not verified here. | Clear instruction scope is primary-source evidence. Complaints unverified; documented account-wide customer permission is a known limitation, not a review complaint. **Lesson:** separate attendance from finance and session-management authority. |
| **Upper Hand** — [custom permissions](https://help.upperhand.com/customize-staff-user-permissions), [user permissions](https://help.upperhand.com/user-permissions), [staff management](https://upperhand.com/software/staff-payroll-management/) | Global sports facilities, camps, lessons | Admin controls permissions; current custom permissions offer No Access / View Only / Full Access. | Staff can check in/book clients, POS and pay balances in documented defaults; limited staff own calendar/availability; coach offerings have distinct access. Family-specific mapping not fully public in retrieved material. | Reports/orders and payroll separated; location restriction details unverified. | Current custom-permission article supersedes the older statement that presets cannot be customized. Complaints unverified. **Lesson:** view access and execution access should be distinct; don't copy broad default coach/counter grants blindly. |
| **Mindbody** — [staff management](https://www.mindbodyonline.com/business/staff-management), [permission groups](https://support.mindbodyonline.com/s/article/203253763-Permission-groups), [location/settings permissions](https://support.mindbodyonline.com/s/article/Staff-Permissions-Settings?language=en_US), [desk permissions](https://support.mindbodyonline.com/s/article/203253663-Common-Permissions-for-Desk-Staff) | Global fitness, wellness, studios | Owner, managers, staff and configurable groups; group-specific launch tabs. | Front desk check-in/POS; instructors client schedules with limited admin; client services rather than a verified child-specific role model. | Location switching and all-location report access explicitly separate; cash-drawer/current-day and closeout permissions documented. | Granular and potentially complex; documented location-switch interactions need care. Complaints unverified. **Lesson:** reception needs narrow daily closeout without all financial reporting. Its broad refund recommendations are optional permissions, not a reason to give Aqua reception refunds. |
| **Classcard** — [role controls](https://help.classcardapp.com/en/article/managing-access-levels-for-staff-profiles-1sjrlxv/), [swim school](https://www.classcardapp.com/solutions/swim-school), [product](https://www.classcardapp.com/) | Academies/activity centres, swim schools; relevant Indian/global class-management segment | Owner, Admin, Front Office, Sales, Teacher, Teaching Assistant; owner controls access. | Front-office and teaching roles distinguished; scheduling, attendance/self-check-in, leads and branded student web app advertised. Specific guardian-linked authorization not verified. | Tax/pay-rate access separately controlled; branch creation permission; exact cross-branch isolation not verified. | Strong swim/class workflow match. Complaints unverified. **Lesson:** front office is an actual work role, not a reduced Owner dashboard; pay/access administration should stay restricted. |
| **LoveAdmin** — [administrators](https://loveadmin.com/software/features/for-administrators/), [parents](https://loveadmin.com/software/features/for-parents/), [swim schools](https://loveadmin.com/who-we-help/swim-school-software/), [2025 changes](https://loveadmin.com/software/removing-friction-from-club-management/) | UK clubs, children's activities and swim schools | Administrators manage registration, contacts, invoices, consents and communication; access limited to necessary data. Exact Owner/reception/accountant role names not established. | Parent JoinIn account: bookings, child's schedule/progress, personal information/consent, payments. Teachers receive notifications/registers; reception-specific ACL unverified. | Payment reminders/retries, invoice/refund/credit views; multi-site ACL unverified. | Relevant family and missing-consent workflow. Release article improves status visibility. Complaints unverified; vendor case studies are not independent complaints. **Lesson:** parents need understandable next session, fees and contact routes; don't require the competitor's app/account for Aqua's pilot. |
| **SportsEngine** — [types](https://help.sportsengine.com/en/articles/6304495-types-of-permissions), [grant permissions](https://help.sportsengine.com/en/articles/6304301-how-to-grant-permissions-to-members), [team staff](https://help.sportsengine.com/en/articles/10509438-edit-team-staff-roles-and-permissions) | Global/US sports clubs, youth teams, leagues | Organization admin/full/limited HQ access; team rights separate. Real-world role titles do not themselves grant HQ access. | Team staff can have roster, scheduling, scoring or view-only grants; family/member workflow exists in the sports context, but full parent finance mapping was not retrieved. Reception is not a directly comparable club role. | Team grants explicitly do not grant Financials/HQ tools. Location/branch equivalence is teams, not proved geographic restrictions. | Excellent organization-vs-team boundary. Complaints unverified. **Lesson:** a role title and a resource grant are separate axes; don't import league/compliance bureaucracy into a small academy. |
| **ClubRight** — [staff levels](https://help.clubright.co.uk/en/articles/15503611-setting-up-staff-users-and-permissions) (published June 2026) | UK gyms and membership clubs | Owner, Manager, Business, Staff, Trainer; Owner settings/reports/integrations; Manager day-to-day operations; Business KPIs. | Staff member profiles/plans/till/diary but no settings/reporting; Trainer restricted functionality; guardian-specific flow unverified. | Owner financial reporting; front-of-house till without reporting. Multi-location ACL unverified from this source. | Individual logins preserve attribution. Some Trainer till permissions are broader than Aqua needs. Complaints unverified. **Lesson:** own accounts even on a shared counter; financial reports are not necessary to take a payment. |
| **Sportzy** — [academy management](https://sportzy.in/academy-management-software/) (live page dated September 2026) | Indian multi-sport academies, single and multi-centre | Admin multi-centre dashboard, enrolment/trial conversion, batch/report management. Public exact receptionist/accountant permissions unavailable. | Coaches mark attendance and assess; parents see attendance/progress and receive WhatsApp updates. | Invoices/installments/outstanding alerts; centre-wise students/coaches/schedules/fees/reports. Cash-specific role controls not verified. | Strong Indian academy workflow match. Vendor cites scattered cash/transfers/WhatsApp as pain, not independently proven complaints. **Lesson:** mobile coach execution and reception follow-up with owner centre oversight. |
| **ArenaFlow** — [product](https://arenaflow.in/) (live page) | Indian academies, including swimming; owner-coaches and multi-centre chains | Owners, managers/sub-owners, coaches; mobile/web reports, enquiries and multi-centre operations advertised. | Coach attendance, parent portal/alerts; specific reception authorization not public. | Razorpay/UPI receipts, fee reminders, centre P&L and location-wise roles advertised; payroll add-on. | Indian phone-first operational fit. Public pricing text is internally inconsistent, so pricing was not used. Complaints unverified. **Lesson:** owner-coach needs a usable combined work path; payroll/P&L marketing does not make either a pilot requirement. |

### Expectations versus inspiration

- **Common expectation:** individual staff identities; counter admissions, payment recording and daily close; assigned coach attendance and progress; owner configuration/oversight; family-scoped understandable information; location filtering; reasons and accounting history for sensitive corrections.
- **Useful inspiration:** permission-shaped launch pages; front-office workspace; separate cash-drawer closeout grant; learner safety information on the coach's assigned record; honest delivery status and owner exceptions.
- **Unnecessary for this pilot:** parent-installed apps, gateways/e-mandates, league rostering/compliance, payroll commissions, marketing automation, RFID/geofencing, custom permission builders, enterprise approval chains.
- **Unverified:** each vendor's real backend scope enforcement, offline isolation, accountant-specific ACL, and common review complaints. Do not imply any is more secure than Aqua merely from marketing.
- **Stale Aqua claim:** `docs/project-scope.md:26` and `docs/how-it-works.html:138–139` claim competitors give everyone the same dashboard. Primary role documentation contradicts this blanket statement. Retain role-shaped UX as a design requirement, not an unsupported exclusivity claim.

## 5. Actual current Aqua roles and charters

Authority is determined by current seeds plus `requirePermission`, not role labels alone. Existing tenant grants may differ: `lib/services/roles.ts:148–151` deliberately never overwrites an existing role. No existing real tenant ACL was inspected. Matrices describe the **current seeded template**, then current service/UI exceptions.

| Actor | Current purpose, surface and navigation | Read/write/action scope | Financial / staff / feature / device boundary |
|---|---|---|---|
| Platform Ops admin | Provision tenants, presets/features/config, leads, tenant status/recovery, platform activity. `/ops` separate host; Overview/Tenants/Features/Presets/Leads/Activity; mock WhatsApp in non-production. | Platform-wide control-plane scope; no normal academy attendance/invoice/payment execution UI. Platform `admin` vs `viewer` is separate from tenant Administrator (`db/schema/platform-users.ts:33`). | Platform metrics are nightly snapshots with `asOf`, not live business profit. Ops cookie host-only, 8 hours (`lib/auth/platform-cookie.ts:3–24`). Mutations use platform actor/audit pipeline. Desktop 1280×900. |
| Academy Owner | Full seeded permission set; `/owner`; Home/Members/Reports/Settings on mobile; desktop Main/Operations/Insights/Account including Fees, Enquiries, Programs, Staff. | Tenant business records and mutations, optionally scoped locations. Cross-surface `/coach` and `/reception` are refused even for an owner who coaches. No routine attendance-marking Owner register is evidenced. | All finance/staff authority, including future pay grants. Report/billing/vertical entitlements apply; six core modules forced always-on. Phone 390×844 and desktop 1280×900. |
| Academy Administrator | Distinct seeded role and membership, same Owner surface. All permissions **except** `staff.pay.read/write` (`roles.ts:23–29`). | Same daily management and sensitive settings/reversal/invitation powers as Owner; may be location-restricted. Current reset-link gate also grants access to Owner credentials (A06). | Can issue/reverse payments, reopen cash and configure tax/payment QRs. No separate Admin dashboard/navigation or verified role-editor UI. Same Owner device frame. |
| Accountant | Financial actor seeded with invoices read/write, payments read/record/refund, financial **and operational** reports, pay read, own staff self-service, `members.read`, `settings.read` (`roles.ts:32–56`). | Routed to `/owner`, but lacks `dashboard.view`, so home's dashboard action fails. Direct financial routes may work; member detail performs unconditional attendance reads that Accountant lacks. Backend member-detail read exposes medical/DOB/guardian/consent data (R02). | No member/staff/settings mutations; still has financial reversal authority. Payroll read grant exists without completed payroll UX. Needs desktop, currently forced through Owner frame/navigation. |
| Receptionist | Front desk; `/reception` Today/Add member/Enquiries/Me, Today links to lookup/collection/café. | Members/guardians/consent capture, subscription/enrolment/transfer, enquiries/trials, attendance/student check-in, invoice issue/void, payment record, staff correction, own check-in/leave. Location-aware where implemented; default config is tenant-wide. | No payments.refund/read or financial reports; invoice payment history still readable via `invoices.read`. Can confirm cash by action but cannot reach closeout page/read report. Has messaging.send but no reception composer. Shared device, 12-hour non-sliding role session cap; DESIGN targets 390×844 despite scope's counter desktop description. |
| Coach | `/coach`: Today/Schedule/Members/Me; assigned register, progress/assessment, guardian emergency contact and medical notes for assigned learners. | Attendance read/mark, assigned member read, program read, levels read/assess and own staff self-service. Intended assignment scope enforced in register/history but not assessment/makeup/session lifecycle siblings. | No business money, member editing or staff management. Own shift/check-in/leave only by intended charter. Phone 390×844, poolside, offline register when tenant enables it. |
| Human Worker / ground staff | Seeded tenant role named Worker, home `/parent`; actual content is ParentLinkExplainer, no task or worker self-service dashboard. | Has `staff.roster` **and** `staff.self`; roster key also permits create/delete/publish and leave/type approvals (A05). No member/money access by seed. | Placeholder is not a supported task/maintenance experience. No dedicated device acceptance; intended minimal phone workflow. Must not be confused with the background worker. |
| Parent/guardian | No meaningful tenant staff role template; supported `/p/[token]` raw HTML and child receipt handler. | Verified seven-day bearer link selects one tenant + member. Next session, month/recent attendance, absence alert, runway, outstanding invoices, payment records and PDFs. No mutations. | Bearer possession, **not a guardian login or per-request guardianship verification**. Parent receives three children as three links. No Pay Now, no staff nav, zero-JS production contract, phone/WhatsApp-first. |
| Student/member | Member/person record and optional linked global identity; no seeded student/member self-service permission bundle or useful separate portal. | No normal staff actions; adult self-view could use a member-scoped bearer link by product policy. Printable member identity QR is not an implemented member attendance scanner. | Do not promise student app/payment/booking experience. No supported independent Member viewport beyond proposed read-only link. |
| Background worker / system | pg-boss, no human login/navigation. Tenant-ID scheduled jobs; special aggregate platform snapshot; exports/checkpoints/heartbeat. | System calls use scoped DB transactions, not human Owner sessions. Some services still treat missing user as a system caller, structurally ambiguous (H01). | Runtime app_login/app_user, not migration credentials (`worker/index.ts:33–69`). Notification dispatch rechecks consent/location/assignment. No browser target. |

### Scope mechanics that materially change the role model

1. Tenant RLS is a **tenant boundary**, not a role/assignment/location boundary. `withTenant` sets transaction-local tenant context; composite FKs do not prove a member is on a coach's roster.
2. `access.location_scoped_staff` defaults **off**. When on, explicit membership location lists constrain participating services; `allLocations=true` stays unrestricted; NULL locations mean tenant-wide (`lib/services/location-access.ts:17–26,42–118`). A facility switcher only filters a view and must never be mistaken for authorization.
3. `requireDefaultCtx` selects one active membership in priority order; it is not a role union or explicit tenant/role switch. `tenant_memberships` has unique `(tenant_id,user_id)` (`db/schema/memberships.ts:39`); `staff` can have several job-type rows, which is a different concept.
4. Permission+feature checks use the closed 34-key catalogue. `hasPermission` checks **only a role grant**; `requirePermission` also gates non-core modules (`lib/auth/permission.ts:58–90`). UI must use both where necessary.
5. No distinct “suspended role” status exists. Membership status is invited/active/revoked; platform identity status includes suspended. Role soft deletion and tenant suspension should have explicit negative regression evidence before release; they were not comprehensively exercised here.

## 6. Route, navigation and content inventory

Paths below are the current source inventory, including untracked routes. `page.tsx` is beneath the named route group, except login/reset/check-in. Every important exception is cross-referenced to a finding. This is not a claim that every route/form/state was exercised in Chromium.

| Surface | Current routes/pages | Content/actions and placement |
|---|---|---|
| Owner/Administrator/Accountant frame | `/owner`, `/owner/onboarding`; `/owner/members`, `/new`, `/import`, `/[memberId]`, `/[memberId]/edit` | Registers hero; member/attendance/batch stats; attendance/collection trends; follow-up/cash/register attention; admission/import; member Overview/Payments/Progress/Notes/Documents. Inline edits, lifecycle, enrolment/transfer/waitlist, subscription, facility opt-ins, makeup, parent link, printable ID. Accountant has unguarded affordances and denied prerequisite reads (C01). |
| Owner scheduling | `/owner/programs`, `/owner/batches/[batchId]`, `/owner/sessions`, `/owner/schedule` | Program/batch creation/edit/deletion, coach selection, capacity, waitlist, cancellation/reschedule/substitution, read-only weekly grid. No Owner poolside register. |
| Owner money/reporting | `/owner/fees`, `/owner/reports`, `/owner/reports/collections` | Fees overview/dues/invoices/transactions/plans; issue/pay/void/reverse in member panels; attendance, trend, mix, enquiry funnel, retention, coach load, facility utilization, plan revenue and collections charts. Collections report has physical cash confirmation; close history/reopen action lacks a usable evidenced UI. Expenses/P&L not a completed accounting module. |
| Owner staff | `/owner/staff`, `/new`, `/[staffId]`, `/invitations`, `/invitations/new`, `/roster`, `/leave`, `/check-in-qr` | Directory, staff create, invitations/revoke/resend/login link, role/location chosen during invite, shift templates/roster/publish, leave decisions, premises QR; co-owner recovery at staff foot. No complete post-invite role/permission management UI demonstrated. |
| Owner communication/growth | `/owner/announcements`; `/owner/enquiries`, `/[enquiryId]` | Announcement composer/inbox; audience all/batch/parents; enquiry capture/stage/follow-up/trial/conversion. Announcements buried in Settings. |
| Owner settings | `/owner/settings`, `/academy`, `/branding`, `/terminology`, `/locations`, `/holidays`, `/configuration`, `/activities`, `/skills`, `/plans`, `/payment-qrs`, `/menu`, `/alerts` | Academy/tax profile, runtime branding/vocabulary, locations/business hours, closures, registry values/change requests, facility activities/sub-units, assessment ladder, plan pricing, counter QR, café menu, absence threshold. Sensitive tax/payment/settings authority is broad Admin+Owner. |
| Reception | `/reception`, `/members`, `/members/new`, `/members/[memberId]`, `/enquiries`, `/enquiries/[enquiryId]`, `/collect-payment`, `/cafe`, `/me`; `/bookings` intentionally 404 | Today/session count; lookup/admit/enrol/subscribe/issue/pay; guardians/consent/contact destinations; enquiries/trials/follow-up; student/staff check-in; café cart/bill/settlement; own identity/shift/leave/check-in/sign-out. No close-day or overdue queue. Hidden bookings remain action-callable with grants. |
| Coach | `/coach`, `/schedule`, `/register/[sessionId]`, `/members`, `/members/[memberId]`, `/members/[memberId]/assess`, `/me` | Next/today sessions, roster progress, present/late/absent, mark-all/undo and auto-save/offline status, assigned learner safety/contact/attendance/absence/progress, four-band assessments, own shifts/leave/check-in/sign-out. Assessment page only guards Coach surface and levels permission, not actual member assignment (A03). |
| Worker placeholder | `/parent` | ParentLinkExplainer shown to human Worker; no worker task/maintenance/self-service home. |
| Parent | `/p/[token]`, `/p/[token]/receipt/[paymentId]` | Raw escaped HTML, academy branding, child, next session/time/batch/coach, attendance, runway, invoice/payment/receipt view. No full multi-session schedule, location field in next-session DTO or progress payload (`parent-view.ts:27–34,93–95,388`). |
| Ops | `/ops/login`, `/verify`, `/ops`, `/tenants`, `/tenants/new`, `/tenants/[tenantId]`, `/configuration`, `/entitlements`, `/locations`, `/tax`, `/messaging`, `/audit`; `/features`, `/presets`, `/presets/[key]`, `/leads`, `/leads/new`, `/leads/[leadId]`, `/activity`, `/whatsapp` | Phone/WhatsApp OTP replacing dormant password/TOTP exports; snapshots/attention/activity; provision/preset/status/owner support/config/entitlement/location/tax/messaging; mock console. Audit tab is **platform events**, not the tenant's business audit log. No full worker/outbox/backup operational console. |
| Authentication/public staff | `/login`, `/login/reset` (N), `/login/link/[token]`, `/set-pin`, `/check-in/[token]` | Phone/PIN, recovery, single-use staff bearer link, credential set/reset, premises token **plus** own staff session. |

### Route handlers, authentication and scope

| Handler | Boundary and database effect |
|---|---|
| `app/api/auth/[...all]/route.ts` | Better Auth handler; current disabled public credential/OTP doors checked by auth boundary code. Not automatically a valid Ops login. |
| `app/api/login/pin/route.ts` | Phone/PIN validation, lockout/auth service, session issuance. |
| `app/api/login/pin-recovery/route.ts` (N) | Recovery challenge/complete boundary via `lib/auth/whatsapp-route.ts` and `db/whatsapp-auth*`; synthetic transport only currently available. |
| `app/(platform)/ops/api/whatsapp-auth/route.ts` (N) | Ops OTP request/verify; platform identity and host/origin flow, separate cookie/session. |
| `app/api/login-link/redeem/route.ts` | Token signature/purpose/expiry/single-use and membership/tenant status; can establish a real staff session. |
| `app/api/account/set-pin/route.ts` | Existing staff session and credential validation; own credential mutation. |
| `app/api/offline/session/route.ts` (N) | Session/tenant/membership namespace and lease; not a grant for attendance mutation. |
| `app/api/receipts/[paymentId]/route.ts` | Tenant context + invoice permission, payment location, tenant-scoped PDF creation/read; receipt audit in its own write transaction. |
| `app/api/payment-qr/[qrId]/image/route.ts` | Authenticated tenant/settings-read and target image scope; no public QR management. |
| `app/(owner)/owner/members/import/template.csv/route.ts` | Owner surface/member-management gate; static import template, no member mutation. |
| `app/(owner)/owner/reports/attendance.csv/route.ts` | Role/report permission and report scope; hiding Reports must not authorize CSV. |
| `app/p/[token]/route.ts` | Verified tenant/member token → bounded parent read; no session, mutations or JavaScript. |
| `app/p/[token]/receipt/[paymentId]/route.ts` | Verified parent token plus payment belonging to that token's member; no arbitrary-child PDF. |
| `app/api/health/route.ts` | Public coarse DB/worker health, not an Ops control interface. |

### Screen → action → database/audit trace ledger

All normal tenant action rows below begin **Zod → session/default active membership (`context.ts`) → named permission (`permission.ts`)**. The service opens `withTenant`; tenant RLS is additional to its resource checks. Platform rows use separate Ops authentication/scope. Read-only operations do not need mutation audits. “Audit” below is an observed writer/contract, not blanket rollback proof for every operation.

| Screen / gesture | Actions → service | Permission and resource validation | Read/write and audit |
|---|---|---|---|
| Member list/detail/create/edit | `people.ts` → `people.ts`, `register.ts` / `member-registration.ts` | members.read/write; member/location/guardian/consent validation | persons, members, guardianships, consents, status history; current core member audit writers. Full member projection is too broad for Accountant. |
| Import preview/attested commit | `member-import.ts` → importer/match/CSV helpers | members.write; 2 MB/500 rows, scoped locations, minor guardian, actor attestation, tenant-bound hash | One tenant-row-locked commit for valid rows/consent/import audit; retry safe; code-only conflict skip needs a product choice. Reception grant exists but Owner-only upload page. |
| Enrol/transfer/facility opt-in | `enrolment.ts`, `transfer.ts`, `facility-optins.ts` → enrolment/register/transfer/opt-in services | members.write; current member/source/destination site checks; capacity/eligibility | enrolments/opt-ins, current enrolment/transfer audit; refused-transfer identity preservation tested. |
| Member/subscription pause/resume/cancel | `people.ts`, `subscriptions.ts` → member-status/subscription services | members.write; location; independent lifecycle models | member history or subscription status/dates plus audits. No automatic same-meaning guarantee between the two “paused” states. |
| Programs/batches/coaches | `programs.ts` → programs | programs.read/write; staff.read for coach picker; location/resource lookups | programs/batches and mutation audit; coach has read-only grant, not configuration. |
| Today/schedule/register | `coach.ts`, `sessions-list.ts`, `schedule-grid.ts` → register/calendar | attendance.read/mark; session location + coach assignment; marking effective enrolment, live active/trial member and non-cancelled session | attendance and actor fields; attendance.mark audit in locked transaction; identical replay audit dedupe and audit-failure rollback tested. |
| Cancel/reschedule/substitute | `session-lifecycle.ts`, `coach-substitution.ts` → session-lifecycle/substitution | Lifecycle uses attendance.mark and drops context; no location/assignment check (A01). Substitute uses programs.write. | sessions; U adds session notification and same-transaction audit to lifecycle; audit does not repair authority. |
| Makeup grant/redeem/list | `makeup.ts` → makeup | attendance.read/mark; no assigned-member/site/absent-pair proof; narrow ctx on mutations (A02) | makeup_credits insert/update, no audit in complete mutation bodies. Redemption does not mark attendance or create effective enrolment. |
| Assessment/progress | `assessments.ts` → skill-framework / skill-progress | levels.assess/read + swim.levels; location only, not assignment (A03) | assessments append + assessment.record audit; progress returns identity/history/notes. |
| Enquiry/stage/follow-up/trial/convert/waitlist | `enquiries.ts`, `waitlist.ts` → domain services | enquiries.read/write; tenant and participating location/resource checks | enquiries/follow-ups/trials/member/enrolment or waitlist and domain audits; counter and Owner reuse action/service path. |
| Plan pricing/academy tax/payment QR/menu | settings actions → corresponding plan/profile/QR/menu services | settings.read/manage; vertical/registry UI gates; Owner/Admin management | plans/settings/QR bytes/menu, settings audits; not a reception price authority. |
| Raise/void invoice | `invoices.ts` → invoice-mutations → invoice-issue | invoices.write; subscription/invoice location, active subscription, duplicate invoice, reason/unpaid guard on void | invoices/lines/number counters and invoice issue/void audit. Issue **and void** share one reception grant (R01). |
| Collect cash/UPI/card reference/receipt | `payments.ts` → payments → receipts handler | payments.record; invoices.read for history; invoice/site/remaining amount/reference | locked payment + invoice, duplicate reference index, payment.record audit; no gateway payment confirmation. |
| Reverse payment/ledger | `payment-reversals.ts`, `fees-hub.ts` → reversal/fees services | payments.refund for mutation, payments.read for reversals; location and cumulative remaining ceiling | new reversal row, original payment unchanged, invoice recompute + payment.reverse audit; not actual bank/cash refund execution. |
| Daily collections/cash confirm/reopen/history | `reconciliation.ts` → reconciliation/closed-state | reports.financial read; payments.record confirm; settings.manage reopen/over-threshold close; site, actor, closed-state/reason checks | cash_counts with superseded history + audit. Reception cannot read/access UI (M01); gross cash/reversal settlement policy needs reconciliation decision. |
| Staff/invite/revoke/resend/login/owner reset | staff/invitation/invite-link/tenant-owner-reset actions → staff/invitation/credential services | staff.read/write/invite; tenant target/status; **admin can mint Owner credential** (A06) | users pre-tenant identity, membership/locations/staff, invitation audit/outbox; Owner-reset issuance audit; ordinary bearer-link issuance has no equivalent explicit issuance audit in `invite-link.ts:24–36`. |
| Roster/template/create/delete/publish/leave approvals | shifts/leave actions → shifts/roster/leave-approval | staff.roster (also given to Worker); site, actor, target staff rows | shifts/leave requests and audits; wrong Worker execution authority (A05). |
| Own check-in/out/shifts/leave/premises scan | staff attendance/shifts/leave actions → staff-self/premises | staff.self; caller's own staff record; premises tenant token plus session | self staff attendance/leave plus audit; no business financial data. |
| Correct other staff attendance | staff-attendance action → staff-attendance-correction | staff.attendance; own marker row, same-tenant target; no target-location gate (A04) | staff_attendance upsert and reason/audit; history authority broader than counter needs (R04). |
| Announcement/send/inbox/contact preferences | announcements/notification-destinations actions → announcement/audience/notification services | messaging.send or members.read/write; batch tenant lookup; **no sender site restriction** in announcement service | announcement/notifications/outbox + send audit; dispatch current recipient/consent eligibility. Coach inbox uses members.read it does not hold; no general Coach announcement inbox. |
| Global search | global-search action → global-search | members.read plus per-kind enquiries/invoice checks | tenant/search results, no writes; exposes Owner-shaped search to Accountant. |
| Dashboard/reports/analytics/CSV | dashboard/report/analytics actions → domain reports | dashboard.view vs reports.operational/financial; report services now preserve context in remediation, **dashboard drops it** (A07) | source queries/rollups, no mutation; unsupported expense/cost modules are not profit facts. |
| Café cart/order/bill/settle/void | orders actions → orders-core/orders-billing/cafe-billing | payments.record; settings.read for menu, tenant/location/order state | orders/lines/invoice/payment and audits; no distinct café permission, no Owner counter surface; anonymous billing/void UI incomplete. |
| Booking quote/create/cancel/bill | bookings actions → booking/pricing/billing services | bookings.read/write tied to pool.booking, billing payments.record; site/resources/availability/price constraints | bookings/invoice/payment/audits; screen intentionally 404, actions still granted (pilot exposure decision, not a proven bypass of a disabled grant). |
| Issue parent link/open child/download receipt | parent-link action → sign inside tenant target/audit tx; parent route → parent-view/receipt services | current explicit Owner/Admin + members.write, live target/site; signature/expiry/scope; member/payment match | parent_link.issue audit without token; read-only token-scoped business view/PDF. No authenticated guardian binding or per-link revocation. |
| Ops provision/features/config/tenant support | platform-* actions → db/platform*, config/preset/ops-action | independent platform session, admin/viewer write boundary, closed ops scopes | control-plane tables and platform_audit_log in service tx; tenant business operation paths should not be added. |
| Jobs and platform snapshots | worker HANDLERS → job modules | queue tenant UUID; withTenant; narrow metrics scope; recipient recheck at dispatch | sessions, invoices, expiration, rollups, outbox/log/audit, checkpoint/export; not human role grants. |

The typed action map (`lib/auth/action-permissions.ts:26–343`) is a useful action-name catalogue, **not an enforcement engine**. It incorrectly lists `getOwnerDashboardAction` as reports.operational while actual code uses dashboard.view, and lists parent issuance among PRE_AUTH_ACTIONS despite current session checks. These are scanner/documentation drift and must not drive actual matrix conclusions.

### Entitlement and incomplete-feature inventory

- Catalogue: members, attendance, programs, enquiries, billing, staff, reports, settings, messaging, pool/court/pitch/studio.booking, swim.levels, cafe.pos, analytics.advanced (`db/seed-platform.ts:271–304`). Messaging/café/advanced analytics are internal; court/pitch/studio booking beta; pool booking GA label does not mean the reception UI is pilot-ready.
- Thirty-four permission keys are explicitly listed at `seed-platform.ts:316–349`: member read/assigned/write/delete; attendance read/mark; program read/write; enquiry read/write; invoice read/write; payment read/record/refund; staff read/write/invite/attendance/roster/self/pay.read/pay.write; reports operational/dashboard.view/financial; settings read/manage; messaging send/templates; bookings read/write; levels read/assess.
- “Internal/beta” catalogue status and actual enabled feature set are different. A granted action can still be callable if an internal feature is entitled. Café actions use billing permission, not cafe.pos; booking uses pool.booking even for generic bookable activities. These contracts need an explicit pilot feature exposure policy.
- Payroll/payslips/profitability, worker tasks/chemistry/incident logs, member check-in scanner, full refund/credit-note settlement, booking price administration/UI, upload Documents, parent progress/full schedule, privacy/offboarding/export/erasure UI and outbox recovery are incomplete/deferred. Do not implement all before the pilot by default; choose a narrow pilot and honest surfaces.

## 7. Current role-access matrix

Cell legend uses requested classifications: **F** Full access (platform); **T** Tenant-wide access; **L** Location-scoped access; **A** Assigned-resource access; **R** Read-only; **S** Self-only; **—** No access; **H** Hidden but technically callable; **P** Permission exists but UI is missing/unusable; **I** UI exists but authorization is insufficient; **?** Ambiguous. `L*` means L only when location-scoped-staff is enabled and membership restricted; otherwise T. `R-L*` is read-only within that effective scope. Parent `R-S` is one token's member, not a logged-in guardian. Worker column means **background system**, not human Worker; human Worker has its own row notes and A05.

| Capability | Ops | Owner | Admin | Accountant | Reception | Coach | Parent | Member | Worker |
|---|---|---|---|---|---|---|---|---|---|
| Tenant provisioning | F | — | — | — | — | — | — | — | — |
| Academy settings | F (control-plane) | T | T | R | R | — | — | — | — |
| Location configuration | F | T | T | R | R | — | — | — | — |
| Feature configuration | F | P (request/config only) | P | — | — | — | — | — | — |
| Programs | F (preset) | L* | L* | — | R-L* | R-L* | — | — | — |
| Batches | F (preset) | L* | L* | — | R-L* | R-L* | — | — | — |
| Sessions | R (health aggregates) | T (A01) | T (A01) | — | H (A01) | H (A01) | R-S next | — | T generation |
| Schedules | — | R-L* | R-L* | — | R-L* | A | R-S next | — | T generation |
| Member creation | — | L* | L* | — | L* | — | — | — | — |
| Member editing | — | L* | L* | R-L* backend | P scalar edits | — | — | — | — |
| Guardian management | — | L* capture; P maintenance | L* capture; P maintenance | R-L* backend | L* capture; P maintenance | R-A emergency | — | — | — |
| Consent | — | L* capture; P withdrawal | L* capture; P withdrawal | R-L* backend | L* capture; P withdrawal | — | — | — | R dispatch |
| CSV import | — | L* | L* | — | H | — | — | — | — |
| Enrolment | — | L* | L* | R-L* backend | L* | — | — | — | — |
| Member transfer | — | L* | L* | — | L* | — | — | — | — |
| Coach assignment | — | L* | L* | — | — | — | — | — | — |
| Attendance marking | — | P | P | — | L* | A | — | — | — |
| Attendance correction | — | P | P | — | L* | A (no separate correction duty) | — | — | — |
| Assessments | — | L* management/read | L* management/read | — | — | I (A03) | — | — | — |
| Enquiries | — | T | T | H operational aggregates | T | — | — | — | — |
| Trials | — | L* | L* | — | L* | ? roster exception | — | — | — |
| Invoice creation | — | L* | L* | P action granted | L* | — | — | — | T recurring |
| Discounts | — | — | — | — | — | — | — | — | — |
| Invoice void/cancellation | — | L* | L* | P action granted | L* (R01) | — | — | — | — |
| Payment recording | — | L* | L* | L* financial routes | L* | — | — | — | — |
| Payment reversal | — | L* | L* | L* action/fees; P member UI | — | — | — | — | — |
| Refund handling (actual payout) | — | ? reversal only | ? reversal only | ? reversal only | — | — | — | — | — |
| Cash reconciliation | — | L* | L* | L* confirm/read; no reopen | P confirm; no report | — | — | — | T rollup only |
| Receipts | — | R-L* | R-L* | R-L* | R-L* | — | R-S | — | — |
| Financial reports | R platform aggregates | R-L* | R-L* | R-L* | — | — | R-S child dues | — | T rollups |
| Operational reports | R platform aggregates | R-L* / T per report | R-L* / T per report | R-L* / T per report | — | — | — | — | T rollups |
| Staff invitations | F Owner support | T | T | — | — | — | — | — | T dispatch only |
| Role assignment | F Owner provisioning | T on invite; P later edit | T on invite; P later edit | — | — | — | — | — | — |
| Staff PIN reset / login credential | F support | T | T incl Owner (A06) | — | — | S recovery | — | — | — |
| Announcements | F mock/support | T | T | H read via members.read | H send/read (R03) | — inbox | — page | — | T dispatch |
| Parent-link issuance | — | L* | L* | I button but denied prerequisites | — | — | — | — | — |
| Parent attendance view | — | L* own member read | L* own member read | — | R-L* history action | R-A | R-S | — | — |
| Parent financial view | — | R-L* | R-L* | R-L* | R-L* invoice | — | R-S | — | — |
| Café orders | — | H counter actions | H counter actions | H billing grant | L* | — | — | — | — |
| Bookings | — | H | H | — | H (page 404) | — | — | — | — |
| Member check-in | — | P | P | — | L* register/check-in | A marking | — | — | — |
| Member QR scanner | — | — | — | — | — | — | — | — | — |
| Staff check-in | — | P own UI | P own UI | P own UI | S | S | — | — | — |
| Staff attendance correction | — | T target (A04) | T target (A04) | — | I (A04/R04) | — | — | — | — |
| Staff roster/leave approval | — | L* | L* | — | — | — | — | — | — |
| Human Worker roster/leave approval | — | — | — | — | — | — | — | — | H human Worker (A05), not system |
| Messaging | F mock console | T entitled mock/capture | T entitled mock/capture | — | H entitled send | — | R-S notifications | — | T queued |
| Audit-log access | R platform events | P business audit viewer | P | P financial audit viewer | — | — | — | — | T checkpoint/export |
| Backup and restore | P infrastructure tools | — | — | — | — | — | — | — | — privileged separate job |
| System health | R public/API | R public/API | R public/API | R public/API | R public/API | R public/API | R public/API | R public/API | T heartbeat |
| Worker monitoring/recovery | P health only | — | — | — | — | — | — | — | T heartbeat |

Important evidence: grants `roles.ts:21–113`; actual action catalogue `action-permissions.ts`; Owner/Accountant guard `surface-access.ts:50–65`; Accountant home failure `app/(owner)/owner/page.tsx:39–45` + `lib/actions/dashboard.ts:35`; reception invoice authority `lib/actions/invoices.ts:56–77`; closeout split `lib/actions/reconciliation.ts:71–113`; other surprising cells traced in A01–A07/R01–R04. A row labelled P does not imply the backend permission itself is absent. A hidden action is not an authorization defect merely because the pilot UI is absent; the defect requires a contradictory charter/scope rule.

## 8. Backend authorization findings

For all findings: scope is this branch/HEAD and working tree; no staged origin. Competitor evidence informs responsibility, not exploit proof. Recommended regressions must use valid input and actual restricted contexts/positive controls, not fail at Zod first. No new database object is presumed necessary unless explicitly identified; any permission backfill requires a reviewed forward migration, never editing applied SQL.

### A01 — Coach/Reception can cancel or reschedule unassigned other-location sessions

- **Category:** Confirmed authorization defect. **Severity:** High. **Pilot blocker:** Yes.
- **Affected:** Coach, Reception, location-restricted Admin/Owner; Owner Sessions UI/direct lifecycle actions.
- **Current → recommended:** attendance.mark admits all of these roles to tenant-wide lifecycle mutation; management scheduling authority should belong to Owner/Admin, with scoped Reception assistance only if explicitly delegated; Coach requests escalation, not cancellation of arbitrary academy sessions.
- **Evidence:** `lib/actions/session-lifecycle.ts:26–55` calls attendance.mark and passes only tenantId/userId. `lib/services/session-lifecycle.ts:55–116,126–250` queries same-tenant session but checks neither assigned coach nor allowed location. Comment `actions/session-lifecycle.ts:12–15` explicitly calls this management-only. Actual seeded Coach/Reception grants satisfy this gate.
- **Reproduction:** actual seeded Coach attendance.mark succeeds; action-shaped adapter cancels an unassigned B-site session from an A-only context. The service returns `kind:ok,newStatus:cancelled`. Reschedule shares the same missing boundary; mutation was not separately HTTP-replayed.
- **Impact:** a coach/counter clerk can disrupt another class/site, invalidate schedules and trigger notifications. Same-tenant operational authority failure; no cross-tenant evidence.
- **Industry/Aqua:** TeamUp session management is separately configurable from attendance; Aqua says Coach's job is assigned attendance and sessions management is management-only.
- **Provenance:** **C + U**. Committed action/gate and missing service guard remain; unstaged service adds notification/atomic audit but does not repair authority.
- **UI:** retain Owner/Admin cancel/reschedule; optionally scoped Reception request/assistance; do not show Coach destructive management controls.
- **Permission/service:** use scheduling-management authority (existing programs.write is a small pilot option), preserve full Ctx, verify session location and permitted actor. Confirm held-session reschedule policy; current code permits moving held sessions and rejects same-date time-only reschedule as no_change.
- **DB/audit:** preserve session history; keep atomic actor/reason/before-after audit. Add permission/backfill only if a new narrow key is approved.
- **Tests:** Coach and Reception direct actions with unassigned session; restricted Admin A→B; same-site manager positive; held/cancelled/time-only policy; no write/notification/audit on denial.

### A02 — Makeup grants/redemptions bypass responsibility, resource validation and audit

- **Category:** Confirmed authorization defect. **Severity:** High. **Pilot blocker:** Yes.
- **Affected:** Coach/Reception and restricted management; owner member makeup panel/direct actions.
- **Current → recommended:** attendance.mark grants commercial/session entitlement authority; Owner/Admin decide exceptional free sessions; Reception redeems a valid approved eligible credit within assigned location; Coach records attendance only on explicit eligible records.
- **Evidence:** `lib/actions/makeup.ts:62–95` uses attendance.mark, drops location/role context; reads `:35–59` use attendance.read. `lib/services/makeup.ts:53–145,171–245,251–320` has no member assignment/location validation, no absent source requirement in the grant body, no target session validation before redemption and no audit writer. Comments `actions/makeup.ts:17–19` say management-only, and `services/makeup.ts:19–33` describe an excused-absence workflow.
- **Reproduction:** Coach grant succeeds for an unrelated B-site member/source session without any attendance/absence row; returned credit has **zero audit rows**. Reads/redemption have corresponding source-confirmed omissions; not individually HTTP-tested.
- **Impact:** unauthorized free-session entitlements and loss of accountability; historical learner data can be read outside assignment; malformed source/target business relationship. Tenant FKs are insufficient.
- **Industry/Aqua:** Sportzy advertises makeup workflow; Aqua explicitly defines one credit per excused absence, not arbitrary coaching attendance authority.
- **Provenance:** **C**. Actions/service are not modified by the existing remediation.
- **UI:** manager grant with reason; Reception eligible redemption; Coach references approved eligibility. Current redemption changes only the credit, while strengthened attendance requires effective enrolment—complete the approved exception or exclude cross-batch makeup from pilot.
- **Permission/service:** separate grant from attendance; preserve full ctx; validate member, absent/effective source, credit, target location/session/capacity/status; scope all three reads. Lock and serialize redemption.
- **DB/audit:** atomic grant/redeem audit with actor/reason/source/target; no assumed new table. Explicit trial/makeup eligibility design needs product approval.
- **Tests:** Coach denies unassigned grant/read; Reception grant denied; manager positive; source not absent/cancelled; arbitrary/missing/other-site target; double redemption; audit failure rollback; actual approved makeup attendance succeeds.

### A03 — Coach assessment page and actions accept unassigned members

- **Category:** Confirmed authorization defect. **Severity:** High. **Pilot blocker:** Yes.
- **Affected:** Coach; `/coach/members/[memberId]/assess`, getMemberProgressAction, recordAssessmentAction.
- **Current → recommended:** any same-tenant member at an allowed site (all sites when default tenant-wide) → **assigned members**, including explicitly defined substitute-session relationships.
- **Evidence:** `app/(coach)/coach/members/[memberId]/assess/page.tsx:26–46` only uses Coach surface and progress action. `lib/actions/assessments.ts:24–46` has levels.read/assess; `lib/services/skill-progress.ts:64–95,159–165` checks location only; `lib/services/skill-framework.ts:211–284` checks member/location/node, never coach assignment. This is separate from the corrected `resource-access.ts` guard used elsewhere.
- **Reproduction:** Coach with no enrolment/batch relationship records a band against an unrelated member and reads its MemberProgress identity/history; actual seed levels permissions pass. Probe used allLocations=true to isolate assignment failure from location failure.
- **Impact:** children's skill history/notes disclosed or corrupted by an unrelated coach; no money or cross-tenant compromise.
- **Industry/Aqua:** TeamUp instructed-session scope; SportsEngine team rights; Aqua seeded members.read.assigned and assigned learner UI establish intended resource boundary.
- **Provenance:** **C**; these assessment services/actions/page have no unstaged fix.
- **UI:** keep assessment CTA only for assigned learner/session; blocked deep links must fail before data load.
- **Permission/service:** use shared authenticated member visibility/assignment guard in **both** read and mutation; define substitute teacher qualification; don't rely on navigation origin or user-supplied sessionId.
- **DB/audit:** existing append assessment+audit transaction is correct; no schema change required for basic assignment guard; audit denials per approved policy.
- **Tests:** direct assigned/unassigned read/write and deep page; other tenant/site; inactive/deleted member; substitute session positive; revoked assignment; transaction rollback.

### A04 — Staff attendance correction ignores target location

- **Category:** Confirmed authorization defect. **Severity:** Medium. **Pilot blocker:** Yes where location-restricted staff are used.
- **Affected:** Reception/other staff.attendance holders; Today staff board/direct correctStaffAttendanceAction.
- **Current → recommended:** any live same-tenant target → staff at assigned locations, with historical correction handled by management (R04).
- **Evidence:** `lib/services/staff-attendance-correction.ts:46–63` resolves the caller's marker and selects the target by tenant/id/deleted state, not target membership/staff location. Writes `:104–173` audit the correction but do not authorize the target. Grant `lib/services/roles.ts:78` and action mapping `action-permissions.ts:162`.
- **Reproduction:** A-only receptionist corrects a distinct Coach whose active membership is assigned **exclusively to B**. CorrectAttendance returns `ok:true` and writes the record. Synthetic marker and target were distinct staff/users, not a self-correction shortcut.
- **Impact:** another site's attendance can be falsified, affecting roster/pay input and disputes. Privacy limited to staff attendance, not pay amounts. Not cross-tenant.
- **Industry/Aqua:** Mindbody location-aware operations; Aqua location-scoped-staff feature and separation of staff attendance/pay.
- **Provenance:** **C**; target correction service unchanged.
- **UI:** only current-site targets; historical corrections identified as escalation.
- **Permission/service:** resolve actual target staffing location/membership scope transactionally; do not infer from the displayed list or trust submitted staffId.
- **DB/audit:** existing same-transaction reason audit retained; include corrected check-in/out times in before/after if changed. No new table presumed.
- **Tests:** A→B denied despite known staff ID; multi-site staff policy; own site positive; no-location actor/target fails closed according to documented rule; no writes on denial.

### A05 — Human Worker can build/publish staff rosters and approve leave

- **Category:** Confirmed authorization defect against explicit Worker charter. **Severity:** High. **Pilot blocker:** Yes, or disable human Worker logins before pilot.
- **Affected:** Human Worker (not pg-boss); hidden direct shifts/leave actions.
- **Current → recommended:** `staff.roster` management grant plus self → **staff.self only**, with task/maintenance capability deferred until its UI exists.
- **Evidence:** `lib/services/roles.ts:105–112` assigns staff.roster. `lib/actions/shifts.ts:43–103` uses it for template/create/delete/publish; `action-permissions.ts:171–176` uses the same key for leave/type approval/rejection. `lib/services/shifts.ts:48–136` accepts any live tenant staff target at an allowed shift location. Aqua scope `project-scope.md:195` says Worker task list and nothing else.
- **Reproduction:** actual seeded Worker passes staff.roster and creates a shift for another staff member; grant checks also permit management leave actions. No Worker page is needed to execute a Server Action.
- **Impact:** minimal-trust ground staff gain operational/HR authority. No payroll read grant, but downstream staffing/pay inputs can change.
- **Industry/Aqua:** TeamUp limited section grants/ClubRight individual limited staff, Aqua minimal Worker surface.
- **Provenance:** **C**; seed/actions unchanged.
- **UI:** remove Worker invitations from pilot unless supported self-service landing is provided; never call the parent explainer a Worker task UI.
- **Permission/service:** remove staff.roster from Worker; own roster remains staff.self; future management read/write/approve split can follow after pilot.
- **DB/audit:** existing tenant grants need an explicit reviewed corrective backfill respecting custom roles; roster audits already exist.
- **Tests:** seeded/existing Worker cannot create/delete/publish or approve another person's leave; own shifts/check-in/leave work; no hidden-action bypass; grant migration idempotence.

### A06 — Administrator can mint an Owner bearer login/reset credential

- **Category:** Confirmed authorization defect / privilege escalation across tenant roles. **Severity:** High. **Pilot blocker:** Yes.
- **Affected:** Admin; `/owner/staff` Owner access recovery and direct link-issue actions.
- **Current → recommended:** staff.invite grants issuance to Owner targets → Owner-target credentials **Owner-only**, or explicit independently verified Ops recovery. Admin may invite/recover lower-trust operational staff if approved, not Owner/co-owner identities.
- **Evidence:** Admin inherits staff.invite but lacks staff.pay privileges (`roles.ts:23–29`). `lib/actions/tenant-owner-reset.ts:41–45` checks staff.invite, not issuer authority. `lib/services/owner-reset.ts:74–96` delegates to target-only `issueOwnerResetLink`; `invite-link-issue.ts:150–211` verifies TARGET is active Owner but not issuer. Ordinary `lib/actions/invite-link.ts:24–36` + `invite-link-issue.ts:47–100` can mint relogin credentials for an active Owner as well. `lib/services/invite-link.ts:152–169` states token redemption establishes session and reset can overwrite credential/revoke sessions; no second proof of Owner phone required in that bearer flow.
- **Reproduction:** actual seeded Admin staff.invite passes and issueTenantOwnerResetLink returns a valid reset-purpose, Owner-target token. Full account takeover was not HTTP-executed; credential capability and redeem semantics are source-confirmed. The public action contract should prevent obtaining the bearer credential in the first place.
- **Impact:** erases the intended Owner/Admin trust and pay-data distinction; enables impersonation and potential Owner lockout. Same tenant in demonstrated target; shared global user identity makes cross-membership impact a regression question, not a tested cross-tenant exploit claim.
- **Industry/Aqua:** Classcard Owner-controlled access; TeamUp admin permissions are deliberately full but Aqua explicitly excludes Admin pay and its pilot checklist `:653–654` says recovery remains Owner-only.
- **Provenance:** **C + U**; reset gate/service committed; ordinary issue action has new notification enqueue but unchanged broad target authority.
- **UI:** Owner reset block only for authorized issuer; stop exposing Owner credentials to Admin; approved support verification through Ops remains exceptional.
- **Permission/service:** check issuer-target privilege relationship for reset **and relogin**; don't fix only reset. Restrict delegated issuers from stronger/custom targets. Verify actual membership/role, not just a supplied role label.
- **DB/audit:** dedicated security issuance audit, reason/target/issuer/expiry, no token; reject before signing. Audit rollback must prevent returning a token; no automatic new token table requirement.
- **Tests:** Admin Owner reset/relogin denied, lower-trust target positive, co-owner authorized, other tenant/revoked target denied, no secret/audit/queue on denial, session reset and shared-user effects.

### A07 — Restricted Admin/Owner dashboard exposes other locations

- **Category:** Confirmed authorization defect. **Severity:** Medium. **Pilot blocker:** Yes for multi-location restricted managers.
- **Affected:** dashboard.view holders with restricted sites; Owner Home/direct getOwnerDashboardAction.
- **Current → recommended:** tenant-only aggregate read and arbitrary facility filter → full authenticated context, allowed sites only; Owner can intentionally have tenant-wide authority, restricted Admin cannot.
- **Evidence:** `lib/actions/dashboard.ts:32–39` passes only tenantId; validates facility UUID but no allowed-site check. `lib/services/dashboard.ts:78–93,101–169,255–325` applies an optional site filter, not resolveLocationAccess. Facility breakdown/all-site aggregate reads disregard actor. New comment promises narrowing without actual authorization.
- **Reproduction:** A-only Admin with seeded dashboard.view receives active member count and B location breakdown through the exact tenant-only adapter; B was the only active synthetic member.
- **Impact:** same-tenant location privacy/operational oversight policy defeated; includes follow-up/cash attention and aggregate learner data. No raw cross-tenant compromise.
- **Industry/Aqua:** Mindbody separates all-location report grants; Aqua supports assigned-location staff and globally scoped Owner.
- **Provenance:** **C + U**. Committed action already discarded context; new unstaged facility filtering retains the defect and accepts a selectable arbitrary target.
- **UI:** restrict allowed site list and “All” meaning; explain consolidated Owner versus assigned-manager totals.
- **Permission/service:** preserve ctx and use authorization predicates on every aggregate/breakdown; filter arguments may only narrow allowed scope.
- **DB/audit:** no schema change; read-only audit optional by sensitivity policy, not mutation audit.
- **Tests:** restricted Admin all-sites/B-filter request denied/narrowed, allowed A positive, all-site Owner positive, NULL location policy; counts/attention/breakdown do not leak B.

## 9. Dashboard, navigation and content findings

These six IDs count content/navigation issues, not additional authorization defects. No screenshot-based visual certification is made. Source and passing component tests establish particular structures, not sunlight legibility/real-device responsiveness.

| ID / severity / provenance | Current content and classification | Required change and evidence | Pilot |
|---|---|---|---|
| **C01 — High; C + U** | Accountant uses Owner console/navigation and `/owner` but lacks dashboard.view. **Assigned to wrong role / misleading / unusable entry.** Member detail unconditionally requests attendance before even its Payments tab; accountant lacks attendance.read. It also renders scalar Edit/status/subscription/makeup/parent-link controls without applicable capability gates. | Permission-shaped financial entry (redirect to an actually usable Fees/Collections route is a small first step), finance navigation, prerequisite reads only for allowed tab, read-only payer projection. `lib/services/roles.ts:32–56`; `components/owner-shell.tsx:38–41`; `components/owner-side-nav.tsx:21–47`; `app/(owner)/owner/page.tsx:39–45`; `app/(owner)/owner/members/[memberId]/page.tsx:76–83,119–175`; actual dashboard key `lib/actions/dashboard.ts:35`. Regression Accountant login→home→invoice/receipt/reversal, no operational edit buttons or denied background fetch. | **Blocker if Accountant enabled.** Otherwise postpone role, don't describe it as usable. |
| **C02 — Medium; C + U** | Owner “Today's registers” is dominant; chips active members/attendance/batches; financial trends now exist but overdue/collections/approval snapshot is not primary. “Needs you today” omits overdue fees; selected-location mode suppresses follow-ups rather than offering a business-wide indication. “Today's facilities” renders batch rows. **Correct data, wrong priority/label.** | Use current billing figures for collections/outstanding/overdue with clear periods; cash discrepancies and unresolved owner decisions above register completion; name session/capacity section correctly. Keep honest no-data. `components/owner-dashboard.tsx:98–140,209–239`; `lib/services/dashboard.ts:83–91,182–217,220–227`. Do not invent profit/cost figures. Regression overdue member and cancelled/zero-roster session; location-scope tests; phone and desktop attention hierarchy. | Should fix; not alone security blocker. |
| **C03 — Low; C + U** | Reception's Collect payment caption says “Show a club payment QR with the amount,” but workflow now records money against invoices. Café is shown unconditionally although internal/disabled experiences can fail after tap; next counter action and close-day are missing (M01/M02). **Misleading / feature visibility mismatch.** | “Find an invoice and record cash or UPI” with explicit staff verification; hide unavailable café/payment modules using **grant and entitlement**, retain plain recovery/escalation path. `app/(reception)/reception/page.tsx:44–85`; `lib/auth/permission.ts:58–90`; `db/seed-platform.ts:303`. Do not show automated UPI success from QR display. Component/feature-disabled action positive/negative tests, narrow phone journey. | Should fix. |
| **C04 — Low; C + U** | Announcements are at Settings→Academy, yet are recurring communication work. Staff/Plans also repeat Settings entries despite top-level operational routes. **Correct role, wrong placement; intentional shortcuts need consistent destinations.** | Communication entry from Owner/Admin operations/home; plans remain price configuration with finance link; don't create a second implementation. Reception scoped notices only if approved (R03). `app/(owner)/owner/settings/page.tsx:113–128,159–173,248–265`; `lib/nav.ts:26–50`. Copy says in-app guardians but most guardians have no user account; show actual available channel/audience status. | Should fix, no independent blocker. |
| **C05 — Medium; C + U** | Collections shows **Recount** after a closed count but calls confirm again; backend correctly refuses “already closed.” Note says optional while >₹500 requires reason. Async load/confirm has no catch/finally; loss of response can leave busy state indefinitely. **Misleading / error recovery missing.** | Closed-state display with owner-authorized Reopen + reason, then new confirm; dynamic reason help; safely refresh after uncertain response and always release busy. `components/reports/collections-report.tsx:42–53,217–272`; `lib/actions/reconciliation.ts:91–113`; `lib/services/reconciliation.ts:349–365,395–417`. Confirm before sensitive reopen; distinguish review pending. Test closed/open/large-variance/network failure and no double-close. | Should fix; if closeout is enabled it must not promise a nonexistent recount. |
| **C06 — Low; C + U + N docs** | Documents tab exposes “C-07 is not built yet”; role and plain-language overview promise parent pay links, salary-based check-in, ground-staff task lists, pool booking and same-dashboard competitor story. **Future feature exposed too early / internal terminology / stale capability claim.** | Hide unbuilt pilot tab or use user language (“Document uploads aren't available”); label prototype/reference documents; reconcile scope with current read-only money and deferred pay/booking. `components/member-detail/member-documents-panel.tsx:15–18`; `docs/how-it-works.html:138–193,220,255–265`; `docs/project-scope.md:26`; current `DESIGN.md:28–32,60–62`. No backend/schema change. Regression pilot nav/empty-state claims, not a fabricated upload test. | Should fix before demo/pilot onboarding. |

### Role-content usefulness review

| Role question | What is useful today | What is wrong, missing or needs a decision |
|---|---|---|
| Owner: academy healthy? | Real active-member/batch counts, capacity, attendance and money trends, cash-review and overdue enquiry attention. | No financial hero/dues triage, explicit approval queue or staff/location risk summary. Cost/profit is deferred; collections ≠ profit. Dominant register management may overload Owner with coach execution. |
| Reception: service now? | Lookup, enquiry, admission, subscription/invoice/payment, receipt, check-in, café, visible persisted payment states. | No day-close, overdue call queue or owner escalation tracking. Operational page targets mobile despite shared counter/desktop reality; product decision required, no invented desktop acceptance. |
| Coach: next session/record? | Today/next and seven-day schedule, assigned roster, count chips, mark-all/Late/undo, durable offline state, safety contact, progress/absence detail. | No assigned unassessed summary; permission gaps A01–A03; no session disruption request or signed-off historical-correction boundary. No finance should be added. |
| Parent: child's state? | Child identity, next session/time/batch/coach, month attendance, recent marks, dues, recorded payments and receipts, real membership dates. | Location and short schedule beyond next session, published progress, a clear correction/help contact and revoked/wrong-recipient escalation. No parent Pay Now is intended for pilot. Returned payment values are original captures; reversal explanation should be assessed before claiming “net paid.” |
| Accountant: reconcile? | Financial action/report services exist with reasons and immutable reversal ledger. | Landing/member UI broken; full personal/medical projection unnecessary; no narrow finance audit/review navigation; pay permissions do not mean payslip/payroll product exists. |
| Ops: intervene? | Control-plane attention queue, real snapshot `asOf`, activity, provisioning/config/preset/entitlement, mock transport labelled. | No actual worker/outbox retry/backups/restore readiness view. “Nothing needs attention” is not proof of health when snapshot absent (`app/(platform)/ops/page.tsx:117–145`). Ops must not become tenant operator. |
| Human Worker / Member | Self-service primitives and member-scoped reads could be reused later. | No useful role home today; parent explainer is wrong Worker content. Freeze unsupported invitation/portal promises for pilot. |

Important correct content: Coach empty Today says to check with Owner (`app/(coach)/coach/page.tsx:86–97`); parent explicitly read-only; money uncertainty/retry handling added to `invoice-expanded.tsx:110–132`; current recent-parent-history order is corrected; invoice reversal affordance respects canRefund/canReadPayments. None of these positives authorizes the sibling defects.

## 10. Incorrectly assigned responsibilities (additional product-role findings)

These are product-policy mismatches, **not falsely labelled bypasses of the current permission policy**. Current grants deliberately allow them. Approval choices must be confirmed by the product owner; recommended minimal pilot authority is shown.

### R01 — Issuing invoices also gives Reception void authority

- **Affected/capability:** Reception, invoice panel/voidInvoiceAction. **Severity:** High (financial authority design). **Pilot blocker:** Yes, unless Owner explicitly accepts a tightly bounded counter-void policy.
- **Current → recommended:** invoices.write gives Reception issue **and void**; Reception issues approved-plan invoices and records money; Owner/Admin authorizes invoice cancellation; Accountant may perform reasoned bookkeeping corrections under an owner-agreed policy. Reception assists by requesting correction; Coach/Parent/Worker/Ops must not execute it.
- **Evidence/provenance:** **C** grant/action/service; invoice panel **C + U** only adds existing UI refinements. `roles.ts:73–75`; `actions/invoices.ts:56–77`; `invoice-mutations.ts:149–203`; `invoice-expanded.tsx` canWrite controls. Current void requires reason and no positive paid balance, but a receptionist can eliminate unpaid debt without a separate approver.
- **Impact:** incorrect or concealed receivable cancellation; audit captures actor but cannot make inappropriate authority correct. Privacy impact low.
- **Industry/Aqua:** TeamUp financial void under Revenue; ClubRight till versus reporting separation; Aqua explicitly separates payment record/refund and cash reopen, but issue/void key is broader than the counter job.
- **UI:** show Raise invoice to Reception, replace Void with “Ask owner to cancel” or omit for the pilot; confirmation + reason for managers.
- **Permission/service/DB:** separate create and void capability or owner/admin guard for the pilot; preserve site/unpaid rules and atomic invoice.void audit; grant backfill only if new key chosen.
- **Tests:** Reception issue positive + void negative, Owner/Admin positive, Accountant agreed rule; paid/fully reversed historical payment semantics; direct valid action invocation; audit rollback and no mutation on refusal.

### R02 — Accountant's member read is an unnecessary full medical/guardian record

- **Affected/capability:** Accountant, getMemberDetailAction and Owner member UI. **Severity:** Medium. **Pilot blocker:** Yes if Accountant enabled with real children; otherwise postpone this role.
- **Current → recommended:** members.read returns full member-360 → minimal finance payer identity/code/location/contact, invoice/subscription facts, and only approved financial reports. Reception/Owner maintain demographics/guardian/consent; Coach sees assigned emergency information. Accountant should not read medical notes/DOB/consent detail merely to reconcile fees.
- **Evidence/provenance:** **C**, projection retained within **U** people service. `roles.ts:44–56`; `people.ts:155–180,193–247`; current MemberDetail includes medical, guardian, consent/status history. Backend readable even where the Accountant page fails unrelated attendance permission (C01).
- **Impact:** unnecessary children's and health information access; no operational write grant. Avoid calling a seeded authorized read an authentication bypass.
- **Industry/Aqua:** TeamUp revenue/customer permissions separate; Classcard taxes/pay separate; Aqua role-shaped minimum information and scope Accountant invoices/reconciliation.
- **UI:** financial home/search/invoice view, no Overview medical/guardians/notes tab or edit affordances.
- **Permission/service/DB:** narrow projection/service or dedicated finance lookup grant; keep required name/contact/payment history; removing members.read blindly would break existing timezone/plan/search helpers. No schema change required; financial access audit policy needs agreement.
- **Tests:** Accountant sees payer/invoice fields but no medical/DOB/guardian evidence in action/RSC payload; finance journey remains usable; no operational mutations.

### R03 — Reception has tenant-wide announcement authority but no proper communication workflow

- **Affected/capability:** Reception messaging.send/announcement service. **Severity:** Medium. **Pilot blocker:** No for synthetic/disabled messaging; Yes before enabling real tenant-wide sends without an agreed delegated policy.
- **Current → recommended:** Reception can call all/batch/parents sends for the tenant → assigned-location operational notices or owner-approved notice execution; Owner/Admin owns academy-wide broadcasts and message policy. Coach assists with session facts, not marketing/global audiences.
- **Evidence/provenance:** **C** seed/action authority with **U + N** new WhatsApp fan-out. `roles.ts:80`; `actions/announcements.ts:24–39`; `services/announcements.ts:84–105` validates batch tenant but not sender locations; composer is Owner-only page and Settings entry. Recipient dispatch scoping fixes are positive but do not decide sender authority.
- **Impact:** wrong-site/global messages, reputational/consent errors; mock counts don't prove real delivery. Public financial info is not inherently in these messages.
- **Industry/Aqua:** Sportzy Indian parent WhatsApp workflows; Classcard Front Office separate from Owner access control; Aqua counter operations and Owner-controlled configuration.
- **UI:** either no receptionist composer/real send in pilot, or a small operational notice workflow with constrained audiences and clear owner escalation/channel states.
- **Permission/service/DB:** split global versus location/session send or impose recipient scope from authenticated context; retain atomic enqueue/audit and dispatch rechecks; no presumed new approval table for a small pilot.
- **Tests:** A-counter cannot target B batch/all tenant audience; allowed session notice; communications withdrawal/guardian-only audience; failure/capture success distinct from delivery.

### R04 — Counter staff can perform unrestricted historical staff attendance correction

- **Affected/capability:** Reception, staff.attendance correction. **Severity:** Medium. **Pilot blocker:** Yes unless reception's historical correction authority is explicitly approved and operationally reviewed.
- **Current → recommended:** any historical date/status/late/check-in/out correction with note → Reception records present-day provisional attendance at own site; Owner/Admin owns historic changes and correction to pay-input facts. Staff self-service stays self-only. Accountant reviews payroll inputs later but does not manage people attendance.
- **Evidence/provenance:** **C** `staff-attendance-correction.ts:19–26,74–95,104–173`; no date window/approval/locked-period check, Reception grant `roles.ts:78`. This policy issue is separate from A04's actual site bypass.
- **Impact:** retrospective absence/late changes can affect disputes/payroll; audit reason is useful but does not provide review authority. No current completed automatic payroll claimed.
- **Industry/Aqua:** Mindbody configurable Time Clock control; Aqua scope `project-scope.md:363` describes manual correction by admin and always audited, while reception can assist attendance without seeing pay.
- **UI:** same-day attendance capture; “Request correction” or owner-assisted reasoned correction for history; explicit notification to Owner on significant change.
- **Permission/service/DB:** narrow correction gate/date policy separate from routine mark; include actual timestamp before/after in atomic audit; no enterprise multi-step workflow required.
- **Tests:** past-date receptionist refusal, own-site today positive, owner correction with reason, marker self-correction policy, pay-period locking deferred until payroll exists.

## 11. Missing responsibilities

Missing functionality is not automatically a pilot blocker; each row states the narrow needed outcome, not a demand to build every roadmap module. Categories here are “Missing responsibility.”

| ID / role / severity / provenance | Missing ownership/workflow and evidence | Recommended assignment, minimal change, audit/data and regression | Pilot blocker |
|---|---|---|---|
| **M01 — Reception close-day; High; C + U** | Reception receives money and has confirmCashCountAction but no report/read/page: read requires reports.financial, UI Owner-only. `roles.ts:66–83`; `actions/reconciliation.ts:71–88`; `app/(owner)/owner/reports/collections/page.tsx:16–43`. | Reception executes assigned-location/current-day close; Owner reviews discrepancy/reopens; Accountant reconciles/history. Small Reception close screen and narrow current-day read, **not all financial reports**. Reuse existing service/count/audit, capture physical cash, reason >₹500; existing >₹2,000 manager close retained pending Owner policy. Regression start→cash/UPI→receipt→close with role/site/closed-state/variance. | **Yes for a pilot taking cash.** Owner manually doing every close is an explicit temporary operational decision, not evidence reception flow is complete. |
| **M02 — Fee-follow-up desk queue; Medium; C + U + N queue work** | Owner Fees dues exist; no receptionist due-soon/overdue task view; worker queues invoice/payment notices, not complete dunning. `lib/nav.ts:66–70`; `app/(reception)/reception/page.tsx:44–95`; `worker/index.ts:71–84`. | Reception handles assigned-site overdue calls/WhatsApp manually using minimal due/contact list; Owner decides fee concessions/disputes; Accountant validates ledger. Reuse invoice queries, no automation/gateway required. Record action/outcome only if new mutation added, with atomic audit. Regression restricted-site due list, cleared after partial/full payment, no aggregate profit/pay leakage. | No automatic blocker if a documented manual dues-list process exists; should fix before pilot to reduce missed collections. |
| **M03 — Guardian/consent maintenance and withdrawal intake; High; C + U + N contact UI** | Capture and send-time suppression exist; existing member/guardian amendment and purpose-specific withdrawal/offboarding UI not complete. `db/schema/consent.ts:72–119`; `actions/notification-destinations.ts` changes recipients, not consent withdrawal; owner/reception member detail only displays consent. `docs/implementation-plan.md` V-45–V-48 and `review-fixes-status.md:96–103` retain decisions. | Reception receives and verifies guardian requests; Owner resolves disputed guardianship/processing withdrawal and provides an audited approved process; platform supports legally agreed retention/export/erasure. Contact opt-out ≠ consent withdrawal. Minimum before real minors: named responsible person, working withdrawal/escalation route, verified guardian/evidence policy and tested downstream suppression. Append grants/history; never forge consent by staff action. Regression withdrawal→queued send suppressed, identity/evidence/child scope, audit rollback. Legal retention/offboarding needs owner/counsel decision; no invented migration. | **Yes for real children's data until an accepted usable process exists.** Synthetic UX is unaffected. |
| **M04 — Owner financial/business audit review; Medium; C + U** | Atomic business logs exist; `/ops/tenants/[tenantId]/audit` shows last 20 **platform** events, not payment/member corrections. No Owner financial/role/security business-log review surface. `app/(platform)/ops/tenants/[tenantId]/audit/page.tsx:25–34`; `lib/nav.ts:26–50`. | Owner reviews sensitive changes; Accountant reads financial correction evidence; Admin operational subset; no child token/Coach/Reception global audit. Minimal filterable exception/history view or owner-readable audited export/runbook during pilot; keep tenant/resource scope and protect sensitive before/after values. Tests finance subset/role/site/no secret payload. | No if a real operational review/export process is established; should fix. |
| **M05 — Parent schedule/location/help responsibility; Medium; C + U** | Only next-session DTO lacks location; progress is explicitly null; no full family schedule or supported correction contact from supplied data. `parent-view.ts:27–34,89–105,140–169,388`. | Parent/guardian reads linked child's next several sessions + venue/contact instructions; Coach owns progress capture; Owner authorizes publication; Reception supplies verified link/help. Pilot minimum location + useful staff contact, not a full family app. Keep zero-JS; schedule/progress expansion after pilot unless operationally essential. Token child/payment scope and production zero-script regression required. | No if venue is fixed and academy provides clear instructions; should clarify before pilot. |
| **M06 — Ops job/outbox/backup recovery ownership; Medium; C + U + N** | Heartbeat/API exists; no complete failed-job/exhausted-retry/outbox/backup status console. WhatsApp job stops at attempts<5; queued statuses are operational work nobody can currently resolve in the product. `whatsapp-notifications-job.ts:16–18,55–58`; `worker/index.ts:121–141`; Ops route inventory. | Ops owns monitoring, retry/escalation, restore drill; tenant Owner gets clear service-impact message only. Minimal external runbook/alerting can meet pilot without a new console. System-only scoped replay and actor/reason audit for human retry; never grant worker database privilege to a receptionist. Regression failed/blocked/duplicate send, no-credentials alert, worker stale, restore from exact backup bytes. | **Yes unless functioning external monitoring/backup/restore ownership is demonstrated.** GUI itself can wait. |

## 12. Duplicated or ambiguous responsibilities

| ID / severity / provenance | Evidence and operational consequence | Recommendation / tests / pilot |
|---|---|---|
| **D01 — Medium; C + U** — Job types versus login roles/default membership | Staff screen says one person can hold multiple roles (`app/(owner)/owner/staff/page.tsx:43–45`); staff schema permits several staff types (`db/schema/staff.ts:35–42`), but memberships are unique tenant+user and default membership chooses one priority (`db/schema/memberships.ts:39`; `db/platform.ts:184–219`). Owner may be a coach by employment yet cannot enter Coach surface (`surface-access.ts:18–24,50–64`); Owner has attendance permission but no useful register. | Define **one pilot login role per tenant** with documented owner-coach execution path (owner-authorized register in its own frame or approved role switch later). Don't claim arbitrary simultaneous roles. Choose which of multiple staff rows is self identity; `staff-self.ts:17–27` currently takes first. Tests Owner who teaches a session, cross-tenant default selection, dual job-type own check-in and no accidental scope union. **Blocker only if owner-coach/dual-job execution is required by pilot.** |
| **D02 — Medium; C + U** — Member “paused” versus plan subscription “paused/cancelled” | `components/member-subscription-panel.tsx:19–21` explicitly says independent lifecycle; Owner Overview shows both member status and subscriptions, Reception subscription management but no member lifecycle UI. A paused member can look paid/active in the plan; cancelling a plan does not necessarily archive a member. | Rename and explain “Academy participation” versus “Paid plan”; define one operational rule for attendance eligibility, renewal/pause billing and multi-plan members. Avoid automatically coupling all plans without product decision. Tests each state combination, future enrolment and same-child parent runway wording. No extra schema presumed. **Should fix copy/pilot policy; not a confirmed forbidden mutation.** |

Intentional duplication investigated: Owner and Reception admission/payment panels share actions/services; this is assisted responsibility, not two money implementations. Staff link in Settings and sidebar is a shortcut, not a duplicate staff service. Invoice issuance by system and counter shares issueInvoiceInTx and duplicate protection; preserve this design. Import matches by supplied code without comparing identity (`member-import-match.ts:18–22`): a meaningful **product decision required**, not counted as another confirmed authorization defect or duplicate responsibility.

## 13. Recommended role charters

For a small Indian academy, keep **Owner, optional Operations Manager (renamed Administrator), Receptionist and Coach** as real pilot roles. Accountant is optional only after usable narrow financial entry exists; otherwise Owner handles finance. Human Worker/Student portal postponed. Parent remains a link recipient, not a staff role. Background system is never the human Worker template.

| Role / primary purpose | Daily / occasional responsibility | Needed information and quick actions | Mutations / prohibitions / approval / escalation | Scope / device / dashboard / navigation |
|---|---|---|---|---|
| **Platform Ops** — run platform | Daily health/failed jobs/tenant interventions; occasional provision/preset/entitlements/recovery/backup restore. | Freshness + service health, failed queue/capture/outbox, tenant state/config, security support evidence. Quick provision/open tenant/investigate failed job. | Control-plane mutations + audited restricted support; no routine member/invoice/attendance operator. Own platform approvals; human infrastructure release/restore authorization. Academy business dispute escalates Owner. | Platform-wide operational aggregates; explicit tenant-target support. Laptop 1280×900. Home intervention queue + real freshness/health, navigation Overview/Tenants/Features/Presets/Leads/Activity/Health. |
| **Owner** — business health and final authority | Daily collections/dues/capacity/exception review and cash-close review; occasional staff/fees/tax/location/guardian disputes, security recovery. Can cover counter or teach in small academy. | Actual collected/owed, overdue people, site exceptions, uncovered sessions, correction history; quick dues/open counter/member/approve correction. | Full tenant business mutations with reasons/audits; approves pricing, sensitive void/refund, history/role/access/Owner recovery. No platform entitlement changes, no pretending PSP refund occurred. Escalates platform outages to Ops. | Tenant-wide by explicit ownership; phone 390×844 + desktop 1280×900. Dashboard money + decisions + capacity, not register completion as only hero. Nav Home/Members/Reports/Settings plus visible Fees/Operations/Staff/Communication destinations. |
| **Operations Manager (Admin)** — run agreed sites | Daily schedules/enrolments/enquiries/coach cover/operational attendance review; occasional routine staff invites/leave/site setup delegated by Owner. | Site roster/capacity/dues necessary to assist service; own operational exception queue. | Manage assigned operations, routine staff below own authority; no Owner bearer credentials/pay settings/owner-level identity access; sensitive fee/tax/QR changes only explicitly delegated. Owner approval for historical financial correction/refund/access elevation. | Assigned locations; laptop + phone Owner-like **manager** frame with filtered nav. Dashboard today ops/coverage/queues, not “Owner console.” Escalate sensitive disputes to Owner. |
| **Accountant (optional)** — reconcile records | Daily ledger/receipts/count/reversal review; occasional invoice corrections/reports/export and owner-approved refund bookkeeping. | Payer identity/contact, plans/invoices/payment/reversal/date/site/reference, count provenance; quick reconcile/open receipt/record approved correction. | Financial recording/invoice work under approved policy; no medical/guardian evidence, enrolment/coach/staff/settings operations. Owner approves actual payout/refunds; small reasoned bookkeeping error reversal may be delegated with review. | Tenant-wide financial or assigned finance sites; desktop. Dashboard unclosed counts/unreconciled entries/corrections, navigation Finance/Invoices/Collections/Reports/Me. No Owner general home. |
| **Reception** — serve counter and close shift | Daily enquiries/admissions/verified guardian/consent capture, enrolment/approved plan invoice, cash/UPI reference record, receipts/check-in/dues calls/current-day close; occasional owner-assisted correction. | Minimal member/contact/guardian safety/admin facts and specific balances; current-site sessions, enquiries/tasks, expected cash and closing state. Quick lookup/admit/enquiry/collect/receipt/close. | Routine scoped mutations and verified consent witnessing, not granting on behalf of guardian. No pricing, staff roles/PIN reset/global broadcast, payment reversal/actual refund, historical staff edit or sensitive void without Owner. Escalates discrepancies/guardian disputes/fee corrections to Owner. | Assigned locations; shared named-user counter and phone target. 390×844 currently; decide desktop support explicitly. Dashboard work-now/lookup/payment/follow-up/close status; four-item Today/Add member/Enquiries/Me with contextual collection/close links. |
| **Coach** — teach and record assigned learners | Daily next session/attendance/medical safety context/skill assessment, own check-in; occasional own leave, session disruption/correction request. | Assigned eligible roster, last marks/progress/unassessed learners, essential guardian emergency contact. Quick Open register/Late/Absent/Assess/own check-in. | Assigned/session-effective attendance and append assessments; no invoice/dues/staff/global member/export/makeup entitlement or arbitrary schedule mutation. Historical corrections reasoned or Owner-escalated under agreed window. | Assigned sessions/members plus assigned sites; substitute handling explicitly session-aware. Phone 390×844, one-handed, offline only bounded assigned register. Nav Today/Schedule/Members/Me; escalation Owner/Manager. |
| **Parent/guardian** — understand linked child | Daily next session/location/attendance/amount due; occasional verify details, request correction/withdrawal/help. | Child's readable schedule, last attendance, paid/due with receipt meaning, academy contact; no staff terminology. | Pilot read-only, request help through academy; no payment action/attendance mutation/other child lookup. Guardian approves consent, not Reception. Owner resolves disputed authority. | Guardian-linked children by verified issuance; current technical token is per-child bearer. WhatsApp→zero-JS phone link; no global nav/account requirement; child sections + help. |
| **Adult member** — understand own participation | Read own session/attendance/dues; occasional own verified information/consent request. | Same limited member view, without fictitious child/guardian language. | No staff mutations or self-check-in until scanner/workflow approved; no access to other people. | Self-only bearer view if explicitly adopted; otherwise postpone portal promise. Phone/WhatsApp. |
| **Human Worker** — attend own shift / assigned tasks later | Own check-in/shift/leave; maintenance tasks only once implemented. | Own assigned task/shift and facility safety instructions, no members/money. | staff.self only; no roster-building/leave approval/others' history. Manager approves leave; safety incident escalates manager immediately. | Self/assigned tasks, phone. Postpone login until useful landing exists. No Parent home, no roster-management permission. |
| **Background system** — execute bounded jobs reliably | Generate sessions/invoices/expiry, rollups, queued notifications, export/checkpoint, heartbeat; retries as system policy. | Tenant job ID + minimal resource/recipient data/current eligibility; job health, no dashboard. | System-only entry points, explicit no-human identity, tenant scope, idempotency and atomic audits. No human sessions, no migration role, no arbitrary human action shim. Escalates failed/exhausted work to Ops. | Tenant-ID jobs; specific platform aggregate job; no device. |

Role disposition: **retain** Owner/Reception/Coach/Ops; **rename/narrow** Administrator to Operations Manager; **retain conditionally/narrow** Accountant; **postpone/narrow** Human Worker; **do not introduce** authenticated Parent/Student staff templates for this pilot; **keep distinct** system actor. No complex approval engine needed: one Owner escalation for exceptional money/identity/history, routine counter actions immediate and audited.

## 14. Recommended permission and responsibility matrix

Explicit scope legend: **PW** Platform-wide; **TW** Tenant-wide; **AL** Assigned locations; **AS** Assigned sessions; **AM** Assigned members; **GC** Guardian-linked children; **SO** Self-only; **SYS** System-only; **—** No access. `r` means read-only; `exec` executes an agreed policy; `approve` authorizes exception. Scope plus verb matters: read-only AL is not approval authority. Accountant conditional on supported pilot finance entry; future-only capability is labelled `later`. Worker is background system; human Worker remains SO outside this column.

| Capability | Ops | Owner | Admin/Manager | Accountant | Reception | Coach | Parent | Member | Worker |
|---|---|---|---|---|---|---|---|---|---|
| Tenant provisioning | PW | — | — | — | — | — | — | — | — |
| Academy settings | PW support | TW | AL delegated | TW-r finance | AL-r needed | AS-r needed | — | — | — |
| Location configuration | PW provision | TW | AL delegated | AL-r finance | AL-r | AS-r | GC-r venue | SO-r venue | — |
| Feature configuration | PW | TW request | AL request | — | — | — | — | — | — |
| Programs | PW preset | TW | AL | — | AL-r | AS-r | GC-r | SO-r | — |
| Batches | — | TW | AL | — | AL-r/enrol | AS-r | GC-r | SO-r | — |
| Sessions | — | TW | AL | — | AL-r/request | AS-r/request | GC-r | SO-r | SYS generate |
| Schedules | — | TW | AL | — | AL-r | AS-r | GC-r | SO-r | SYS generate |
| Member creation | — | TW | AL | — | AL | — | — | — | — |
| Member editing | — | TW | AL | AL-r payer | AL routine | AM-r safety | GC-r/request | SO-r/request | — |
| Guardian management | — | TW approve dispute | AL routine | — | AL verified | AM-r emergency | GC verify/request | — | — |
| Consent | — | TW process oversight | AL witness | — | AL witness/intake | AM-r essential | GC grant/request | SO grant/request | SYS suppression |
| CSV import | — | TW approve | AL | — | AL assisted approved | — | — | — | — |
| Enrolment | — | TW | AL | AL-r finance | AL | AM-r | GC-r | SO-r | — |
| Member transfer | — | TW | AL both endpoints | — | AL routine | AM-r/request | GC-r | SO-r | — |
| Coach assignment | — | TW | AL | — | AL request | AS-r own | GC-r | SO-r | — |
| Attendance marking | — | TW if teaching/cover | AL delegated | — | AL counter | AS eligible AM | — | — | — |
| Attendance correction | — | TW approve history | AL reasoned | — | AL current-day/request | AS bounded/reasoned | GC request | SO request | — |
| Assessments | — | TW oversight | AL oversight | — | — | AM append | GC-r later | SO-r later | — |
| Enquiries | — | TW | AL | — | AL | — | — | — | — |
| Trials | — | TW | AL | — | AL | AS eligible participant | GC-r | SO-r | — |
| Invoice creation | — | TW | AL approved prices | AL | AL approved prices | — | — | — | SYS recurring |
| Discounts | — | TW approve later | AL request later | AL exec later | AL request later | — | — | — | — |
| Invoice cancellation | — | TW approve | AL delegated/reason | AL exec policy | AL request | — | — | — | — |
| Payment recording | — | TW | AL | AL | AL | — | — | — | — |
| Payment reversal | — | TW | AL delegated/reason | AL bookkeeping policy | AL request | — | — | — | — |
| Refund handling | — | TW approve later | AL request | AL approved exec later | AL request | — | GC request | SO request | — |
| Cash reconciliation | — | TW review/reopen | AL review delegated | AL reconcile | AL current-day exec | — | — | — | SYS rollup |
| Receipts | — | TW-r | AL-r | AL-r | AL-r | — | GC-r | SO-r | SYS generate if queued |
| Financial reports | PW aggregates | TW-r | AL-r needed | AL/TW-r finance | AL current-day only | — | GC-r dues | SO-r dues | SYS rollup |
| Operational reports | PW aggregates | TW-r | AL-r | AL-r finance-related | AL work lists | AS/AM-r | GC-r own | SO-r own | SYS rollup |
| Staff invitations | PW exceptional Owner | TW | AL lower-trust delegated | — | — | — | — | — | SYS notice |
| Role assignment | PW exceptional Owner | TW approve | AL lower-trust delegated | — | — | — | — | — | — |
| Staff PIN reset / login credential | PW verified support | TW stronger targets | AL lower-trust only | SO recovery | SO recovery | SO recovery | — | — | — |
| Announcements | PW platform notice | TW | AL operational | — | AL operational delegated | AS request/info | GC-r | SO-r | SYS dispatch |
| Parent-link issuance | — | TW verified recipient | AL verified recipient | — | AL request/assist | — | — | — | — |
| Parent attendance view | — | TW-r | AL-r | — | AL-r service | AM-r | GC-r | SO-r | — |
| Parent financial view | — | TW-r | AL-r | AL-r | AL-r invoices | — | GC-r | SO-r | — |
| Café orders | — | TW cover | AL | AL-r ledger | AL exec if enabled | — | — | — | — |
| Bookings | — | TW later | AL later | AL-r invoice later | AL later | AS-r later | GC-r later | SO-r later | — |
| Member check-in | — | TW cover | AL | — | AL eligible | AS eligible | — | SO later | — |
| Staff check-in | — | SO | SO | SO | SO | SO | — | — | — |
| Staff attendance correction | — | TW reasoned | AL history policy | — | AL today/intake | SO request | — | — | — |
| Staff roster/leave approval | — | TW | AL | — | AL-r operational | SO own | — | — | — |
| Messaging | PW support | TW entitled | AL entitled | — | AL operational | AS requested | GC-r | SO-r | SYS current eligibility |
| Audit-log access | PW platform | TW-r | AL-r operational | AL-r finance | SO own receipts/actions | SO own actions | — | — | SYS checkpoint/export |
| Backup and restore | PW infrastructure human-approved | — | — | — | — | — | — | — | SYS separate privileged backup process |
| System health | PW | TW-r service impact | AL-r service impact | — | — | — | — | — | SYS heartbeat |
| Worker monitoring/recovery | PW | TW-r impact | AL-r impact | — | — | — | — | — | SYS |

### Ownership changes and timing

| Change | Gain / lose | Why / approval | Timing |
|---|---|---|---|
| A01 session lifecycle | Owner/Manager explicit authority; Coach/Reception lose arbitrary execution | Teaching attendance ≠ academy scheduling. Owner decides Reception delegation; routine manager reschedule needs no extra enterprise approval. | Before pilot. |
| A02 makeup entitlement | Owner/Manager grant, Reception valid redemption; Coach loses grant/arbitrary credit reads | Free-session exception and actual eligibility must be accountable. Owner approves exceptional grant. | Before pilot or exclude makeup; still close hidden authority. |
| A03 assessments | Coach gains legitimate assigned/substitute coverage; loses unrelated members | Minimum-necessary children's information and coaching competence; normal assigned assessment requires no owner approval. | Before pilot. |
| A04/A07 location enforcement | Restricted managers/Reception only assigned locations; Owner retains explicit TW | UI filter cannot widen scope. Decide multi-site target staff/NULL location policy once. | Before multi-site pilot. |
| A05 Human Worker | SO self-service retained; management roster/approval removed | Ground staff task role is not roster manager. | Before inviting Worker; surface later. |
| A06 Owner credentials | Owner/Ops verified support retain; Admin loses Owner-target tokens | Higher trust identity/pay boundary cannot be bypassed by recovery. | Before pilot. |
| R01 invoice void | Owner/approved Accountant gain clear duty; Reception loses default void | Keep counter invoice issuance frictionless, cancellation reasoned and reviewable. | Before pilot unless explicitly bounded policy accepted. |
| R02/C01 Accountant | Finance projection/entry gained; medical/operational affordances lost | Reconciliation needs payer/ledger, not whole child record. | Before using Accountant; otherwise defer role. |
| R03/R04 Reception notices/history | Narrow current-site/day execution retained; global/history authority narrowed | Counter routine work immediate; exceptional communication/history escalates Owner. | Before enabling affected real workflow. |
| M01/M02 Reception close/follow-up | Narrow desk read/actions gained; Owner loses routine counter burden, retains review | Cash/UPI academy operations require execution at the desk. | Close before cash pilot; fee queue should fix. |
| M03/M05 Parent intake/visibility | Verified guardian gains understandable request/help path; staff retains attestation/process rather than claiming consent authority | Child scope/evidence and real communication must be practical. | Minimum usable intake before minors; expanded progress/schedule later. |
| D01 Owner-coach | Owner gets supported teaching path; no silent permission union | Small academies often owner-operated. Product choice, no second shared identity. | Before pilot if owner teaches; general role switching later. |

## 15. Separation of duties

| Sensitive operation | Execution / approval model for pilot | Record and interaction requirement |
|---|---|---|
| Staff role/location changes | Owner approves access elevation; Manager may invite lower-trust staff in assigned sites. No unchecked custom grant builder required. | Before/after role/sites, actor/reason, atomic audit; confirm elevated access; last-owner safeguards; denied direct-action regression. Existing post-invite edit UI is incomplete. |
| Staff PIN / Owner credential reset | Own verified recovery; Owner/co-owner for Owner target; exceptional Ops recovery with actual identity verification. Manager only lower-trust targets. | Single-use/time-limited token, no token in logs, issuance actor/target/reason; session revocation on reset; protect relogin as well as reset. |
| Consent attestation | Guardian/adult grants; Reception/Manager witnesses evidence, Owner responsible for disputed/withdrawn consent handling. | Immutable/versioned grant/evidence; separate witness/granter, no fabricated grant. Mandatory operator attestation on import, not pre-checked checkbox. |
| Member import | Owner/Manager planned operation; Reception assisted only approved/local scope. | Preview, row errors, import identity/idempotency, minor guardian/evidence, confirmation before commit, same-transaction creation/consent/audit. No routine two-person approval for an ordinary 20-row verified register import. |
| Fee/plan/QR/tax changes | Owner; Manager only explicit delegation; Accountant can advise/read; Reception sells existing approved plan. | Future invoices use approved values, issued document snapshot preserved, reason/before/after audit, confirm tax/payment destination changes. |
| Invoice cancellation | Owner/approved financial operator; Reception asks for correction. | Reason, unpaid/history semantics, invoice retained as void rather than deleted, atomic audit and confirmation. |
| Payment reversal | Owner/Manager/Accountant within explicit bookkeeping policy; Reception initiates/escalates, Coach never. | Append-only reversal, original capture preserved, cumulative ceiling/concurrency lock, reason/actor/audit; distinguish recording error from refund payout. |
| Actual refund | Owner approves amount, recipient and external payout; financial staff records verified execution only when supported. | R1 reversal is not a PSP payout. Do not promise cash was returned from invoice status alone; receipt/cash-close consequences must be defined. Full refund/credit-note module can remain deferred. |
| Cash count/correction | Reception current-day/site first count; Owner/Manager reviews >₹500 and authorizes >₹2,000 close/reopen according to current policy; Accountant reconciles. | Closed rows never overwritten; reason, variance and superseded recount history; atomic audit; safe uncertain-response recovery and no false Recount button. |
| Parent-link issuance | Owner/Manager verifies member/recipient; Reception requests assistance. No extra owner approval for every routine manager issue if authority/evidence policy is agreed. | Seven-day bearer, member/site validation, issuer/expiry audit without token, private verified delivery; decide wrong-recipient/revocation process. Don't call it authenticated guardian access. |
| Attendance correction | Coach current assigned register; Reception current-site check-in; Owner/Manager reasoned history correction/escalation. | Eligibility remains effective on session date; separate correction reason/window; append audit before/after with actor; offline replay/idempotency respected. |
| Tenant features | Ops admin entitlements/control-plane; Owner requests allowed configuration change; platform viewer read-only. | Closed scope, before/after entitlement audit, explicit dependency/GA/internal state, disabled actions refuse, operational impact confirmation. |

Mandatory atomic-audit gaps currently confirmed in **makeup**. Core member/enrolment/attendance/transfer fixes are present; don't replace their audit with activity events. Session lifecycle U now audits, but semantics/name should describe business mutation rather than only “notification.” Human credential issuance must be a dedicated auditable security event. Backup/R2 and HTTP delivery cannot join a Postgres transaction; use deterministic retry evidence, not claims of atomic external side effects.

## 16. Friend-pilot blockers and prioritized release conditions

### Must fix before friend pilot

1. **A01–A03:** stop attendance permission from granting session/makeup management; close assigned-member assessment read/write; validate/audit makeup and decide eligibility or exclude it.
2. **A06:** prevent Admin from obtaining Owner reset **and relogin** bearer credentials.
3. **A05:** remove Human Worker roster/leave-management authority or disallow Worker logins; UI absence alone is insufficient.
4. **A04/A07:** enforce target/site boundaries for staff correction and restricted-manager dashboard. Particularly blocking a multi-location friend pilot; do not claim site restrictions with these paths open.
5. **R01/R04:** agree and enforce Reception's invoice void/history correction policy; the recommended default is Owner escalation.
6. **M01:** provide a usable scoped close-day flow, or explicitly assign and rehearse Owner closure every day before accepting cash. A hidden confirm action is not a counter workflow.
7. **C01/R02:** fix Accountant landing/finance prerequisites and narrow child data **if this role is enabled**; otherwise postpone Accountant accounts.
8. **M03:** usable verified guardian/consent-maintenance/withdrawal intake and accepted evidence/offboarding policy before real children's data. Automated erasure is not automatically required for a synthetic friend demonstration; real-data responsibilities must be assigned and workable.
9. **M06/release:** prove deployed monitoring/worker, backup ownership and actual offsite upload/download/isolated restore; current checklist still records external verification pending. No report/compose file alone proves recoverability.
10. **QA/release:** human-owned fixture/auth expectations and a current green complete gate; current build/role/browser/host/offline/parent production artifact acceptance on an exclusive environment. This audit's failed shared-build attempt provides no release approval.
11. **Transport scope:** if the friend pilot needs real Ops login/tenant recovery over the new WhatsApp flow, resolve real supported transport. `getMessageProvider()` returns null for cloud/disabled (`lib/messaging/provider.ts:80–93`); capture/mock is only a synthetic preview. Existing sole-owner credential link may support a documented emergency route, but it is not proof of production Ops authentication.

No Critical finding was reproduced. A single-site, Owner-only **synthetic** test can proceed without treating all conditional role/site blockers as active real-data defects. That does not change the real friend-pilot NO-GO.

### Should fix before friend pilot

- C02 Owner money/exception priority and truthful metrics/labels; M02 desk dues queue or clear manual process.
- C03/C04 feature-aware caption/navigation and operational communication discoverability.
- C05 cash-close state/error recovery; D02 lifecycle terms/policy.
- C06 remove internal task IDs/unbuilt promises from staff-facing content; M05 venue/help clarity.
- Owner-coach execution D01 if applicable; confirm shared-counter named login/handover and responsive desktop expectations.
- Review reversal/refund/net-versus-gross cash/parent receipt explanations; do not introduce invented payment confirmation or gateway integration.

## 17. Safe post-pilot work and defence in depth

### Post-pilot recommendations (not additional counted defects)

- Custom editable role/permission UI, multi-role switching and delegated approval engine; first establish one-role pilot behavior.
- Dedicated Human Worker task/chemistry/maintenance and staff scheduling/payroll/profitability; membership QR scanner, customer bookings, wallet/café walk-in/full refund/credit-note workflows.
- Parent full schedule, published progress and verified family aggregation; keep zero-JS/read-only pilot boundary and no required installed app.
- Financial/per-location exports, nuanced Accountant/Manager read policies, reporting cohort/cost depth.
- Ops plan/quota/support impersonation tools and job/outbox dashboard; external reliable monitoring/runbook comes first.

### Defence-in-depth improvements

**H01 — Explicit human versus trusted-system context.** `ActionCtx` makes actor/role/location optional (`lib/auth/context.ts:42–43`), and `resolveLocationAccess` treats missing user as unrestricted (`location-access.ts:58–59`). New fixed action adapters preserve ctx but structural widening remains possible (A01/A07 illustrate it). Use a discriminated authenticated context and explicit system entry; never solve this by granting workers fake Owner sessions. Before pilot protect identified public paths; complete type-level refactor can follow with business-risk regression proof. No newly invented “missing actor attack over HTTP” is asserted.

**H02 — Core entitlement contract.** `permission.ts:42,87,139–144` forces six modules always on, even if Ops removes a feature entitlement. Independent probe confirms members.write with empty features still allowed, while payments.record fails. This is deliberate code, not labelled an accidental authorization bypass. Product must decide whether core is truly non-disableable: if yes, remove misleading disable UI/options; if no, enforce every action/UI. Likewise café action uses payments.record and bookings grant maps to pool.booking; internal catalogue status is not automatic action denial.

**H03 — Guardian-bound issue/revoke policy.** Fixed parent issuance verifies issuer and live member/site, but token possession is not proof of guardianship, and target input has no recipient guardian ID. Retain owner/manager verified delivery for pilot; document wrong-recipient/security escalation. Per-link revocation/guardian binding requires an approved design rather than an unsolicited token table. Cross-child receipt filtering is present; test actual parent sibling/receipt behavior in the release environment.

**H04 — Semantic scanners and tests.** Passing permission/action-shape/location scans did not detect A01–A07. Pin current seed grants and valid direct-action denial with positive controls; services should use one resource policy instead of several local functions named visibleMember. Source-map comments/action map must not classify authenticated parent issuance pre-auth. No protected tests were edited here.

## 18. Smallest consolidated implementation PR plan

**Three implementation PRs before affected pilot roles are enabled**, plus one optional later systems PR. No PR was created by this audit. Sequence and exact scope require product-owner approval.

1. **Role and authorization corrections.** A01–A07, narrow Owner credential issuer/target policy, Worker grants, explicit Reception void/history policy R01/R04, assessment/makeup resource checks and atomic audits. Prefer existing permission gates for the smallest safe pilot fix; add reviewed forward grant migration only where necessary. Include meaningful direct action/service/resource/rollback negatives. Protect corrected enrolment/history/roster/parent issuance regressions from regression.
2. **Navigation and content reassignment + counter responsibility.** Accountant narrow financial entry/projection or defer role (C01/R02); Reception scoped close-day read/UI (M01), meaningful service-now captions/feature visibility; clear closed-count state (C05); Owner/Manager naming and enabled-role navigation; parent venue/help; remove misleading unbuilt surfaces and stale promises. Same finance services, no duplicate money path. If governance prefers security-only PR1, put finance projection data access in PR1 and its navigation in PR2.
3. **Dashboard/workflow refinements and pilot evidence.** Owner money/exception view C02, scoped dues-follow-up M02, operational communication placement/policy R03/C04, lifecycle/owner-coach decisions D01/D02, minimum privacy intake responsibility M03 and operational handoff M06. Run exclusive disposable full gate and every real role journey at specified viewports, then human deployment/backup/restore checks. Do not make real WhatsApp/GST/payroll/booking expansion an accidental prerequisite: choose an honest pilot scope.
4. **After pilot: permission-system improvements.** Explicit system contexts, custom roles/surface policy, fine-grained current-day vs history/read/write keys, family revoke workflow, outbox/monitoring UI and agreed later modules. Not one PR per finding.

Delivery boundaries: same-transaction audit is non-negotiable for actual mutations; all schema/grant changes forward-only and human reviewed; no dependency or architecture change is authorized by this report. Do not reopen legacy auth to make old fixture tests green.

## 19. Product-owner decisions required

1. **Pilot actors and sites:** Is Accountant needed? Is a Human Worker login needed? Does the Owner personally coach? Single or multiple locations? Disable unsupported actors rather than seed them and claim usable workflows.
2. **Manager trust:** Rename Admin to Operations Manager? Which locations and settings may it change? Owner credential recovery must not silently imply Owner identity trust; who verifies exceptional Ops recovery?
3. **Counter financial authority:** Can Reception void only an immediately mistaken unpaid invoice, or must all cancellations escalate? Can Accountant reverse only bookkeeping errors without prior approval? Who approves and records actual cash/UPI refunds? Decide cash-count treatment of recording reversal versus physical payout.
4. **Attendance/makeup/trials:** Same-day correction window/reason/history approval; explicit trial/makeup eligibility and substitute coach assignment; may held sessions be moved? Owner-assisted teaching path.
5. **Location and feature semantics:** Core features always-on or truly disableable? Assigned-site defaults for Reception/Manager? NULL location resources tenant-wide? Café/booking actions available while pilot pages hidden/internal? Don't market switcher filtering as access control.
6. **Guardian/privacy ownership:** Evidence verification and disputed-guardian/withdrawal intake; who approves processing withdrawal/offboarding and legally required retained financial records; private bearer-link recipient verification, expiry/reissue/wrong-recipient process; adult self-view terminology. Obtain appropriate counsel decisions without inventing legal requirements in code.
7. **Communication/release:** Mock/capture-only synthetic preview versus real friend pilot; supported Ops/recovery transport; routine Reception audience authority; actual VPS/monitoring/backup/offsite restore and human release approver. Current consent/contact/outbox work does not provide real delivery.
8. **Import matching:** code-only skip of a differing identity accepted or conflict requiring review? Safe import undo/XLSX not pilot requirements unless owner requests them.
9. **Device support:** Current DESIGN intentionally tests Reception 390×844; scope describes counter desktop. Is a shared desktop/tablet an acceptance target? Add a supported viewport decision, not ad hoc desktop redesign.

## 20. False positives investigated and earlier risks rechecked

| Previous concern / tempting conclusion | Current status on audited branch/HEAD |
|---|---|
| Enrolment action loses actor/site | **Fixed in U**: complete ctx forwarding (`actions/enrolment.ts`), current resource guards; direct-action forwarding and A→B mutation refusal pass. Not a current open enrolment defect. |
| Attendance accepts non-enrolled/cancelled/inactive member | **Fixed in U + N**: attendance-mark locked transaction and effective eligibility; current tests reject out-of-roster/future enrolment/paused/cancelled cases and verify no rows. Explicit trial/makeup exceptions still need integration. |
| Parent issuance allows Reception/missing member/site | **Fixed in U + N**: explicit Owner/Admin, visibleMember before signing in audit tx; current direct action tests deny receptionist/missing/forbidden target. Guardian bearer delivery policy is separate H03. |
| Payment reversal visible button or automatic denied read for Reception | **Fixed UI in U**: current canRefund/canReadPayments are separate; invoice reverse visibility tests pass; no reversal read when payment-read grant missing. Reception invoice-payment history under invoices.read is intended counter information, not payment-report access. |
| Reversal history lacks location checks | **Fixed service in U**, `payment-reversals.ts:175–182` resolves payment location before rows. Source verified here; dedicated cross-location reversal regression not rerun in this audit. |
| First fresh deployment grants UPDATE/DELETE to append-only tables | **Fixed U + N**; one actual fresh db:deploy regression passes, including restricted announcement/notification/audit/activity partitions. Do not require a second deployment to mask defects. |
| Core enrolment/attendance/transfer audits/mark attribution missing | **Fixed U + N** for examined core paths. Resource-integrity tests verify mark actor, one identical-replay audit and audit-failure rollback; refused transfer stays byte-identical/no audit. Makeup remains an independent unaudited sibling (A02). |
| PIN failure increments race | **Fixed U**; five concurrent failures lock, expired-lock reset test passes. No global auth/host/OTP certification follows from this test. |
| Unsafe invoice sum loses paise | **Fixed U + N** for tested aggregate boundary; exact overflow refused before number allocation/persistence. Not counted as current financial corruption. |
| Retention inactive member offsets active risk | **Fixed U**; current active-cohort test passes. Owner dashboard denominator still needs real eligibility/cancelled-session quality review; not certified by this fix. |
| Parent recent marks show oldest instead of newest | **Fixed U**; current recent-attendance test passes. Existing fees/receipts/runway already implemented; do not rebuild them as missing. |
| Offline logout/account switch leaks all private data | **Substantial U + N fix present**: identity/lease/tombstone/cache purge and server namespace guards. Current identity/action tests pass; complete browser expiry/revocation/offline acceptance not rerun here. Prior-session Chromium results labelled historical. |
| Parent claims.personId is wrong FK type | **Dismissed as immediate broken view**: it intentionally carries member ID throughout sign→parent-view→receipt filtering, despite misleading name. Naming improvement is not proof valid links cannot work. |
| Ops and tenant share authentication | **Dismissed in design/source**: independent host cookie/platform session, tenant Better Auth context, host allowlists. A shared `/api/auth` URL prefix on Ops host is not itself an Ops session. Real proxy accepted hosts/HTTP E2E still need release proof. |
| All permission holders can enter all role layouts | **Dismissed**: page-level surface guards and explicit role map deny cross-frame access. But layout/page guards never authorize standalone actions; A01–A06 illustrate remaining sibling paths. |
| Background worker runs migration credentials/human Owner session | **No such current path found**: worker uses app-scoped boss/tenant-ID jobs and separate metrics scope. Optional missing-user service contexts are a structural risk, not proof the worker is impersonating a human. |
| All missing roadmap modules are pilot blockers | **Dismissed**: payroll, gateways, enterprise roles, installed parent apps, advanced booking/wallet/analytics can wait. Core security, practical cash closing/privacy ownership and recovery evidence cannot be replaced by future-module promises. |

## 21. Known limitations and untested areas

- This is a broad **source, current-grant, selective real-Postgres and component audit**, not an exhaustive authenticated browser crawl or instrumented SQL trace of every capability/state. Inventory/trace families cover the implemented surface, but individual unreviewed form/button copy and every service mutation/audit rollback are not certified.
- No independent user-review sample, store-listing comparison or vendor demo was obtained; complaints and unavailable competitor ACL details are explicitly unverified. Nine public products meet category breadth; they are not nine independently tested products.
- No real tenant's custom grants/location memberships, finance policy or guardian custody evidence was inspected. Matrix is seed/template + code behavior; edited tenants can differ. Existing role seeding intentionally preserves edits.
- Service probes use synthetic Ctx plus actual seed grants and action-shaped forwarding, not the seven newly discovered paths' browser HTTP invocation. Their public action call chains are source-confirmed. Production role-bypass driver **did not execute attacks** in this audit due shared `.next` build failure.
- No complete signed-in viewport acceptance: Owner 390×844/1280×900, Coach/Reception 390×844, Ops 1280×900, Parent phone with/without JS remain release checks. No new screenshots, accessibility certification, outdoor/wet-hand/assistive-tech testing, device latency or full loading/error/empty/long-data state matrix is claimed.
- No production parent-zero-JS artifact verification completed here; raw HTML route and prior-session artifact evidence exist, but a fresh production result is required after exclusive build. No browser SW actions were used against the existing user server; dedicated disposable browser testing must clear/unregister caches first.
- Suspended tenant/soft-deleted role/inactive membership, malicious origin/host, all current OTP replay/lockout paths, cross-child receipt HTTP, assigned substitute-session semantics and system-only/missing-actor paths were not comprehensively retested. Active-membership source resolution and tested RLS are not substitutes for these cases.
- No live WhatsApp/capture connection, real R2 upload/restore/timer, Dokploy/VPS/TLS/digest/persistent-volume/rollback, production reviewer settings, full dependency-advisory reachability, load test or business parallel/reference month verified. These external tasks remain explicit human release conditions.
- Full suite was not rerun; prior report's seven legacy auth failures/attendance-history fixture setup must be fixed by authorized humans and rechecked, not dismissed as irrelevant to the gate.
- Source fingerprints prove no audit-time changes in covered files. Ignored build artifacts changed during the attempted E2E and the existing dev process was left running. No clean build-state preservation or application-runtime readiness is claimed after that attempt; an exclusive clean build must be performed by the environment owner.

## 22. Final integrity, checksum and next action

This report is the only added repository deliverable. Temporary audit tests/config live outside the repository under `/tmp/opencode`; no repository regression tests were authored. Final source/branch/diff fingerprints are checked again after report creation. The report checksum is obtained **after the last edit** with:

```bash
sha256sum docs/audits/2026-10-09-role-content-permission-audit.md
```

The resulting final digest is recorded in the audit delivery response rather than embedded in these same bytes (a file cannot contain its ordinary own SHA-256 without changing it).

**Immediate next action:** product owner decides the narrow pilot actors/site/financial/attendance/privacy policies in §19, then authorize the consolidated role/authorization PR first. Treat this report as a remediation input, not release approval. Preserve current U/N fixes and do not assume the differently committed `origin/main` branch is the audited result.

## Appendix A — Captured working-tree files

**Staged files: none.** Every tracked path below was unstaged (` M`). This report did not exist at capture and is the additional untracked audit deliverable at completion. Paths with route-group parentheses are literal.

### Unstaged tracked files (141)

```text
.env.example
.github/workflows/ci.yml
CLAUDE.md
DESIGN.md
app/(coach)/coach/me/page.tsx
app/(coach)/coach/register/[sessionId]/page.tsx
app/(owner)/owner/announcements/page.tsx
app/(owner)/owner/fees/page.tsx
app/(owner)/owner/members/[memberId]/page.tsx
app/(owner)/owner/members/page.tsx
app/(owner)/owner/page.tsx
app/(owner)/owner/programs/page.tsx
app/(owner)/owner/reports/page.tsx
app/(owner)/owner/settings/page.tsx
app/(owner)/owner/staff/page.tsx
app/(platform)/ops/login/page.tsx
app/(platform)/ops/verify/page.tsx
app/(reception)/reception/me/page.tsx
app/(reception)/reception/members/[memberId]/page.tsx
app/api/auth/[...all]/route.ts
app/globals.css
app/layout.tsx
app/p/[token]/route.ts
components/announcements/announcement-composer.tsx
components/bottom-nav.tsx
components/facility-switcher.tsx
components/fees/fees-invoice-list.tsx
components/fees/fees-tabs.tsx
components/invitations-board.tsx
components/login-form.tsx
components/member-create-form.tsx
components/member-detail/invoice-expanded.tsx
components/member-detail/member-invoices-panel.tsx
components/member-enrolment-panel.tsx
components/member-status-panel.tsx
components/members-board.tsx
components/owner-dashboard.tsx
components/owner-reset-links.tsx
components/owner-shell.tsx
components/owner-side-nav.tsx
components/payment-record-form.tsx
components/premises-qr-card.tsx
components/register-board.tsx
components/sw-registrar.tsx
db/bootstrap-roles.ts
db/deploy.ts
db/platform-auth.ts
db/queue.ts
db/schema/index.ts
db/schema/people.ts
db/schema/platform-users.ts
docker-compose.dokploy.env.example
docker-compose.dokploy.yml
docker-compose.yml
docs/agent-setup.md
docs/architecture.md
docs/demo-runbook.md
docs/implementation-plan.md
docs/pilot-release-checklist.md
docs/pilot-remediation-checklist.md
docs/project-scope.md
docs/ui-redesign-implementation-plan.md
lib/actions/coach.ts
lib/actions/dashboard.ts
lib/actions/enrolment.ts
lib/actions/fees-hub.ts
lib/actions/invite-link.ts
lib/actions/owner-analytics.ts
lib/actions/owner-reports.ts
lib/actions/parent-link.ts
lib/actions/platform-auth.ts
lib/actions/programs.ts
lib/auth/action-permissions.ts
lib/auth/context.ts
lib/env.ts
lib/hooks/use-offline-register.ts
lib/messaging/mock-provider.ts
lib/messaging/provider.ts
lib/money/arithmetic.ts
lib/money/format.ts
lib/nav.ts
lib/offline/idb.ts
lib/schemas.ts
lib/services/absence-alerts.ts
lib/services/announcements.ts
lib/services/attendance-history.ts
lib/services/coach-member.ts
lib/services/dashboard.ts
lib/services/enrolment.ts
lib/services/fees-hub.ts
lib/services/invoice-issue.ts
lib/services/invoices.ts
lib/services/member-status.ts
lib/services/owner-analytics.ts
lib/services/owner-reports.ts
lib/services/parent-view.ts
lib/services/payment-reversals.ts
lib/services/payments.ts
lib/services/people.ts
lib/services/pin-lockout.ts
lib/services/programs.ts
lib/services/receipts.ts
lib/services/reconciliation.ts
lib/services/register.ts
lib/services/session-lifecycle.ts
lib/services/staff-invitations.ts
lib/services/transfer.ts
lib/services/waitlist.ts
middleware.ts
package.json
pnpm-lock.yaml
public/sw.js
scripts/check-tenant-conventions.ts
scripts/e2e-host-boundary.ts
scripts/e2e-offline.ts
scripts/e2e-platform-form-leak.ts
scripts/e2e-role-bypass.ts
scripts/lib/location-scope-scan.ts
scripts/lib/offline-page.ts
scripts/lib/offline-verify.ts
scripts/lib/tenant-conventions-scan.ts
scripts/seed-demo.ts
scripts/seed-platform-user.ts
tests/a11y/ops-focus-rendered.test.ts
tests/event-location.test.ts
tests/location-scoped-access.test.ts
tests/messaging-provider.test.ts
tests/mobile/coach-me-page.test.ts
tests/mobile/facility-switcher.test.tsx
tests/mobile/invoice-reverse.test.tsx
tests/mobile/member-invoices-panel.test.tsx
tests/mobile/members-import-entry.test.tsx
tests/mobile/owner-announcements.test.tsx
tests/mobile/owner-fees-hub.test.tsx
tests/mobile/owner-reports-page.test.tsx
tests/mobile/owner-shell.test.tsx
tests/offline/fake-indexeddb.ts
tests/offline/idb-tx-durability.test.ts
tests/offline/use-offline-register.test.tsx
tests/scanner-fixtures/tenant-conventions-fixtures.test.ts
worker/index.ts
```

### Untracked individual files at capture (156)

Tooling/skills were included in working-tree accounting but not treated as shipped product permissions. Relevant product N files were read directly; untracked migration files already existed and were exercised on disposable databases, not authored or changed by the audit.

```text
.agents/skills/better-auth-best-practices/SKILL.md
.agents/skills/vercel-react-best-practices/AGENTS.md
.agents/skills/vercel-react-best-practices/README.md
.agents/skills/vercel-react-best-practices/SKILL.md
.agents/skills/vercel-react-best-practices/rules/_sections.md
.agents/skills/vercel-react-best-practices/rules/_template.md
.agents/skills/vercel-react-best-practices/rules/advanced-effect-event-deps.md
.agents/skills/vercel-react-best-practices/rules/advanced-event-handler-refs.md
.agents/skills/vercel-react-best-practices/rules/advanced-init-once.md
.agents/skills/vercel-react-best-practices/rules/advanced-use-latest.md
.agents/skills/vercel-react-best-practices/rules/async-api-routes.md
.agents/skills/vercel-react-best-practices/rules/async-cheap-condition-before-await.md
.agents/skills/vercel-react-best-practices/rules/async-defer-await.md
.agents/skills/vercel-react-best-practices/rules/async-dependencies.md
.agents/skills/vercel-react-best-practices/rules/async-parallel.md
.agents/skills/vercel-react-best-practices/rules/async-suspense-boundaries.md
.agents/skills/vercel-react-best-practices/rules/bundle-analyzable-paths.md
.agents/skills/vercel-react-best-practices/rules/bundle-barrel-imports.md
.agents/skills/vercel-react-best-practices/rules/bundle-conditional.md
.agents/skills/vercel-react-best-practices/rules/bundle-defer-third-party.md
.agents/skills/vercel-react-best-practices/rules/bundle-dynamic-imports.md
.agents/skills/vercel-react-best-practices/rules/bundle-preload.md
.agents/skills/vercel-react-best-practices/rules/client-event-listeners.md
.agents/skills/vercel-react-best-practices/rules/client-localstorage-schema.md
.agents/skills/vercel-react-best-practices/rules/client-passive-event-listeners.md
.agents/skills/vercel-react-best-practices/rules/client-swr-dedup.md
.agents/skills/vercel-react-best-practices/rules/js-batch-dom-css.md
.agents/skills/vercel-react-best-practices/rules/js-cache-function-results.md
.agents/skills/vercel-react-best-practices/rules/js-cache-property-access.md
.agents/skills/vercel-react-best-practices/rules/js-cache-storage.md
.agents/skills/vercel-react-best-practices/rules/js-combine-iterations.md
.agents/skills/vercel-react-best-practices/rules/js-early-exit.md
.agents/skills/vercel-react-best-practices/rules/js-hoist-regexp.md
.agents/skills/vercel-react-best-practices/rules/js-index-maps.md
.agents/skills/vercel-react-best-practices/rules/js-length-check-first.md
.agents/skills/vercel-react-best-practices/rules/js-min-max-loop.md
.agents/skills/vercel-react-best-practices/rules/js-set-map-lookups.md
.agents/skills/vercel-react-best-practices/rules/js-tosorted-immutable.md
.agents/skills/vercel-react-best-practices/rules/rendering-activity.md
.agents/skills/vercel-react-best-practices/rules/rendering-animate-svg-wrapper.md
.agents/skills/vercel-react-best-practices/rules/rendering-conditional-render.md
.agents/skills/vercel-react-best-practices/rules/rendering-content-visibility.md
.agents/skills/vercel-react-best-practices/rules/rendering-hoist-jsx.md
.agents/skills/vercel-react-best-practices/rules/rendering-hydration-no-flicker.md
.agents/skills/vercel-react-best-practices/rules/rendering-hydration-suppress-warning.md
.agents/skills/vercel-react-best-practices/rules/rendering-script-defer-async.md
.agents/skills/vercel-react-best-practices/rules/rendering-svg-precision.md
.agents/skills/vercel-react-best-practices/rules/rendering-usetransition-loading.md
.agents/skills/vercel-react-best-practices/rules/rerender-defer-reads.md
.agents/skills/vercel-react-best-practices/rules/rerender-dependencies.md
.agents/skills/vercel-react-best-practices/rules/rerender-derived-state-no-effect.md
.agents/skills/vercel-react-best-practices/rules/rerender-derived-state.md
.agents/skills/vercel-react-best-practices/rules/rerender-functional-setstate.md
.agents/skills/vercel-react-best-practices/rules/rerender-lazy-state-init.md
.agents/skills/vercel-react-best-practices/rules/rerender-memo-with-default-value.md
.agents/skills/vercel-react-best-practices/rules/rerender-memo.md
.agents/skills/vercel-react-best-practices/rules/rerender-move-effect-to-event.md
.agents/skills/vercel-react-best-practices/rules/rerender-simple-expression-in-memo.md
.agents/skills/vercel-react-best-practices/rules/rerender-transitions.md
.agents/skills/vercel-react-best-practices/rules/rerender-use-ref-transient-values.md
.agents/skills/vercel-react-best-practices/rules/server-after-nonblocking.md
.agents/skills/vercel-react-best-practices/rules/server-auth-actions.md
.agents/skills/vercel-react-best-practices/rules/server-cache-lru.md
.agents/skills/vercel-react-best-practices/rules/server-cache-react.md
.agents/skills/vercel-react-best-practices/rules/server-dedup-props.md
.agents/skills/vercel-react-best-practices/rules/server-hoist-static-io.md
.agents/skills/vercel-react-best-practices/rules/server-no-shared-module-state.md
.agents/skills/vercel-react-best-practices/rules/server-parallel-fetching.md
.agents/skills/vercel-react-best-practices/rules/server-parallel-nested-fetching.md
.agents/skills/vercel-react-best-practices/rules/server-serialization.md
.agents/skills/web-design-guidelines/SKILL.md
.opencode/agents/aqua-review.md
.opencode/agents/aqua-ui-review.md
.opencode/commands/review.md
.opencode/commands/task.md
.opencode/commands/verify.md
.opencode/instructions.md
PRODUCT.md
app/(platform)/ops/api/whatsapp-auth/route.ts
app/api/login/pin-recovery/route.ts
app/api/offline/session/route.ts
app/favicon.ico
app/login/reset/page.tsx
components/charts/echarts-island.tsx
components/charts/echarts-trend.tsx
components/dashboard-trends.tsx
components/member-consent-choices.tsx
components/member-notification-destinations.tsx
components/tenant-sign-out.tsx
components/whatsapp-auth-form.tsx
db/app-privileges.ts
db/migrations/20261007160444_whatsapp_auth_notifications.sql
db/migrations/20261007164707_whatsapp_auth_scope_and_outbox_erasure.sql
db/migrations/20261008062416_whatsapp_notification_eligibility.sql
db/schema/whatsapp.ts
db/whatsapp-auth-complete.ts
db/whatsapp-auth.ts
docs/audits/2026-09-27-complete-codebase-assessment.md
docs/audits/2026-10-05-backend-frontend-documentation-review.md
docs/audits/2026-10-08-remaining-work-review.md
docs/demo-readiness-agent-handoff.md
docs/opencode-development.md
docs/review-fixes-status.md
docs/whatsapp-demo-flows.md
lib/actions/notification-destinations.ts
lib/auth/whatsapp-route.ts
lib/dashboard-charts.ts
lib/design-tokens.ts
lib/facility.ts
lib/jobs/whatsapp-notifications-job.ts
lib/jobs/whatsapp-notifications-schedule.ts
lib/messaging/invitation-notification.ts
lib/messaging/notification-enqueue.ts
lib/messaging/notification-events.ts
lib/messaging/staff-notification-eligibility.ts
lib/money/safe-paise.ts
lib/offline/client-session.ts
lib/offline/identity.ts
lib/offline/logout.ts
lib/offline/server-session.ts
lib/schemas/whatsapp-auth.ts
lib/services/attendance-mark.ts
lib/services/member-registration.ts
lib/services/notification-destinations.ts
lib/services/resource-access.ts
opencode.json
scripts/e2e-offline-privacy.ts
scripts/set-platform-phone.ts
skills-lock.json
tests/auth/offline-scope-action.test.ts
tests/db/first-deploy-grants.test.ts
tests/db/offline-privacy-driver.ts
tests/facility.test.ts
tests/messaging-capture-mock.test.ts
tests/mobile/a11y-fe08.test.tsx
tests/mobile/dashboard-trends.test.tsx
tests/mobile/member-status-recovery.test.tsx
tests/mobile/members-board-facility.test.tsx
tests/mobile/parent-recent-attendance.test.ts
tests/mobile/settings-onboarding-retire.test.tsx
tests/mobile/tenant-sign-out.test.tsx
tests/mobile/whatsapp-auth-form.test.tsx
tests/offline/fixture-identity.ts
tests/offline/identity-isolation.test.ts
tests/offline/use-offline-register-ssr.test.tsx
tests/parent-contrast.test.ts
tests/review-action-scopes.test.ts
tests/review-money-bounds.test.ts
tests/review-resource-integrity.test.ts
tests/whatsapp-auth-notifications.test.ts
```

The large tooling subtree was not independently audited as an application feature. `.env` contents/secrets were not copied into the report; `.env.example` is accounted for as existing user work.
