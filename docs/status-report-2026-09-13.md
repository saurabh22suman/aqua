# Aqua — status report, 2026-09-13

**Purpose.** A standalone snapshot of where the Aqua codebase actually stands against its own planning documents, for handoff to an AI reviewer with no access to prior session context. Every claim below is grounded in direct inspection of the repository at commit `06f9e62` on branch `fix/indian-user-ux-audit-2026-09-13`, which is equivalent to `origin/main`'s current tip (merged via PR #144). All file paths are absolute from the repo root `/home/soloengine/thedutchrabbit/aqua`.

**Companion documents this report is checked against** (all in `docs/` unless noted): `project-scope.md` (product scope, phases, pricing), `architecture.md` (technical design), `implementation-plan.md` (the numbered task list — IDs `D-`, `S-`, `B-`, `F-`, `C-`, `V-`, plus the ad-hoc "role-surfaces Wave" and lettered fix batches like `R.1`–`R.8`, `F-1`–`F-7` used in recent commits), `DESIGN.md` (visual rules), and the root `CLAUDE.md` (working rules and previously-documented gaps).

---

## 1. Executive summary

Aqua has a genuinely solid, mechanically-enforced multi-tenant foundation — tenant isolation via RLS, a scoped-accessor pattern, role-based route groups, a working attendance/offline pipeline, and a real platform admin console — but it is **substantially short of Phase 2's own exit criteria**, let alone Phase 3. The entire money layer (invoices, payments, subscriptions, Razorpay, webhooks, dunning) and the entire Phase-3 vertical (facilities/bookings, swimming skill assessments, staff attendance/shifts/pay, batch profitability reporting) do not exist yet — not partially built, not stubbed, simply absent from both the schema and the code. What has been built instead, especially in the most recent commits (2026-09-11 through 2026-09-13), is a wide layer of operational polish on top of the people/scheduling/attendance core that Phase 2 does cover: enquiries, waitlists, batch transfer, makeup credits, absence alerts, holiday calendars, staff invitations, branding/terminology, and — most recently — two full UX audit passes (mobile/Indian-user-formatting and general UI/UX) that fixed a P0 login bug (bare 10-digit Indian phone numbers were being rejected). The project is best described as having a very mature Phase 1 (isolation, auth, RBAC, entitlements, branding) and roughly two-thirds of Phase 2's *people and scheduling* half, with Phase 2's *money* half and all of Phase 3 not started.

---

## 2. Phase-by-phase completion status

### Phase 0 — Discovery
Not evidenced in the repo (expected — this phase produces documents outside the codebase, and no `D-01`…`D-08` artifacts appear in `docs/`). Cannot confirm status from code alone.

### Milestone S — Setup, and Backend-first pilot (B1–B8)
**Complete.** Per `implementation-plan.md`'s own status annotations, all of B1–B8 are marked complete with commit hashes (`8bb6f99`, `33e7726`, `26a79fd`, `9985c23`, etc.). Confirmed independently:
- CI pipeline exists at `.github/workflows/ci.yml`, running typecheck, lint, `check:migrations`, `check:runbook-sync`, `check:scripts-exist`, a lane-overlap check, `test`, `check-bundle-budget.ts`, `check-font-budget.ts`, and six Playwright-driven e2e scripts (`e2e-offline`, `e2e-offline-disabled`, `e2e:parent-link-zero-js`, `e2e:platform-form-leak`, `e2e:host-boundary`, `e2e:role-bypass`).
- `db/tenant.ts` (`withTenant`, `withUser`), `db/scope.ts` (`enterScope`, mutual-exclusion guard), and the ESLint `import/no-restricted-paths` rule all exist as designed.
- `tests/tier1/isolation.test.ts` (161 lines) exists and matches the documented isolation-gate test shape.

### Phase 1 — Platform foundation (F-01 … F-26)
**Largely complete, with real gaps.**
- **Done:** F-01 (platform schema — `plans`, `features`, `plan_features`, `presets`, `permissions` all present in `db/schema/platform.ts`), F-02/F-03/F-03a (tenants, locations, users, memberships, `role_id` cutover), F-05–F-08a (the isolation gate — see §5 below, this is the most rigorously proven part of the system), F-09/F-10 (auth — though not as originally scoped: phone+PIN replaced phone+OTP as the primary door, OTP is wired but dormant with no SMS channel), F-11/F-12 (request context, permission enforcement), F-13 (feature entitlements), F-14 (audit log table — **but see F-15 below**), F-16 (soft delete convention used throughout), F-17/F-18/F-19 (branding, terminology, accent token — all shipped and exercised), F-20/F-21 (preset engine — `db/preset-engine.ts`, `db/preset-definitions.ts`; **all seven v1 presets registered**, per commit `l1c04722`/L1-L2 fix batch, not just swimming and multi-sport as F-21 originally scoped), F-22/F-23 (app shell, role layouts, settings hub), F-24 (staff invitations — `lib/services/staff-invitations.ts`), F-25 (provisioning — now a full `/ops` platform console, exceeding the original "provisioning CLI" scope).
- **Gap: F-15 (audit coverage).** No coverage-assertion test exists anywhere in `tests/tier1/` (confirmed by grep — zero matches combining "coverage" and "audit" across all Tier-1 test files). Six call sites carry `TODO(tenant-audit-log)` markers with no audit row written: `lib/services/staff-invitations.ts` (three sites, lines 281, 483, 528), `lib/services/branding.ts:186`, `lib/services/coach-substitution.ts:157`, `lib/services/terminology.ts:166`. A seventh, related gap uses a different marker: `db/membership-activation.ts`'s `activateInvitedMemberships` carries a `TODO(F-14)` (not `TODO(tenant-audit-log)`) because the actor here is a tenant member accepting their own invite, not a platform user, and `platform_audit_log.actorId` FKs to `platform_users.id` — writing there would violate the FK, so it's unaudited by a schema constraint, not an oversight.
- **Gap: F-08's known production-path caveat.** The dev/test Application-Level-Storage scope guard in `db/client.ts` (throws P0001 on an unscoped query) is disabled in `NODE_ENV=production` by design — RLS is meant to be the layer holding in production. This has never been exercised under an actual production build (architecture.md §5.7 and §9.1 note this explicitly).
- Phase 1 gate (F-26) criteria — two tenants coexisting, isolation green, feature toggle changing UI, a fresh clone provisioning a tenant in under ten minutes — appear substantively met based on the platform console's functionality, though no single automated "gate" test asserts all of these together.

### Phase 2 — Operating core (C-01 … C-48)
**People/enquiries/scheduling/attendance: mostly done. Money: entirely absent.** This is the single most important finding in this report.

Done or substantially done:
- People (C-01–C-08): `persons`, `guardianships`, `members`, `staff`, consent (`db/schema/consent.ts` — `guardianships`, `policy_versions`, `consents`) all exist with real UI (`app/(owner)/members/**`, `app/(reception)/members/**`).
- Enquiries (C-12–C-15): `db/schema/enquiries.ts` (`enquiries`, `enquiry_follow_ups`), full pipeline UI at `/owner/enquiries` and `/reception/enquiries`, trial booking, conversion, and a funnel report.
- Programs/scheduling (C-16–C-21): programs, batches, enrolments, session generation (`lib/jobs/session-generator.ts`, `DAYS_AHEAD = 28`), cancellation/reschedule (`lib/actions/session-lifecycle.ts`), coach substitution (`lib/services/coach-substitution.ts`), coach conflict detection (`lib/actions/coach-conflicts.ts`).
- Attendance (C-22–C-27): schema with `client_id` idempotency, coach register UI (`app/(coach)/coach/register/[sessionId]/`), offline queue with a **per-tenant kill switch** (`tenants.offline_sync_enabled`, migration `0013`, default `false`) documented in exhaustive, unusually honest detail in architecture.md §12, attendance history/summary reports.
- Owner dashboard (C-46) exists (`lib/actions/dashboard.ts`, `app/(owner)/page.tsx`).
- Extra items beyond the original C-series scope, delivered under a "R.x" fix-batch label in recent commits (PR #140, "close the backend-only gap"): holidays (R.3), session lifecycle polish (R.4), waitlist (R.5), batch transfer (R.6), makeup credits (R.7), absence alerts (R.8) — all with schema, service, and action layers; waitlist and holidays also have owner-facing UI.

**Not started at all — confirmed absent from both `db/schema/` and `lib/actions/`+`lib/services/` by exhaustive grep:**
- C-28–C-39 (Money): no `invoices`, `payments`, `subscriptions`, `membership_plans`, or `webhook_events` tables anywhere in `db/schema/` or `db/migrations/*.sql`. `lib/money/` contains only `arithmetic.ts` and `format.ts` — the paise-handling primitives (C-28) — with nothing built on top. No Razorpay adapter, no invoice numbering, no cash/UPI payment recording, no webhook endpoint.
- C-40–C-45 (Messaging) is partially done: `parent-link.ts` (magic links, C-44) and the `/p/[token]` zero-JS page (C-45) are shipped and audited on issuance. But there is no `MessageProvider`/BSP adapter, no template registry, no `message_log` table, no metering, no WhatsApp sending of any kind — the parent link itself is currently issued and presumably shared manually/out-of-band, not sent automatically.
- C-09–C-11 (Excel/CSV importer): no importer code found under `lib/actions/` or `lib/services/`, and no upload/mapping UI found in the app route sweep.
- C-33/C-34 (cash payments, daily reconciliation): absent — depends on the missing invoices/payments schema.
- Café / member-account charging (§5.12 of project-scope.md, in-scope for Phase 2 per that document): absent.

**Phase 2 gate (C-48)** — "the reference business completes one full month... without the register" — **cannot be met today**: without invoicing and payment recording, an academy cannot collect fees through the product at all. This is the most consequential single gap in the whole codebase relative to what "Phase 2 done" is defined to mean.

### Phase 3 — Vertical, staff pay, go-live (V-01 … V-48)
**Not started**, with two narrow exceptions already noted under "extra Phase-2 work" above (waitlist V-adjacent items, and the DPDP items below are partially addressed under Phase 1/2 consent work, not full V-45/V-45a/V-46/V-47 implementations).
- V-01–V-08 (Facilities/bookings): a `facilities` table exists but it is **not** the V-01 design — it's a flat preset-seed shape (`id, tenant_id, name, kind, capacity, is_sample`, from migration `20260902230000_preset_engine_schema.sql`) with no `sub_units` jsonb as real lane/court entities, and critically **no `bookings` table and no `btree_gist` exclusion constraint** (the race-proof double-booking prevention architecture.md §8.7 specifies). The only facility-adjacent feature that exists is `lib/actions/facility-optins.ts` — a member-level "which facility do you use" opt-in flag, unrelated to booking.
- V-09–V-13 (Swimming vertical: skill ladder, assessments, progress, lane allocation, facility logs): entirely absent.
- V-14–V-17 (Dunning, UPI mandates, refunds): entirely absent — depends on the missing money layer.
- V-18–V-22 (Makeup, transfer, absence alerts, QR check-in, self-registration): makeup/transfer/absence-alerts are done (see Phase 2 "extra" items above, delivered ahead of schedule under R.6–R.8); QR check-in and public self-registration are not built.
- V-23–V-34 (Staff attendance, shifts, leave, pay, payslips, payroll export): entirely absent — no `shifts`, `staff_attendance`, `leave_types`, `leave_requests`, `pay_rules`, `advances`, `payout_runs`, `payout_lines`, or `payouts` tables anywhere.
- V-35–V-39 (Reporting): only the non-money reports exist (`lib/actions/owner-reports.ts` — attendance report, enquiry funnel, retention, coach load, CSV export). Revenue reports, batch profitability, and monthly P&L (the product's stated lead differentiator per project-scope.md §1/§2.2) are unbuilt because they require both the money layer and the staff-pay layer as inputs.
- V-40–V-48 (Go-live: backup drill, load test, security review, DPDP consent-withdrawal/export/erasure, breach runbook): not evidenced. Consent *capture* (C-05) exists; consent *withdrawal* (V-45), *export* (V-46), and *erasure* (V-47) do not appear to have dedicated implementations in the routes/actions swept.

### Phases 4–6
Not decomposed in the plan document itself yet (this is expected — the plan explicitly leaves them at epic level, "decompose only after Phase 3 ships"). No relevant code found, as expected.

---

## 3. Salient features by role/page

Route groups exist as designed (architecture.md §13.2): `(auth)`, `(owner)/owner`, `(coach)/coach`, `(reception)/reception`, `(parent)/parent` (legacy stub), `(platform)/ops`, plus `p/[token]` as a standalone route handler and `api/auth/[...all]`, `api/health`. No `(tenant)/[slug]/` segment exists — tenant resolution is session-based, not URL-based, which is a deliberate, documented deviation from an earlier version of the architecture doc (§13.2 explicitly flags this as a prior false claim, corrected).

### Auth (`app/(auth)/`)
- `/login` — phone + PIN sign-in (`LoginForm`).
- `/set-pin` — first-login PIN-setting screen, reached via magic link.
- `/login/link/[token]` — magic-link redemption (`LoginLinkRedeemForm`).

### Owner surface (`app/(owner)/owner/`) — roles `owner`, `admin`, `accountant` all land here; there is no separate accountant UI
Bottom nav (exactly 4 items, DESIGN.md-compliant): **Home, Members, Reports, Settings.**
- `/owner` — dashboard: branding/terminology-aware, built via `getOwnerDashboardAction`.
- `/owner/members`, `/new`, `/[memberId]`, `/[memberId]/edit` — the richest page in the app is the member detail view (`app/(owner)/owner/members/[memberId]/page.tsx`, 298 lines): status-transition panel, enrolment panel, **facility opt-ins panel**, **makeup-credits panel**, **parent-link issuance panel**, member ID card, attendance history, inline-editable fields.
- `/owner/enquiries`, `/[enquiryId]` — pipeline board and detail (stage transitions, follow-ups, conversion to member).
- `/owner/programs` — programs/batches board with coach and location pickers.
- `/owner/batches/[batchId]` — monthly attendance summary **plus an inline waitlist board** (R.5).
- `/owner/sessions` — upcoming sessions across all coaches/batches, with a coach-reassignment control.
- `/owner/reports` — attendance report, enquiry funnel, retention, coach load (4 cards); `/owner/reports/attendance.csv` is a route-handler CSV export.
- `/owner/staff`, `/new`, `/[staffId]`, `/staff/invitations`, `/staff/invitations/new` — staff CRUD and invite flow.
- `/owner/settings` (hub, 156 lines), `/settings/branding`, `/settings/terminology`, `/settings/holidays`, `/settings/alerts` — branding upload, multi-locale terminology editor, holiday calendar, absence-alert threshold configuration.
- `/owner/onboarding` — onboarding checklist.
- **Absent:** no invoices, payments, subscriptions, dunning, or Razorpay page anywhere under `/owner` — consistent with the schema-level gap in §2 above.

### Coach surface (`app/(coach)/coach/`)
Bottom nav: **Today, Schedule, Members, Me.**
- `/coach` — today's sessions as lane-strip capacity cards with a live marked/total progress bar (colour state: water → warn → good), an "up next" card when nothing is scheduled today, and a genuine (non-lorem) empty state. Fully built.
- `/coach/register/[sessionId]` — the attendance register (`RegisterBoard`), offline-sync-flag aware.
- `/coach/schedule` — week view.
- `/coach/members`, `/[memberId]` — roster search, member detail showing absence alerts and medical/contact notes.
- `/coach/me` — identity and sign-out only; no profile editing.

### Reception surface (`app/(reception)/reception/`)
Bottom nav: **Today, Add member, Enquiries, Me.**
- `/reception` — read-only mirror of the coach Today view (no attendance-marking control — copy explicitly states "Coach will mark attendance").
- `/reception/enquiries`, `/[enquiryId]` — same components as the owner surface.
- `/reception/members/new`, `/[memberId]` — member creation and a narrower detail view (no status/edit/facility/makeup panels — those are owner-only).
- `/reception/me` — identity and sign-out.

### Parent surface — two distinct things, by design
1. `app/(parent)/parent/page.tsx` — a deliberate stub. No real tenant role maps to it (`canAccessSurface` maps only `worker` here, and worker has no built UI yet per project-scope.md §5.11). Renders an explainer: "Parents get their link from the club," with a staff-login fallback. This matches project-scope.md §3.3's explicit design decision that parents get no account.
2. `/p/[token]` (`app/p/[token]/route.ts`, 393 lines) — the real parent surface. A **Route Handler**, not a page — hand-built HTML, confirmed zero client JavaScript, `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`. Content: tenant-branded header (initials-mark fallback, resolved accent colour), child's name and member code, next session (date/time/batch/coach), this month's attendance percentage with a coloured recent-session list, and an absence-alert line when applicable. **No fees/billing card, no progress/assessment card** — both are correctly documented in `DESIGN.md` as blocked on the still-missing money layer (C-32) and swimming-vertical assessments (V-10/V-11), not an oversight.

### Platform / ops console (`app/(platform)/ops/`) — separate auth entirely (password+TOTP or env-credential door), not tenant `Ctx`
Desktop-first per DESIGN.md's original rule, with a supported mobile console added under the 2026-09 amendment: 4-item mobile bottom nav — **Overview, Tenants, Feature catalogue, Presets** — confirmed present in both the desktop sidebar and the mobile header/nav.
- `/ops/login`, `/ops/verify` — 2FA-gated platform login.
- `/ops` — landing hub.
- `/ops/tenants`, `/new`, `/[tenantId]` (392 lines) — full tenant lifecycle: create, list (sorted live-first then by creation date, per commit `242450b`/H2), per-tenant detail with status transitions (trial/active/suspended/churned, audited), an **owner-invite flow** (mints a login link — no auto-delivery channel wired yet), locations list, per-tenant **feature toggle panel**, a "remove sample data" action gated on `is_sample` rows still existing, and a recent-activity/audit feed (last 20 events).
- `/ops/features` — feature catalogue.
- `/ops/presets`, `/[key]` — preset catalogue, per-preset preview, and list of tenants currently on that preset.
- `/ops/activity` — cross-tenant append-only audit trail with filters.
- This is a genuinely functional admin console — provisioning, entitlement overrides, preset preview/apply, and audit visibility are all real. **No support-impersonation UI was found** in this route sweep, though project-scope.md §3.1 lists impersonation as an in-scope platform-role capability; worth a follow-up check specifically in `lib/actions/platform-*` for an impersonation action that simply lacks a page.

### Cross-cutting UI system
`components/ui/StatusBadge.tsx` and `components/ui/Button.tsx` were both extracted during the 2026-09-13 UI/UX audit (see §6 below) — before that, status colouring and button styling were duplicated ad hoc across pages. `MEMBER_STATUS_TONE`, `ENQUIRY_STAGE_TONE`, `TENANT_STATUS_TONE` are the shipped lifecycle-to-colour maps.

---

## 4. Gaps vs. plan

Ordered roughly by materiality:

1. **The entire money layer (C-28–C-39) is unbuilt** — no invoices, payments, subscriptions, membership plans, Razorpay integration, or webhook handling exist anywhere in the schema or code. This blocks Phase 2's own gate criterion and blocks essentially all of Phase 3's collections and reporting work (dunning, UPI mandates, batch profitability, P&L).
2. **Phase 3's entire vertical and staff-pay module is unbuilt**: facilities/bookings (the real V-01 design, with lanes and the `btree_gist` overlap constraint), swimming skill ladder/assessments, staff attendance/shifts/leave, pay rules/advances/payout computation/payslips. The `facilities` table that exists is a preset-seed placeholder, not the booking-capable design in architecture.md §8.7.
3. **Messaging (C-40–C-43a) has no send path.** Magic links (C-44) and the parent page (C-45) work, but there is no `MessageProvider`/BSP adapter, no template registry, no metering, and no actual WhatsApp delivery mechanism — parent links appear to be shared out-of-band today, not automatically messaged.
4. **No Excel/CSV importer (C-09–C-11)** — no upload/mapping/dry-run/undo code found anywhere.
5. **Audit log coverage (F-15) has no mechanical test**, and six known call sites (`TODO(tenant-audit-log)`) skip audit writes entirely: `lib/services/staff-invitations.ts` (×3, lines 281/483/528), `lib/services/branding.ts:186`, `lib/services/coach-substitution.ts:157`, `lib/services/terminology.ts:166`. A seventh related gap, `db/membership-activation.ts`'s `activateInvitedMemberships`, is blocked on a real schema constraint (the actor is a tenant member, not a platform user, and `platform_audit_log.actorId` FKs to `platform_users.id`) rather than an oversight — it needs a design decision, not just an implementation.
6. **DPDP go-live items (V-45–V-48) are not evidenced**: consent *capture* exists (C-05), but per-purpose consent *withdrawal*, data *export*, *erasure*, and the breach-notification runbook do not appear to have shipped implementations. Two of these (`V-45a`, `V-47`) are explicitly flagged in the plan itself as blocked on outside legal counsel, not on engineering — that blocker is unchanged.
7. **`scripts/check-line-count.ts` is not wired into CI at all**, not even in report-only mode. Its own header comment states this as a correction to a previously false claim of being "wired into CI." 23 files currently exceed 300 lines; the worst are `db/preset-engine.ts` (713), `lib/services/staff-invitations.ts` (536), `lib/services/register.ts` (439), `db/preset-definitions.ts` (438), `lib/services/enquiries.ts` (424), `lib/services/people.ts` (407).
8. **Self-merge suspension (F1)** remains in force by design, not a residual bug: `.github/workflows/agent-protected-paths.yml` and `tests/tier1/agent-protected-paths.test.ts` are verified end-to-end (per `docs/five-day-work-guide.md`, against real throwaway PRs #70/#71), but the agent's GitHub token can still self-apply the `human-approved-merge` label — the gate is an audit trail, not a hard lock. The actual enforcement is the standing discipline rule (apply the label, do not merge, wait for a human), not a mechanical impossibility.
9. **`required_approving_review_count: 0`** on the `main protection` ruleset is an accepted, documented gap (solo-repo reality), not an oversight — CLAUDE.md and `docs/branch-protection.md` both treat green CI plus the self-merge discipline as the compensating control.
10. **No support-impersonation UI or action** was found in the `/ops` route sweep, despite project-scope.md §3.1 listing "scoped tenant impersonation" as an in-scope platform-role capability, and `docs/red-proposals.md` lists "Support impersonation (3.8)" as a still-pending RED item blocking further Phase 3 work.
11. **Documents/uploads (C-07)** — ID/photo/medical-certificate upload via R2 — was not confirmed present in the routes or actions sweep; `docs/red-proposals.md` lists the "Documents token scheme (3.1)" as a still-pending RED item.
12. **Testing-strategy doc drift**: `docs/testing-strategy.md` names 15 Tier-1 test files by a filename convention (e.g. `isolation-hostile.test.ts`) that doesn't match the actual files on disk (e.g. `isolation.test.ts`). Minor, but worth a doc-sync pass.
13. **`docs/demo-runbook.md` does not document the direct-commit-to-main incident** CLAUDE.md references (a boot-guard-adjacent change that shipped without a PR) — the incident is referenced in CLAUDE.md but not narrated in the runbook itself, so its details aren't independently verifiable from the docs alone.

---

## 5. Mechanically enforced vs. review-only rules

| Rule | Enforcement | Verified |
|---|---|---|
| Tenant data only via `withTenant()`/`withUser()`/`withPlatform()` | **Mechanical** — ESLint `import/no-restricted-paths` (resolves module identity, not import text) + `tests/tier1/isolation.test.ts` (161 lines) + `tests/tier1/user-scope.test.ts` (184 lines) + `tests/tier1/no-superuser-on-request-path.test.ts` (224 lines) | All three test files exist and match their documented purpose |
| RLS on every tenant-scoped table | **Mechanical** — F-08a catch-all queries `pg_class` for any public table with RLS off, against an explicit allowlist (`db/allowlist.ts`) | Spot-checked: 16 migrations enable RLS, 16 force it (matched counts, no gaps); the most recent (`absence_alerts`) follows the exact documented pattern |
| Money as `bigint` paise | **Partially mechanical** — Drizzle column types are `bigint`; one documented, guarded exception (`formatINR` converts to `Number` once, display-only, guarded by a "no paise-to-Number outside formatINR" test); broader review still load-bearing | `lib/money/arithmetic.ts`, `lib/money/format.ts` confirmed to be the only money-primitive files; nothing built on top yet since no invoices/payments exist |
| Timestamps `timestamptz`, UTC storage, IST display | **Schema-level mechanical** (column types); display formatting is per-callsite convention, not lint-enforced | Not independently re-verified per callsite in this pass |
| Every mutation writes `audit_log` in the same transaction | **Not mechanically enforced** — no coverage test exists (confirmed absent by grep) | Six `TODO(tenant-audit-log)` sites confirmed live (see §4.5) |
| TypeScript strict, no `any`, Zod at every boundary | **Mechanical** — `tsconfig` strict + CI `pnpm typecheck` | `ci.yml` runs `typecheck` as an early step |
| Server Action preamble (Zod parse → permission check → service call) | **Mechanical** — `tests/tier1/server-action-preamble.test.ts` (522 lines, the largest Tier-1 test file), real AST walk | Spot-checked against `lib/actions/waitlist.ts`: confirmed `safeParse` → `requireDefaultCtx()` → `requirePermission()` → service call, in that order, with an explicit "parse-then-permission preamble" comment |
| Files under 300 lines | **Not enforced** — `scripts/check-line-count.ts` has `STRICT = false` and, contrary to an earlier claim, **is not wired into CI at all**, not even in report-only mode (its own header comment states this correction) | 23 files currently over 300 lines; worst is `db/preset-engine.ts` at 713 |
| Test files exempt from the 300-line rule | Documented policy; consistent with the line-count script not running against `tests/` at all in strict mode | N/A — moot while `check:lines` isn't wired into CI |
| Icons: individual `lucide-react` imports, never the barrel | **Indirectly mechanical** — caught only via the bundle-budget check (`scripts/check-bundle-budget.ts`) failing if a barrel import pushes a route over 150 KB gzipped | `ci.yml` runs `check-bundle-budget.ts`; a barrel import that stays under budget would slip through undetected |
| No new dependency without asking | **Not enforced** — review-time only | — |
| Never edit an applied migration | **Partially mechanical** — `scripts/check-migration-naming.ts` (run via `pnpm check:migrations` in CI) catches duplicate/naming issues and enforces the two-era naming convention (legacy `NNNN_name.sql` for `0001`–`0019`, timestamped `YYYYMMDDHHmmss_name.sql` from `0020` onward for collision-free parallel-agent work); "edited an already-applied migration" itself is caught only by review | 42 migration files total; naming convention confirmed consistent |
| Self-merge suspension (F1) | **Mechanical audit trail, not a hard lock** — `.github/workflows/agent-protected-paths.yml` requires the `human-approved-merge` label on any PR touching `db/migrations/**`, `lib/auth/**`, `lib/money/**`, or consent paths; verified end-to-end against real PRs (#70/#71 per `docs/five-day-work-guide.md`) | The agent's token can still self-apply the label — actual enforcement is the standing discipline rule, not a technical impossibility, as the workflow's own header states |
| `DEMO_MODE` gating | **Mechanical** — `tests/tier1/demo-mode-reads.test.ts` (126 lines, source-scan whitelisting only the parser/banner/reset-script call sites) + `tests/tier1/demo-mode-env.test.ts` (71 lines, boot-fails when `DEMO_MODE=true` and `NODE_ENV=production`) | Both files confirmed present and matching their documented purpose |
| Branch protection on `main` | **Mechanical, with one accepted gap** — ruleset `main protection` blocks deletion/force-push, requires PR + `ci` + `agent-protected-paths` status checks, `bypass_actors: []` | `required_approving_review_count: 0` remains an accepted, documented limit (solo-repo), not a bug |

---

## 6. Technical debt / risk notes

- **23 files over the 300-line soft limit**, with the check not running in CI at all. Worst offenders: `db/preset-engine.ts` (713), `lib/services/staff-invitations.ts` (536), `lib/services/register.ts` (439), `db/preset-definitions.ts` (438), `lib/services/enquiries.ts` (424), `lib/services/people.ts` (407), `app/p/[token]/route.ts` (392), `app/(platform)/ops/tenants/[tenantId]/page.tsx` (391), `components/member-create-form.tsx` (385), `db/platform-tenants.ts` (365), plus `db/platform-auth.ts` (364), `db/seed-platform.ts` (362), `components/programs-batches-board.tsx` (357), `components/member-detail/inline-edit-field.tsx` (334), and nine more not itemised here.
- **Audit log coverage gap** (six `TODO(tenant-audit-log)` sites, one `TODO(F-14)` site) is a known, tracked debt item, not a surprise — but it has zero mechanical test coverage, so regressions or new unaudited mutation sites would go unnoticed.
- **Offline attendance has a well-documented, narrow, accepted risk window**: architecture.md §12.1 states a coach can lose *at most one* attendance mark, only the most-recent tap, only if the app process is killed inside a single-digit-millisecond window between an IndexedDB write being accepted and its transaction committing — verified empirically via `scripts/e2e-offline.ts` (16 rapid taps + immediate reload consistently yields 15/16, never fewer). This is disclosed as a stated limit, not hidden, and gated by a per-tenant kill switch (`tenants.offline_sync_enabled`, default `false`) with an explicit evidence checklist before any tenant's flag is flipped on (sustained clean CI, a real Android device over real mobile data, the reference tenant as first canary, and disclosure of the residual risk to that tenant beforehand).
- **Production-path superuser risk is undemonstrated, not unmitigated.** The ALS scope guard that throws on an unscoped query in dev/test is deliberately disabled in production (RLS is meant to hold there instead), meaning the `withPlatform()` wraps around every better-auth call site have never been exercised as a hard failure under an actual production build. Architecture.md §5.7 and CLAUDE.md both flag this as a known, unclosed verification gap rather than a live incident.
- **Parent magic links have no revocation mechanism.** Architecture.md §11.3 explicitly corrects two prior false claims in its own text: the signing secret is not "rotating" (a single long-lived env var, same shape as `BETTER_AUTH_SECRET`), and there is no denylist table — the only way to revoke a link today is to rotate the secret, which invalidates every other active parent link simultaneously.
- **Two doc-drift items found**: `docs/testing-strategy.md` names Tier-1 test files (e.g. `isolation-hostile.test.ts`) that don't match the actual filenames on disk (e.g. `isolation.test.ts`); `docs/demo-runbook.md` does not narrate the direct-commit-to-main incident that CLAUDE.md references.
- **Two RED-flagged (highest caution level) decisions remain pending**, per `docs/red-proposals.md`: the Documents token scheme (§3.1, blocks C-07/document upload) and Support impersonation (§3.8, blocks scope §3.1's impersonation requirement) — both are blocking further Phase 3 work, and neither has an implementation yet.
- **Role-surfaces plan Wave 3 (money/messaging) has not started**, per `docs/role-surfaces-plan.md` — explicitly gated on pricing-model and billing-cycle decisions that project-scope.md §2.5 itself defers ("three options, to be decided before Phase 3").
- **Most recent work (2026-09-11 through 2026-09-13) is UX-hardening, not new-feature work**: phone+PIN auth replacing OTP as primary (`1adacdf`), a mobile-UX audit sweep across five phases (`194daf5`, `6a8386c`, `18979ec`), role-surfaces Waves 1–2 (`d8acd9b`, `a6199db`), a backend-only-gap closure for waitlist/transfer/makeup/absence alerts (`ed80887`), and finally the two most recent commits — a general UI/UX audit (`904f1d8`, fixing missing shared `StatusBadge`/`Button` components, inconsistent status colouring, and a native-date-input locale bug) and an Indian-user-specific audit (`06f9e62`) that fixed a **P0 login bug**: bare 10-digit Indian phone numbers (the natural way an Indian user types their own number) were being rejected by the login form, which only accepted `+91`-prefixed input. Both audits' fixes (F-1 through F-7 in the latter) were verified via `pnpm typecheck/lint/test/build` plus live browser verification per their respective audit documents (`docs/audits/2026-09-13-ui-ux-audit.md`, `docs/audits/2026-09-13-indian-user-ux-audit.md`). One residual item from the Indian-user audit remains open: a schema decision on an `is_test`/`source` flag for tenants (F-6, partially fixed).

---

## 7. Recommended next steps

Prioritised by what actually blocks the project's own stated exit criteria, not by ease of implementation:

1. **Build the money layer (C-28–C-39)** — this is the single largest gap and the literal precondition for Phase 2's exit gate ("the reference business records one complete month... without falling back to the register"). Without invoicing and payment recording, nothing else in Phase 3 (dunning, mandates, batch profitability, P&L — the product's stated lead differentiator) can start. Sequence per the plan's own dependency order: C-28 (money primitives — already done) → C-29 (membership plans) → C-30 (subscriptions) → C-31 (gapless invoice numbering) → C-32 (invoices) → C-33 (cash/manual payments) → C-35–C-38 (Razorpay + webhooks).
2. **Close the audit-log coverage gap (F-15).** Six known call sites are unaudited today with zero regression protection. Writing the coverage-assertion test first (even before fixing all six sites) converts a silent, growable gap into a visible, CI-enforced one — consistent with how this codebase has closed every other gap it has found (isolation, demo-mode, self-merge).
3. **Decide the two pending RED items** (`docs/red-proposals.md` §3.1 documents token scheme, §3.8 support impersonation) — both are explicitly named as blocking further Phase 3 work and have sat pending; a RED-level decision requires a signed-off proposal before implementation per this repo's own `execute-task` skill convention, so the blocker is a decision, not a build.
4. **Wire `scripts/check-line-count.ts` into CI, even in non-blocking/report-only mode first.** It currently isn't run at all, contrary to a previously corrected false claim in its own header — 23 files are already over budget and the number will only grow without visibility. Flip `STRICT = true` only after a deliberate pass to bring the worst offenders (`db/preset-engine.ts` at 713 lines, `lib/services/staff-invitations.ts` at 536) under the limit.
5. **Build the Excel/CSV importer (C-09–C-11).** project-scope.md's own risk table calls onboarding friction "high likelihood, high impact," and the importer is the named mitigation — it does not exist today, which means every current tenant's setup is fully manual.
6. **Get legal input on the two counsel-blocked DPDP items** (V-45a consent-withdrawal offboarding, V-47 erasure-retention conflict) — these are correctly marked in the plan as "do not implement locally" pending an Indian-counsel conversation, so the next action is scheduling that conversation, not writing code.
7. **Do not start Phase 3's vertical/staff-pay work (V-01 onward) until the money layer lands** — the plan's critical path (`F-05 → F-08 → C-19 → C-20 → C-22 → V-30`) and the architecture's own build-order (§19) both place staff pay's per-session computation downstream of trustworthy session/attendance data, and batch profitability (the differentiator) downstream of both pay and money. Building the vertical module out of this order risks a second rework pass once billing exists.
