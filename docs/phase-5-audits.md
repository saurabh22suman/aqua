# Phase 5 audits

Self-contained audit of the work shipped through this batch.

## 5.4 — Empty-state audit

Every list in the product gets a designed empty state with
explanatory copy. A verb CTA (an action the user can take) is
included where the empty state is a setup signal — the first
screen a new tenant sees, in particular, is empty, and the
work guide calls out the failing-comparator "competitors leave
it blank". Setup empty states (no rows yet) carry a verb; filter
empty states (no rows match the current filter) just say so.

| Surface | State | CTA |
|---|---|---|
| `/owner/members` | no members yet | "Add your first member" → /owner/members/new |
| `/owner/members` (filtered) | no members match | none — filter is the CTA; reset the filter |
| `/owner/enquiries` | no enquiries yet | quick-capture form above + a hint pointing to it |
| `/owner/staff` | no staff yet | "Add your first staff member" → /owner/staff/new |
| `/owner/staff/invitations` | empty queue | "Invite your first staff member" → /owner/staff/invitations/new |
| `/owner/programs` | no programs | BatchCreateForm gates on `programs.length > 0` and shows "Add a program first" |
| `/owner/batches/[id]` | no marks yet | reads "Hasn't happened yet" / capacity-based honesty |
| `/coach/` (today) | no sessions today | "Sessions are generated four weeks ahead" |
| `/coach/.../sessions` (filtered) | empty | filter guidance |
| `/owner/reports` (4 cards) | empty | "No batches ran sessions in this period" etc. — capacity-honest |
| `/owner/member/[id]` attendance | empty | "No sessions marked yet this month" |
| `/owner/member/[id]` guardians | none | "No guardian on file" — no add-guardian UI today; the registration flow is the right path |
| `/owner/member/[id]` consent | none | "No consent on file" — same reasoning |
| `/platform/activity` | empty | "No events" — "Nothing has happened that matches the current filters" |
| `/owner/staff/[id]` staff detail | n/a (always has the person) | — |
| `/owner/staff/[id]/...` no enrolments | "No enrolments" | reader guidance only |
| `/owner/enquiries/[id]` no follow-ups | n/a (header always shown) | — |

Empty-state copy was tightened in this round on
`components/enquiries-board.tsx` — the "No enquiries yet" now
points at the quick-capture form above the list rather than just
saying the list is empty.

Setup CTAs (Add your first member / Add your first staff
member) all link to a real destination. The work guide calls
out "the first screen a new tenant sees is empty; competitors
leave it blank" — every setup empty state on a real list has
an action link, not a blank page.

## 5.5 — Loading-state audit

Skeletons everywhere on the new surfaces shipped this batch.
The 5.5 status was already captured in PR #56's commit
message; the only new surfaces added in subsequent rounds
(/owner/batches/[batchId] for R.4.2, /owner/staff/invitations/new
for R.3.6's UI follow-up) ship their own loading.tsx files.
The standing rule — skeletons, not spinners — is maintained
across the batch.

## 5.6 — Mobile audit

Every screen at 390px. The new surfaces in this batch:
- 16px inputs above the iOS-zoom-on-focus threshold: every
  form input in lib/actions/shape with type=text or
  type=number uses `text-[16px]`. R.4.2's batch detail page
  inherits the existing Programs page's input scale.
- 44px touch targets: every action button in
  components/onboarding, components/staff-create-form,
  components/staff-invite-form, and the activity filter bar
  uses `min-h-[44px]`. Submit / Save buttons are 44px
  minimums.
- No horizontal scroll: the iOS-style 100vw padding comes
  from the page shell; all new page-level content is wrapped
  in `px-5` (or tighter) and wraps below 390px.
- The phase 5.6 hotfix (`224b46e`) extended the rule to
  terminology-form inputs (44px + 16px) and the activity
  filter bar (Reset and Apply buttons now 44px tall, selects
  16px).

## 5.7 — Bundle audit

Captured in `docs/bundle-audit.md` (PR #56). The audit
captures per-route JS gzipped at the time of PR #56's snapshot.
The maximum-loaded route is /owner/enquiries/[enquiryId] and
/reception/enquiries/[enquiryId] at 124 kB total — 26 kB under
the 150 kB first-load budget. New routes added since (the R.4.2
/owner/batches/[batchId] page) inherit the same shape; rerun
`pnpm build` to refresh the audit if a refresh is needed.

## 5.8 — Permission matrix test

`tests/tier1/permission-matrix.test.ts` (PR #56). 28 cases
pin the truth table for the four role guards in
`lib/auth/permissions.ts`: assertStaff / assertManagement /
assertMembersWrite / assertEnquiriesAccess across the six
non-platform roles. Mutation proof per review-checklist §6
caught a `receptionist → coach` swap in ENQUIRIES_ROLES; the
matrix test went red; restored.

## 5.9 — Documentation sync

`docs/five-day-work-guide.md` checklist now reflects reality
through 4.9. Architecture §7.5 already covered the keys /
accent / terminology surfaces shipped in 2.9a and 2.10; the
`db/user-account.ts` helper added under `db/` in 3.6 carries
the import/no-restricted-paths rationale in its header. The
architecture section on tenant audit (architecture §8.10)
remains correctly described as deferred; three services
(staff-invitations, transfer, holidays) point at it with
explicit TODO(tenant-audit-log) comments.

## 5.10 — Self-review

`docs/self-review.md`. Per-checklist-section verdict with
one self-flagged slip (the 4.2/4.8 commit-direct-to-main,
named in §1 follow-up). Verification commands re-run:
typecheck / lint / test / build all clean.
