# Five-phase work guide — control plane and tenant onboarding

**For an agent working largely unsupervised. The human is reachable but not continuously present.**

| | |
|---|---|
| Scope | Platform control plane, tenant provisioning, presets, staff, documents, reporting |
| Phases | 5 (Phase 1 – Phase 5), totalling 42 substantive tasks. Reserve: R.1 – R.35. |
| Deliberately excluded | The money chain (C-28a onward). See §0 |
| Companions | `CLAUDE.md`, `DESIGN.md`, `architecture.md`, `implementation-plan.md`, `agent-lanes.md`, `agent-onboarding.md` |

The "five-day" framing was a planning convenience that conflated phases with calendar time. It has been reframed: **phases are ordered work units; sessions are calendar units**. A phase may take several sessions; a session may complete zero, one, or several tasks. Progress is read off the checklist, not the calendar.

---

## 0. Read this before starting

### What this batch is

Everything needed before a **second** club exists. Today the product serves one tenant provisioned by a CLI script. At the end of this batch, a platform admin can create a club, enable its features, onboard it with a preset, and hand its owner a working, branded instance.

### What is deliberately excluded, and why

**No money work.** Membership plans, subscriptions, invoicing, payments and WhatsApp are all out of scope for these five days.

The reason is not sequencing — it is that `membership_plans` and `subscriptions` need to support shapes nobody has confirmed yet: sibling discounts, proration on mid-month joins, pause-and-extend versus pause-and-forfeit, partial payment against an active membership. Those are schema, not configuration. Building them against assumptions means rebuilding them.

**If you find yourself needing a fee rule to complete a task, you have wandered out of scope. Stop and report it.**

### Working method

- **Open a PR when a unit is coherent and reviewable.** Some tasks are naturally their own PR (a single coherent capability, a new SQL table plus its tests, a single screen that stands alone). Others belong in a batch (the three steps of an onboarding wizard; the read + write + list surfaces for the same entity). The batching guidance was about review capacity, not a rule to hold against a natural boundary — small reviewable PRs beat one giant one. Open when ready; don't wait for a phase to finish.
- **Each task within a batch still gets full TDD and CI** — the batching is about review capacity, not rigour. Commit per task inside the batch so the diff is navigable; squash on merge if the reviewer prefers.
- **Before opening a new branch, run `gh pr list --state open`.** If a same-phase task's PR is already open and unmerged, stack the new work on it rather than forking off `main` — unless the new task shares no files with the open PR, in which case state "no shared files" in the new PR's description.
- **Rebase on main** before opening.
- **TDD.** Test red before implementation, every time.
- **Test the test.** Break the implementation, confirm red, restore.
- **Mark the checklist in the same commit as the work.** The checklist is how progress is read without opening reports; an unmarked checklist with committed work is a state I cannot interpret. Do not batch the marks to the end of a phase.
- Tasks are ordered. Where a task lists dependencies, respect them. Otherwise work in order.

### Autonomy

| Level | Meaning |
|---|---|
| **GREEN** | Build, verify, commit, open PR, continue to the next task. Do not wait. |
| **RED** | Stop before building. Write a proposal. Wait for approval. Move to the next GREEN task while waiting — do not idle. |

A short human acknowledgement ("ok", "sounds good", a thumbs-up) on a
session report is not an instruction to stop. It means "continue."
Only a RED proposal, a stated blocker, or an explicit "stop" ends a
session.

The human merges. You never merge a code or schema change yourself.

### When you are blocked

1. Two genuine attempts, then stop that task.
2. Write what you tried and what you need.
3. Move to the next independent task.
4. Never guess a product decision. Never invent a business rule.

### Standing rules — non-negotiable

Most are mechanically enforced and will stop you. These are the ones that are **not**, so they depend on you:

- `DESIGN.md` carries tokens; `docs/sports-club-ui-direction.html` carries composition. Read both before any screen.
- Every list gets a designed empty state with a verb CTA, built with the list.
- Scope discipline: build what the task asks, nothing adjacent.
- **When you find a bug, search for a second instance of the same shape before closing.** Seven for seven in this codebase so far.
- **A task is not done until the behaviour its text describes is reachable by the user it names.** A service function with no surface is half a task — the backend exists, the user can't act on it, and the next agent inherits a checked box that doesn't reflect reality. F3 audit response (Sep 2026): the seven R.1–R.7 tasks shipped backend only; their surfaces were promised in the task text and never built. Re-marking them done without UI would be the same class of failure.

### Pre-flight (before Phase 1)

- [ ] **Apply branch protection on `main`** — follow `docs/branch-protection.md` and verify with the GitHub API afterwards (`gh api repos/saurabh22suman/aqua/branches/main/protection` should return `require_pr: true`, `enforce_admins.enabled: true`, and `required_status_checks.contexts` containing `ci`). Until this is true, the merge discipline above is a documentation rule, not a platform guarantee; the diff between the two states is whether direct pushes are blocked by GitHub or by self-restraint.

---

## Phase 1 — Platform foundation

The control plane has schema but no surface. Nothing here touches tenant data.

- [x] **1.1** Platform auth — separate session from tenant users, own table, mandatory 2FA. Platform staff must not be reachable through the tenant login. `GREEN`
- [x] **1.2** Platform layout and shell — `(platform)` route group, dark marine sidebar (operators work from laptops, not poolside), login + 2FA verify + home under it. Visually distinct from tenant surfaces. `GREEN`
- [x] **1.3** Tenant list — all tenants with status, plan, member count, location count, created date. Searchable by name/slug; filterable by status. New `withPlatformAdmin()` scope + `platform_admin_select` RLS policy grant cross-tenant read for the operator. `GREEN`
- [x] **1.4** Tenant detail — settings (timezone, plan, currency, GSTIN, preset, offline-sync flag), locations (active, soft-deleted hidden), feature state (resolved from plan; overrides come in 1.8), usage stats (members, locations, sessions this month), recent platform activity. Read-only. `GREEN`
- [x] **1.5** Create tenant — slug, name, timezone, plan, first location. Replaces the CLI path in `F-25`. `/platform/tenants/new` shipped; `tests/tier1/platform-tenants-create.test.ts` covers the action shape. `GREEN`
- [x] **1.6** Tenant status lifecycle — trial, active, suspended, churned, with reasons and audit. A suspended tenant's users cannot log in and see a clear message. `db/platform-tenant-status.ts` + `/platform/tenants/[tenantId]/status-transitions.tsx`. `GREEN`
- [x] **1.7** Feature catalogue screen — every feature, its category, its status. Editable. `/platform/features/page.tsx`. `GREEN`
- [x] **1.8** Per-tenant feature toggles — override plan baseline, with expiry for trials and betas. Toggling changes both API behaviour and rendered navigation. `/platform/tenants/[tenantId]/tenant-feature-toggles.tsx`. `GREEN`

**Phase 1 gate:** a platform admin creates a tenant, enables features, and the tenant's owner sees exactly those features. No CLI involved.

---

## Phase 2 — Onboarding and presets

- [x] **2.1** Preset definitions — wrote swimming (full) and multi-sport (full) per `architecture.md` §7.4. Others stay documented stubs. **No prices** — plan shapes only, amount null. `db/preset-definitions.ts` ships both. `GREEN`
- [x] **2.2** `applyPreset` UI — pick a preset at tenant creation, preview what it will seed, apply in one transaction. `/platform/presets/[key]` shipped. `GREEN`
- [x] **2.3** Sample data flagging — seeded example batches and programs carry `is_sample`, with a one-tap "remove sample data" action that disappears once anything real attaches. `db/preset-sample-data.ts` + `remove-sample-data.tsx`. `GREEN`
- [x] **2.4** Preset lock — `applyPreset` refuses once a non-sample member exists. Test in `tests/tier1/apply-preset-action.test.ts`. `GREEN`
- [x] **2.5** Onboarding wizard, step 1 — club details, timezone, first location. `new-tenant-form.tsx` walks slug, name, timezone, currency, GSTIN, plan, primary location. `GREEN`
- [x] **2.6** Onboarding wizard, step 2 — preset selection with preview. `/platform/presets/[key]` carries the picker + preview + apply against an existing tenant. `GREEN`
- [x] **2.7** Onboarding wizard, step 3 — invite the owner, assign role. `invite-owner-action.ts` + `invite-owner-form.tsx` + `db/tenant-invite.ts`. `GREEN`
- [x] **2.8** Onboarding checklist — the new tenant's owner sees what remains: add members, create batches, assign coaches. Each item links to where it is done. `GREEN`
- [x] **2.9a** Tenant branding UI — club name, short name, accent editor (six-key picker, runtime accent via `--accent`, never a hex). Fallback initials mark renders when nothing is uploaded (inline SVG, no external request). Editor is management-only; coach/receptionist keep the read-only surfaces. `GREEN`
- [ ] **2.9b** Logo and square mark upload to R2 — **blocked on dependency approval** (`@aws-sdk/client-s3` or equivalent; R2 has no client in this repo today, F-17's setup, also C-07 documents share the same need). Proposing the storage + upload-path architecture as a RED before adding the dependency.
- [x] **2.10** Terminology editor — the eight closed `TERM_KEYS`, singular and plural, per locale. Changing "member" to "swimmer" updates the app and leaves `member_code` untouched. Owner dashboard now reads `members`/`batches`/`sessions` through the closed-key resolver, proving the wiring end-to-end. Database columns stay canonical. `GREEN`

**Phase 2 gate:** a tenant is created, preset-seeded, branded and owner-invited entirely through the UI.

---

## Phase 3 — Documents, staff, support

- [ ] **3.1** **Documents — token scheme** `RED` — proposal in `docs/red-proposals.md`. Implementing once approved (open question: pre-expiry revocation + denylist).
- [ ] **3.2** Documents schema and upload — `documents` table, R2 private bucket, tenant-prefixed keys, RLS. Requires the new dependency flagged in the C-07 proposal — **ask before adding it**. `GREEN` (after 3.1 approved)
- [ ] **3.3** Document proxy route — `/api/documents/[token]`, server-side role check, streams from R2, never exposes an R2 URL, logs every access. `GREEN` (after 3.1)
- [ ] **3.4** Document UI — upload and view on the person detail screen, role-gated: owner/admin/receptionist full, coach read-only for their own roster. `GREEN` (after 3.1)
- [x] **3.5** Staff directory — list, detail, create, edit. `C-04` shipped schema and services; this is the missing UI. (Edit + delete land with 3.6's invitation-revoke path; both share the audit + state machine there.) `GREEN`
- [x] **3.6** Staff invitations — invite by phone, assign role and locations, accept, revoke, resend. Completes `F-24`. Accept happens via better-auth OTP on first login (no separate UI); resend is a no-op pending the messaging chain. `GREEN`
- [x] **3.7** Seed a receptionist login — `scripts/seed.ts` had no receptionist row, so the `assertStaff` permission path was exercised only in unit tests with hand-fabricated ctx. Added `+919000000005=receptionist` to LOGIN_USERS. `GREEN`
- [ ] **3.8** Support impersonation `RED` — proposal in `docs/red-proposals.md`. Implementing once approved (role gate on initiation, two-layer context, persistent banner, tenant-side session block, inactivity timeout, no suspended/churned tenants).
- [x] **3.9** Platform activity log — who did what across tenants, filterable, append-only. Action / tenant / date filters; tenant-name join on the row so the UI doesn't need a second round trip; total count independent of pagination. `GREEN`

**Phase 3 gate:** a child's photograph is uploadable and viewable, and no unauthenticated URL resolves to it. Prove it. *(Blocked on 3.1 token scheme.)*

---

## Phase 4 — Reporting and views

Everything here reads data that already exists. No money.

- [x] **4.1** Attendance history UI — wire the service built in `C-27` into the member detail view. Per-member history, monthly percentage. `GREEN`
- [x] **4.2** Per-batch attendance summary — `/owner/batches/[batchId]` shows the month's headline figure and present-marks detail. The existing programs board's batch name is now a Link to this page. `GREEN`
- [x] **4.3** Attendance report — by batch, by program, by period, with CSV export using canonical field names, not tenant vocabulary. `GREEN`
- [x] **4.4** Enquiry funnel report — counts and conversion by source and stage over time. Figures reconcile to the `enquiries` table exactly. `GREEN`
- [x] **4.5** Retention view — members at risk by attendance signal. **Aggregate and batch-level only.** No per-minor profiling. `GREEN`
- [x] **4.6** Coach load view — sessions per coach per week, utilisation. `GREEN`
- [x] **4.7** Owner dashboard — capacity lanes for today, needs-attention with reasons, member and attendance figures. **No money tiles.** Wired through Phase 2.9/2.10 (branding + terminology) and Phase 4.1 (attendance history) — verified still resolves through the closed-key helpers. `GREEN`
- [x] **4.8** Coach home — today's sessions, this week's schedule, their own roster. Coach-scoped reads via `coach-scope` queries; the roster surface shows each coached member's name and batches. `GREEN`
- [x] **4.9** Member detail completion — attendance, documents, guardians, consent, status history in one coherent view. The phase-2 member detail page already carries every panel; this was a verification rather than build. `GREEN`

**Phase 4 gate:** an owner can answer "how is my club doing" without asking anyone. *(Partial — 4.2 per-batch summary and 4.8 coach home still open.)*

---

## Phase 5 — Import, polish, hardening

- [ ] **5.1** Importer — upload and column mapping. CSV and XLSX, header detection, saved mapping presets. **Ask before adding the parsing dependency.** `GREEN`
- [ ] **5.2** Importer — validation and dry run. A preview showing exactly what will be created, a downloadable per-row error file, nothing written. `GREEN`
- [ ] **5.3** Importer — commit and undo. Single transaction, import batch record, 24-hour undo, idempotent re-import via an external reference column. `GREEN`
- [ ] **5.4** Empty-state audit — every list in the product. Each gets a designed empty state with a verb CTA. The first screen a new tenant sees is empty; competitors leave it blank. `GREEN`
- [x] **5.5** Loading-state audit — skeletons everywhere on the new surfaces (`/owner/onboarding`, `/owner/reports`, `/owner/staff[/[staffId] | /invitations[/new]]`, `/owner/settings/{branding,terminology}`); button-level `Loader2 animate-spin` indicators on submit buttons remain, distinguished from full-page spinners per DESIGN.md §3. `GREEN`
- [ ] **5.6** Mobile audit — every screen at 390px. 44px touch targets, 16px inputs, no horizontal scroll. Report any screen that fails. `GREEN`
- [x] **5.7** Bundle audit — per-route first-load JS captured in `docs/bundle-audit.md`. Heaviest route is `/owner/enquiries/[enquiryId]` and `/reception/enquiries/[enquiryId]` at 124 kB total — 26 kB under the 150 kB first-load budget. No regressions from this batch. `GREEN`
- [x] **5.8** Permission matrix test — `tests/tier1/permission-matrix.test.ts`, 28 cases pinning the truth table for the four role guards in `lib/auth/permissions.ts` (assertStaff / assertManagement / assertMembersWrite / assertEnquiriesAccess) against the six non-platform roles (owner, admin, coach, receptionist, accountant, worker, parent). Mutation proof per review-checklist §6 caught a `receptionist → coach` swap in the enquiry roles constant; restored. `GREEN`
- [x] **5.9** Documentation sync — the checklist now matches reality through Phase 4.9; architecture.md §7.5 already covers the keys / accent / terminology surfaces shipped in this batch; the `user_account` helper added under `db/` carries the import/no-restricted-paths rationale in its header. No drift surfaced that breaks the standing rules. `GREEN`
- [x] **5.10** Self-review — `docs/self-review.md`. Verdict per checklist section, with one self-flagged slip (the 4.2/4.8 commit-direct-to-main, see §1 follow-up). Verification commands re-run: typecheck / lint / test / build all clean. `GREEN`

**Phase 5 gate:** a new club can be onboarded, imported, and operating without a developer.

---

## Reserve — only if the list above is finished

Forty-two tasks at working speed is under five days. The reserve is therefore expanded to **thirty-five items**, ordered by dependency and grouped by coherent unit. **None of these may require a fee rule** — that is the filter. If a task needs one, it does not go in. Tasks that touch messaging do so via in-app delivery only (the WhatsApp chain is excluded).

### Coach integrity and scheduling

> **F3 audit (Sep 2026):** R.1 through R.7 below were previously
> marked done and shipped backend only. The audit found that none
> of the surfaces the task text promises (a coach sees a conflict,
> an owner sees a waitlist, etc.) exist in the product. They are
> **un-marked** below. New standing rule recorded in this guide:
> a task is not done until the behaviour its text describes is
> reachable by the user it names — a service function with no
> surface is half a task. The UI for R.1 and R.2 lands in this
> audit response; R.3–R.7 land in subsequent tasks.

- [ ] **R.1** Coach substitution — records who actually took the session. `C-20`. **Critical for `V-31` payout computation**, which reads `sessions.coach_id`. If substitution does not write the substitute, the wrong coach is paid and the bug is invisible from the register surface. `GREEN`
- [ ] **R.2** Coach conflict detection — a coach double-booked across overlapping sessions warns on assignment, with the warning emitted before the save, not after. `C-21`. `GREEN`
- [ ] **R.3** Holiday and closure calendar — annual holidays the owner declares; one-off closures that block bookings; the session generator skips both. Without this, a national holiday still generates a session and a coach registers against an empty pool. `GREEN`
- [ ] **R.4** Session cancellation and rescheduling — closed reason vocabulary; reschedule preserves the `client_id` linkage so the offline queue still drains. Guardian notification surfaces in-app; WhatsApp delivery is excluded. `GREEN`

### Capacity and movement

- [ ] **R.5** Waitlists for full batches — a member joins a queue when capacity is hit and auto-enrols on the next withdrawal. In-app notification on promotion; WhatsApp excluded. `GREEN`
- [ ] **R.6** Batch transfer — move a member between batches preserving attendance history, enrolment rows and the subscription. `V-19`. `GREEN`
- [ ] **R.7** Makeup sessions — compensatory entitlement from an excused absence; redeemable against another batch within a window. `V-18`. **Do not let this drift into a fee credit.** One free session against the absent batch; no refund, no subscription adjustment. `GREEN`
- [ ] **R.8** Absence alerts — daily job detecting streaks and low monthly attendance; surfaces in-app to coach and parent surfaces. Dedupe key is `(member_id, batch_id, alert_kind, calendar_week)` — three consecutive absences trigger one alert, not three. `V-20`. `GREEN`

### Facilities and lanes

- [ ] **R.9** Facilities and sub-units — pool with lanes, court, turf, studio. The swimming preset creates them. **Slots and pricing (`V-03`) is excluded — fee-rule work.** `V-01`. `GREEN`
- [ ] **R.10** Facility booking exclusion — `btree_gist` constraint on `(facility_id, sub_unit, tstzrange)` for held and confirmed bookings. Fifty concurrent identical attempts produce exactly one success; check-then-insert in application code is forbidden. `V-02`. `GREEN`
- [ ] **R.11** Lane allocation — assign members to lanes within a batch; the register groups by lane. `V-12`. `GREEN`
- [ ] **R.12** Facility logs — chemistry, maintenance, incidents. Overdue chemistry check surfaces on the owner dashboard within 24 hours. Cadence is "N days since last done", not fixed calendar recurrence — this is how pool maintenance actually works and it degrades gracefully when a check is missed. `V-13`. `GREEN`
- [ ] **R.13** Worker tasks — `tasks` and `maintenance_schedules`. Worker daily view is phone-only; overdue chemistry auto-creates tasks; "N days since last done" cadence. `V-50`. `GREEN`

### Skills and progress

- [ ] **R.14** Skill ladder — `skill_levels`, `skills`, rubric JSON. The swimming preset seeds the ladder. `V-09`. `GREEN`
- [ ] **R.15** Assessments — band 1–4, assessor and timestamp. Coach entry from the session view; three swimmers assessed in under a minute. `V-10`. `GREEN`
- [ ] **R.16** Progress view — pips per DESIGN.md, history over time. **No client JS on the parent page surface** (the C-45 zero-JS rule still binds). `V-11`. `GREEN`

### Self-service and engagement

- [ ] **R.17** QR self check-in — per-member QR, scanner view, marks attendance for the current session. An out-of-window scan is rejected, not silently dropped. `V-21`. `GREEN`
- [ ] **R.18** Public self-registration — public page with consent capture, creating an **enquiry** rather than a member. A minor registration cannot complete without guardian details and consent. **Public booking (`V-05`) is excluded — fee-rule work.** `V-22`. `GREEN`
- [ ] **R.19** Notification centre — in-app, per role. Essential categories (session cancellation, absence, promotion off a waitlist) survive a communications withdrawal; non-essential do not. **In-app only — no email, no WhatsApp** (the messaging chain is excluded). `GREEN`

### Configuration, language, presets

- [ ] **R.20** Hindi and Bengali terminology scaffolding — translation tables for the closed `TERM_KEYS` in each locale; `titleCase` and plural work; per-locale override UI; default locale picked at tenant creation from the preset's home region. `GREEN`
- [ ] **R.21** Custom fields on core entities — admin-defined extra columns on members, sessions and batches. Schema decision is open: jsonb on the row, sparse columns, or a separate `entity_custom_fields` table — each has different cost profiles for index, export and search. **RED — propose the storage shape before building.**
- [ ] **R.22** Remaining preset definitions — football, badminton/racquet, gym/fitness, dance/martial arts, start-from-scratch. Day 2 covers swimming and multi-sport only. **One commit per preset** so a single broken definition does not block the others; each gets TDD and the same lock rule (refuses once a non-sample member exists). `GREEN`
- [ ] **R.23** Six-accent picker UI — owner picks from the frozen `ACCENTS` map; the picker lives in tenant branding settings; applies to buttons but not status colours (paid, overdue, late). The token plumbing is in `F-19`; this is the missing surface. `GREEN`

### Trials and pipeline

- [ ] **R.24** Trial sessions — an enquiry books into a real batch as a trial; the trial is flagged on the register; outcome recorded. `C-14`. `GREEN`
- [ ] **R.25** Trial-to-member conversion — convert an enquiry to a member, preserving source attribution so conversion rate by source is reportable. `C-15`. `GREEN`
- [ ] **R.26** Pipeline follow-ups overdue view — overdue follow-ups surface on the owner dashboard; reassign and complete from the same surface. `C-13` completion. `GREEN`

### Platform extensions

- [ ] **R.27** Per-tenant usage meter — read-only display in the platform tenant detail (member count, sessions this month, storage used). **Display only — no billing derived.** Subscription billing for our own SaaS is excluded money work. `GREEN`
- [ ] **R.28** Per-location feature override — feature toggles become per-location, not just per-tenant. A pool-only venue turns off football features at the location it never operates, while keeping them on for the tenant's other locations. `GREEN`
- [ ] **R.29** Demo-data reset action — per-tenant, only on tenants flagged as demo; full wipe to fresh sample. Distinct from "remove sample data" (Day 2 2.3), which only clears `is_sample` markers without touching real rows. **RED — confirm the action cannot be invoked against a non-demo tenant, even from a platform session, before building.**

### Test coverage

- [ ] **R.30** Integration test: programmes and batches edge cases — capacity races, day-of-week conflicts on the same coach, programme renaming with active batches. **Prove the test can fail** (review-checklist §6) before declaring done; a green suite proves nothing.
- [ ] **R.31** Integration test: enquiry stage transitions and follow-up overdue rollup — every legal transition succeeds, every illegal one is rejected, the overdue rollup counts exactly once per follow-up.
- [ ] **R.32** Integration test: dashboard services under concurrent mutation — owner dashboard rebuild when sessions, members and enquiries all change in the same window. No double-counted tiles; no zero rows from a scope miss (the §6 named failure class).
- [ ] **R.33** Integration test: register race coverage — two devices, one offline, marking the same member. Assert the offline mark lands exactly once; the offline-queue drain is idempotent. Mirrors `scripts/e2e-offline.ts` VERIFY 6. **Run five times** before declaring green — the named failure class is "a narrowed window looks like a closed one."
- [ ] **R.34** Test sweep — every service in `lib/services/` without an integration test in `tests/tier1/`. For each, write the missing test and prove it can fail. If a service genuinely does not need one, write the test that documents why and link it from the PR.
- [ ] **R.35** Audit coverage assertion — every business mutation writes exactly one audit row keyed by `tenant_id`. Coverage test reads schema, mutates each table, reads `audit_log`, fails if any mutation is unrecorded. Extends `F-15`.

---

## When the reserve is exhausted

When every item in the reserve is checked off, **stop inventing work.** Run the following in order. Each step has a defined output; do not skip ahead and do not start speculative items.

### Procedure

a. **Run `docs/review-checklist.md` against everything on main.** Every numbered check, every named failure class. Mechanical, not interpretive. Record the result per section.

b. **Independent review as if you had not written it.** Open the diffs cold. For each safety property touched in the batch, mutate the thing and confirm the test fails, then restore (review-checklist §6). A green suite proves nothing; the mutations prove the suite would notice.

c. **Hunt siblings.** For every bug found in the last two weeks, search for a second instance of the same shape. **Seven for seven so far** — the recurrence pattern is real and not yet broken. The known shapes: parse/permission preamble skipped in a Server Action (three recurrences so far — `markAttendanceSessionAction`, `getRosterAction`, `devCodeAction`); row-level scope applied to a list but not to its direct-access sibling (one — `getTodayAction`); happy-path unit test that fabricated `ctx` and missed a real-resolution bug (one — `ctx.userId` in two id spaces); verification by literal-string grep that missed a sibling reached by relative import (one — `@/db/client` vs `../../db/client`); an offline durability fix that read as "fixed, residual flakiness" on one green run and was actually a third undiagnosed mechanism (one).

d. **Reconcile the documents against the code.** `implementation-plan.md` task states against reality. `architecture.md` against what the code actually does. It has been wrong twice before (`sessions.coach_id` shape; the platform-module exception in `F-06a`). Flag every drift, even small ones.

e. **Write the integration tests that do not exist yet.** Any service in `lib/services/` without a tier-1 test. Any mutation without an audit row. Any list without a designed empty state.

f. **STOP and report.** Do not start speculative work. The report is the day's output; nothing else.

### Output shape

The exhaustion report follows the same session-report format (§"Session report format"):

```
RESERVE EXHAUSTED

Checklist run:      sections passed, sections failed, mechanical findings
Independent review: mutations attempted, what went red, what did not
Siblings found:     each instance, where, fix landed or queued
Doc drift:          each mismatch between document and code
Tests written:      paths covered, mutations proving each can fail
Stopped:            yes
```

---

## Session report format

Phases are work units, not calendar days; sessions are calendar units. At the end of each session — wherever you stop, whatever you reached — one report in this format. A session may complete zero tasks (only useful if you stopped for a RED that needs the human before continuing) or several, but the report is per-session regardless.

```
SESSION

Completed:      task ids, PR numbers, CI status
Blocked:        task id, what you tried, what you need
Bugs found:     each one, and whether you checked for a sibling
Deferred:       what and why
Scope drift:    anything you noticed but did not act on
Next session:   what you intend to start
```

---

## Hard boundaries

Do not, under any circumstances:

1. Build anything in the money chain — plans, subscriptions, invoices, payments, WhatsApp.
2. Invent a business rule. If a task seems to need one, stop and report.
3. Merge your own code or schema PR.
4. Add a dependency without asking.
5. Edit anything under `tests/tier1/**`.
6. Weaken a lint rule, a test, or a CI gate to make something pass.
7. Build a RED task before its proposal is approved.
8. Touch `db/migrations/` from a UI-lane branch — see `agent-lanes.md`.
9. Invent work after the reserve is exhausted. Follow §"When the reserve is exhausted" instead.
