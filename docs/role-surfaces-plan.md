# Role surfaces plan — v1

**Status:** v1, 2026-09-13. Working plan for role-screen work after the
2026-09-12 mobile UX audit sweep (PR #137) and the multi-facility
discussion.
**Basis:** (a) a full codebase inventory of every route/nav per role,
(b) the planned-feature register extracted from
`docs/implementation-plan.md`, `docs/project-scope.md`,
`docs/five-day-work-guide.md`, and `docs/architecture.md`, (c) the
deferred-item register from `docs/mobile_ux_imp-plan.md`,
`docs/red-proposals.md`, `AUDIT-REPORT.md`, and (d) market research on
Indian and global academy-management products (Sportzy,
sports-academy-software.in, SportStr, Kalam, SwimProHub/AcademyPRO,
Jackrabbit, Zen Planner, Playo Partner, GymWyse/Mindbody, plus owner
threads on r/SoccerCoachResources, r/youthsoccer, r/bjj).

Goal: every role's screen set matches the job that role is hired to do,
without inventing a fifth bottom-nav item and without faking money
surfaces that do not exist yet.

---

## 1. Market findings

1. **Owner = money + capacity control room.** Collections and dues,
   enrolment, utilisation, retention/churn, per-location plus
   consolidated reporting, GST invoices, staff performance. Every
   serious product leads with this (Sportzy, sports-academy-software.in,
   GymWyse, Mindbody).
2. **Reception = front desk.** Fee collection at the counter with
   receipts and a daily reconciliation, check-in, enquiry capture and
   follow-up. Today Aqua's receptionist cannot collect a fee at all.
3. **Coach = today + marking + progress.** Offline attendance, roster,
   bulk marking, and increasingly assessment/progress capture
   (SwimProHub's core pitch). Bulk actions are table stakes.
4. **Parent = WhatsApp-first.** A lightweight page for attendance,
   schedule, fees and progress; renewals and reminders arrive on
   WhatsApp. Aqua's zero-JS `/p/[token]` page is already the right shape.
5. **Multi-location is a first-class segment.** Central dashboard,
   branch-scoped logins, cross-location member profiles, and — relevant
   to the open facility decision — **consolidated invoicing for a member
   enrolled across programs/centres** (SportStr sells this explicitly).

## 2. Current state (post-#137)

| Role | Nav | Notable gaps |
| --- | --- | --- |
| Owner | Home / Members / Reports / Settings | Sessions, Programs, Enquiries, Staff, Onboarding only via cards/back-links (F26 deferred). No facility switch. Member list/detail has no joined date or attendance summary. |
| Reception | Today / Add member / Enquiries / Me | Today is read-only; no fee collection (blocked on C-32/C-33), no quick member lookup from Today. |
| Coach | Today / Schedule / Members / Me | No bulk mark-all, no Late, no undo; roster lacks attendance %/last-marked. |
| Parent | `/p/[token]` (functional) + `/parent` stub | Stub is a bare `h1`; workers land on it. No fees/progress/schedule (planned). |
| Ops | Overview / Tenants / Features / Presets (+Activity card) | `/platform` links and login/verify redirects 404; `/ops/plans/[planId]` link 404s; Overview has no stats. |

Backend-only with no UI: holidays (R.3), cancel/reschedule (R.4),
waitlist (R.5), transfer (R.6), makeup (R.7). Unbuilt: all money
(C-29→C-39), all messaging (C-40→C-43), progress (V-09→V-13), payroll
(V-23→V-34), facilities/booking (V-01→V-08), importer (C-09→C-11),
documents (3.2→3.4), DPDP withdrawal/export (V-45→V-47).

## 3. Per-role recommendations

### Owner

**Keep:** Home (registers hero, KPIs, needs-you, lanes), Members +
member 360, Reports, Settings; Enquiries, Programs/Batches, Sessions +
substitution, Staff/invites, Branding, Vocabulary, Onboarding.

**Add (now, no schema):**
- Facility switcher in the owner header (`All facilities` + each),
  persisted as `?facility=`, applied to the members list; consolidated
  per-facility card on Home.
- Home quick-links grid (Enquiries, Programs & Sessions, Staff,
  Onboarding) — resolves F26 without a fifth nav item.
- Member joined date (`created_at` until an explicit `joined_on` lands,
  Wave 2) on list and detail.
- Make "Register not started" actionable; finish report copy polish
  (`—`, `1 → 0`).

**Add (later, planned):** money hero and dues (C-46, C-29–C-39),
holiday editor (R.3), cancel/reschedule UI (R.4), waitlist/transfer/
makeup UIs (R.5–R.7), absence alerts (R.8/V-20), progress and skills
(V-09–V-11), payroll (V-23–V-34), facilities/booking (V-01–V-08),
importer, documents, consent withdrawal/export, staff edit (3.5 tail),
member↔facility opt-ins and per-facility pricing (new tasks, Wave 2).

**Remove/move:** the false cancel/reschedule copy on `/owner/sessions`;
the "Today's facilities" heading (it renders batches); the `/platform`
and `/ops/plans` dead links; the GA flag on unbuilt billing/messaging.

### Reception

**Keep:** Today, Add member, Enquiries, Me.
**Add (now):** quick actions on Today (find member, new enquiry, new
member); expected-roster count per session.
**Add (later):** fee collection + receipts + daily reconciliation
(C-32–C-34); walk-in booking (V-04); documents (3.4); notification
centre (R.19).
**Remove:** nothing.

### Coach

**Keep:** Today, Schedule, Members, Register, Me.
**Add (now):** "Mark all present", a Late option, and undo on the
register; attendance %/last-marked on the roster.
**Add (later):** assessments (V-10), progress pips (V-11), lane
grouping (V-12), absence alerts (R.8), self check-in (V-25), shift
roster (V-23).
**Remove:** nothing.

### Parent

**Keep:** `/p/[token]` zero-JS page.
**Add (now):** branded explainer page for `/parent` ("your club sends
you a link") instead of the bare stub; 7-day upcoming sessions, coach
name and facility on the parent page.
**Add (later):** fees/payment links (C-32/C-36), progress pips (V-11),
absence alerts (V-20), consent withdrawal (V-45), full schedule.
**Remove:** the bare `h1 Parent` stub.

### Ops

**Keep:** Overview, Tenants, Tenant detail, Features, Presets,
Activity, auth.
**Add (now):** stats on Overview; fix `/platform` redirects to `/ops`;
remove or build the plans link; feature search; move "Invite owner" to
the top of tenant detail.
**Add (later):** plan/quota management, impersonation (3.8), storage
meter, demo reset action, per-location overrides (R.28).
**Remove:** dead links.

## 4. Waves

### Wave 1 — this PR (no schema, no money)

| ID | Task | Done when |
| --- | --- | --- |
| W1-1 | This plan doc | Reviewed with the owner. |
| W1-2 | Fix dead `/platform` links and login/verify redirects | No route in `app/` links to `/platform`; ops login/verify redirect to `/ops`; source guard test. |
| W1-3 | Parent stub → branded explainer | `/parent` renders the club-link explainer, not a bare heading; test. |
| W1-4 | Owner Home quick-links grid | Home shows Enquiries / Programs & Sessions / Staff / Onboarding links; nav stays four items; test. |
| W1-5 | Member joined date | `MemberListRow.createdAt` returned and rendered as `Joined 12 Sept 2026` on list + detail; test. |
| W1-6 | Owner facility switcher + consolidated view | When the tenant has >1 location, owner screens show an `All facilities` + per-facility switcher persisted in `?facility=`; members list filters; Home shows a per-facility member/attendance breakdown in the All view; hidden when ≤1 location; tests. |

### Wave 2 — delivered (schema + full UI)

Decisions taken 2026-09-13 (owner):
1. `members.joined_on` — nullable date, backfilled from `created_at`,
   editable in create/edit forms, display falls back to `created_at`.
2. `batches.location_id` — nullable FK, backfilled to the tenant's
   primary facility; create/edit forms send one; the service falls
   back to the primary location.
3. Member↔facility opt-ins — `member_facility_optins` (active =
   `ended_on is null`), `members.location_id` stays the home facility.
   Owner member detail has add/end; the members list facility filter
   matches home OR active opt-in; the dashboard breakdown counts a
   member at every facility they train at and attributes attendance to
   the batch's facility.
4. Billing — per-facility invoices when C-29 → C-33 land; C-31's
   per-location numbering stands.
5. GSTIN — one tenant GSTIN for now; per-facility GSTIN is a later
   legal/entity decision.

Deferred to Wave 3: pricing/subscriptions/invoices/payments, WhatsApp
messaging, and any fee surface (nothing fakes money).

### Wave 3 — money + messaging (plan order)

C-29 → C-30 → C-31 → C-32 → C-33 → C-34, then C-40 → C-43. These
unlock reception fee collection, owner dues/collections, parent fees
and receipts, and every reminder flow. Nothing above should fake these
surfaces before they land.

Open questions (owner, 2026-09-13) — to settle before Wave 3 starts:
- Plan shapes/pricing: per-facility plans vs tenant-wide plans with
  per-facility prices; duration vs session-pack vs one-time.
- Billing cycle: monthly anniversary vs 1st-of-month; proration on
  mid-cycle opt-in/out.
- Pause/refund policy (C-30 "pause extends end date"; V-17 scope).
- Messaging provider (C-40 BSP, credentials, cost).
- **Ops-controlled shapes with dependencies:** when creating a tenant,
  all modules would be a single opt-in/opt-out, but some options
  require others to be enabled (e.g. a booking module needs facilities;
  invoicing needs a plan). The feature/preset catalogue needs a
  dependency graph — enabling a child auto-enables (or refuses without)
  its parent, and disabling a parent disables or blocks its children.
  Needs a design pass before R.28 (per-location overrides) and the
  platform feature catalogue work.

## 5. R.8 — absence alerts (delivered)

Owner decisions 2026-09-13, implemented in PR #140:
- low-attendance threshold **owner-configurable, default 50%**; the
  monthly alert also requires **≥ 4 recorded marks** (fixed noise
  guard), so a single miss never fires;
- coach surface = **member detail only** (read-only list);
- parent surface = **one line under "This month"** on `/p/[token]`;
- **read-only** — no acknowledgement state.

Built: `absence_alerts` table + `tenants.absence_alert_threshold_pct`
(migration `20260913000300`), `lib/services/absence-alerts.ts`
(detection + ISO-week dedupe), daily `alerts.absence` job scheduled per
tenant at 07:00 local alongside `sessions.generate`, owner settings at
`/owner/settings/alerts`, coach list component, and the parent line.
Tests: `tests/mobile/absence-alerts.test.ts` (hermetic container:
dedupe, threshold, parent data), `absence-alerts-list.test.tsx`,
`alert-settings-form.test.tsx`.

## 6. Defects to fix regardless of waves

- `/platform` links/redirects (5 sites) and `/ops/plans/[planId]` link.
- `/owner/sessions` copy promises cancel/reschedule with no UI (R.4).
- Feature catalogue marks `billing` and `messaging` as GA while unbuilt.
- `components/ui/Row.tsx` and `FieldError.tsx` have no product call
  sites (wire or delete).
- `/owner/reports` `—` and `1 → 0` copy (partially swept).

## 7. Open decisions

1. Consolidated vs per-facility invoicing (Wave 2, affects C-31/C-32).
2. Worker surface: build `(worker)/tasks` (R.13) or give workers a
   real placeholder instead of `/parent`.
3. Owner quick-links grid vs a "More" sheet — grid proposed here
   because the four-item rule is absolute.
