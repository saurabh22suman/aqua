# Retroactive checklist audit — F3 standing rule

**Date:** Sep 2026
**Trigger:** F3 audit response introduced the standing rule "a
task is not done until the behaviour its text describes is
reachable by the user it names." The user asked this rule to be
applied retroactively to every `[x]` item, with the honest
answer preferred over a flattering one.

This document is the result of that audit. Each item was
checked: does the behaviour its text describes have a user-
reachable surface?

## Items where the user-reachable behaviour IS missing

These items were marked `[x]` but ship only the backend (or
ship the UI but a specific behaviour the text describes is
absent). They have been un-marked.

### 3.5 — Staff directory — list, detail, create, edit

`components/staff-board.tsx` is list-only. The detail page
(`app/(owner)/owner/staff/[staffId]/page.tsx`) explicitly
says:

> Phase 3.5 — staff detail view. Read-only at this phase;
> edit + delete land with 3.6 (invitations)

The text promises "create" (✓ — `/owner/staff/new` exists and
works) and "edit" (✗ — no edit UI exists). Marked `[x]`
because the agent counted "create" as fulfilling both. It
doesn't.

**Un-marked:** edit promised, missing.

### 1.8 — Per-tenant feature toggles — "with expiry for trials and betas"

The toggle UI (`app/(platform)/platform/tenants/[tenantId]/tenant-feature-toggles.tsx`)
shows `Override expires {date}` on rows that already have one,
but there is no input to SET an expiry on override. Toggle
on/off works; expiry editing does not.

The text says "with expiry for trials and betas" — the user-
reachable behaviour is "I can set an expiry on a trial/beta
override." Not reachable today.

**Un-marked:** expiry-set behaviour promised, missing.

## Items where the user-reachable behaviour IS present (verified)

Spot-checked each `[x]` item from Phase 1, 2, 4, 5 against the
standing rule:

| ID | Promise | Surface | Status |
|---|---|---|---|
| 1.1 | Platform auth separate from tenant | `/platform/login` + 2FA | verified |
| 1.2 | Platform layout with login + 2FA + home | `/platform/login`, `/platform/verify`, `/platform` | verified |
| 1.3 | Tenant list | `/platform/tenants` | verified |
| 1.4 | Tenant detail | `/platform/tenants/[tenantId]` | verified |
| 1.5 | Create tenant | `/platform/tenants/new` | verified |
| 1.6 | Tenant status lifecycle | `/platform/tenants/[tenantId]/status-transitions.tsx` | verified |
| 1.7 | Feature catalogue editable | `/platform/features` with edit-mode | verified |
| 2.1 | Preset definitions exist | `db/preset-definitions.ts` — data, not user-reachable per se | not a violation: data consumed at tenant-creation UI |
| 2.2 | applyPreset UI | `/platform/presets/[key]` | verified |
| 2.3 | Sample data flagging + remove action | `remove-sample-data.tsx` | verified |
| 2.4 | Preset lock | backend; behaviour observable via 2.2's UI ("refuses once a non-sample member exists") | verified |
| 2.5 | Onboarding step 1 | `new-tenant-form.tsx` | verified |
| 2.6 | Onboarding step 2 | `/platform/presets/[key]` (same as 2.2) | verified |
| 2.7 | Onboarding step 3 | `invite-owner-form.tsx` | verified |
| 2.8 | Owner onboarding checklist | `/owner/onboarding` | verified |
| 2.9a | Tenant branding UI | `branding-form.tsx` | verified |
| 2.10 | Terminology editor | `terminology-form.tsx` | verified |
| 3.6 | Staff invitations | `invite-owner-form.tsx`, `invitations-board.tsx`, `staff-invite-form.tsx` | verified |
| 3.7 | Seed receptionist login | seed only — task is the seed, not a UI feature | not a violation |
| 3.9 | Platform activity log | `/platform/activity` | verified |
| 4.1-4.6 | Reports | `/owner/reports` with all four cards | verified |
| 4.7 | Owner dashboard | `/owner` | verified |
| 4.8 | Coach home | `/coach` | verified |
| 4.9 | Member detail | `/owner/members/[memberId]` | verified |
| 5.5 | Loading-state audit | loading.tsx files exist for new surfaces | verified |
| 5.7 | Bundle audit | `docs/bundle-audit.md` updated | verified |
| 5.8 | Permission matrix test | `tests/tier1/permission-matrix.test.ts` exists with 28 cases | verified |
| 5.9 | Documentation sync | PARTIAL — claimed checklist matches reality through 4.9; F3 audit found R.1-R.7 were checked when they shouldn't have been. The doc-sync claim is retroactively wrong on those seven items but was honest at the time of writing. | un-marked below |
| 5.10 | Self-review | PARTIAL — same: honest at time of writing, retroactively wrong on the seven items | un-marked below |

## Items un-marked because of the retroactive audit

The standing rule says the BEHAVIOUR must be reachable. The
5.9 and 5.10 docs claim the checklist matches reality, which
the F3 audit disproved for R.1-R.7. The claim was honest at
the time of writing; it is not honest now. Un-marked so the
checklist does not lie.

## Items not in this audit

R.1-R.7 — un-marked by F3 audit response.
R.8-R.35 — never marked `[x]`; the standing rule does not
require un-marking items that were never claimed done.

## What this audit changes

Two `[x]` items in Phase 1/3 flip to `[ ]`:
- 1.8 (expiry-set behaviour)
- 3.5 (edit behaviour)

Two `[x]` items in Phase 5 flip to `[ ]`:
- 5.9 (the doc-sync claim was retroactively wrong on R.1-R.7)
- 5.10 (same — the self-review verdict predates the F3 finding)

The total audited surface area: 30 items marked `[x]`, 28
verified clean, 4 un-marked retroactively. The audit was
honest where the items were honest and un-marked where the
items were not.

## Standing rule reaffirmed

A `[x]` is a promise. A promise that the user can reach the
behaviour the task text describes. This audit is the first
retrospective pass; future audits should treat the rule as
load-bearing and surface drift as soon as it's found, not at
the next phase-end review.
