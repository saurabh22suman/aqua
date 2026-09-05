# Demo runbook — Aqua control plane + tenants

How to walk the operator, owner, coach, parent, and receptionist
through a working demo of the system. Each step names the phone
number to sign in with and the screens to show, with the "what's
not built yet" callout the operator should say up front.

**Source of truth:** the runbook describes what
`scripts/seed-demo.ts` produces right now. `pnpm check:runbook-sync`
fails any commit that changes the seed without updating this file
in the same change. If a number here disagrees with what you see,
the runbook is wrong — update it in the same PR as the seed fix.

## What works

- Auth: phone + OTP code via `better-auth`. The dev-mode hint
  appears in the page (`dev code:` + 6 digits) so OTP delivery is
  a no-op in the demo.
- Five roles log in and land on a working surface:
  - **Owner** (`+91 90000 00001`) → `/owner` (full owner dashboard,
    members, programs + program/batch create/edit, enquiries,
    reports, settings)
  - **Coach (primary)** (`+91 90000 00002`) → `/coach` (today's
    sessions, register screen, next-7-day schedule, roster)
  - **Coach (secondary)** (`+91 90000 00005`) → `/coach` (same
    surface; lets the operator switch to a different coach's view
    mid-walkthrough)
  - **Receptionist** (`+91 90000 00004`) → `/reception` (today's
    sessions, add member, log enquiry, enquiry detail)
  - **Accountant** (`+91 90000 00006`) → no dashboard yet (the role
    exists for permission tests; no UI surfaces are gated to it
    today)
  - **Parent** (`+91 90000 00003`) → `/parent` (stub — see below)
  - **Platform operator** (`ops@aqua.local` / password printed by
    `pnpm tsx scripts/seed-platform-user.ts` / TOTP on the same
    line) → `/platform` (tenants, presets, features)
- The platform tenant list shows three rows:
  - **`Aqua Worli` (Active)** — the swimming-club walkthrough
    tenant. Slug `demo-academy`. Mango accent. 40 members (32
    active, 5 paused, 3 lapsed), 1 location, 6 batches, 8
    enquiries, 21 days of past attendance.
  - **`Kicks Football Academy` (Active)** — the cross-tenant
    comparison tenant. Slug `kicks-academy`. Marine accent.
    Different preset (`multi-sport`). 8 members (4 minors + 4
    adults), 1 location, 2 batches (U-14 Squad + Open Practice),
    2 enquiries (one new, one contacted with overdue follow-up),
    7 days of past attendance on U-14 Squad.
  - **`Orphan Demo` (Churned)** — `slug orphan-tenant`, 0 members,
    0 locations, terminal status. Deliberately seeded so the
    operator sees the lifecycle UI's "no transitions available"
    state without having to suspend a live tenant. Sits at the
    bottom of the list (sort by status then created_at desc).
- Aqua Worli's owner dashboard (live numbers from the seed):
  - **Active members:** 32
  - **Attendance this week:** ~85% (21 days of mixed
    present/absent/late, deterministic from `hash01(member_id)`)
  - **Batches running:** 6 (Morning Squad, Junior TTS, Morning
    Masters, Trial Squad, Holiday Recovery, Late Squad)
  - **Today's registers:** 0% by default (the seed marks past
    sessions, not today's; today's session is generated, and the
    operator can mark it live during the walkthrough)
  - **Today's lanes:** Morning Squad at 07:00, Junior TTS at 17:00
  - **Follow-up overdue:** Meera Nair (2 days overdue),
    Anaya Joshi (1 day overdue)
- Aqua Worli programs: `Learn-to-swim`, `Junior competitive`,
  `Adult masters` (three). Batches per program vary — see
  `DEMO_BATCHES` in `scripts/seed-demo.ts` for the canonical list.
- Aqua Worli members by archetype:
  - `AWS-*` (Learn-to-swim) — kids, mix of guardians attached
  - `JRS-*` (Junior competitive) — teens
  - `MMS-*` (Adult masters) — adults
- Demo-side state worth pointing at:
  - **R.1 substitution** — one past session on Morning Squad
    shows the secondary coach substituted for the primary. Visible
    on `/owner/sessions`.
  - **R.2 conflict** — primary coach is assigned to BOTH Late
    Squad and Holiday Recovery at 18:00–19:00 Mon–Fri. Editing
    either batch's coach surfaces the conflict warning.
  - **R.3 holiday** — `Founder's Day` seeded 14 days out; the
    session generator skips it.
  - **R.5 waitlist** — `Advik Menon` (AWS-005) sits on the Morning
    Masters waitlist (the batch is near-empty).
  - **R.7 makeup credit** — `Aaradhya Iyer` (AWS-002) holds one
    makeup credit against a 5-days-ago Morning Squad session.
- Enquiries (Aqua Worli): 8 rows spanning `new`, `contacted`,
  `trial_scheduled`, `trial_completed`, `converted`, `lost`. The
  operator can move a `new` enquiry to `contacted`, add a
  follow-up, mark it done.
- Branding + terminology editor at `/owner/settings/{branding,
  terminology}` — both live (the runbook used to call these stubs;
  they ship now).
- Reports at `/owner/reports` — live, with attendance by batch and
  CSV export.

## What is NOT built — say this up front

So the operator doesn't notice a missing screen mid-demo:

1. **No payments, no plan selection, no invoices.** The owner
   dashboard has no "to collect" hero element because there are
   no invoices; this is the same as the money-work exclusion.
2. **Parent surface.** `/parent` is a stub — parents are
   deliberately out of scope until the parent app lands. A parent
   login exists so the role doesn't 404.
3. **No accountant dashboard.** `/accountant` is not routed. The
   role exists for permission tests only.
4. **No book-trial / convert-to-member UI beyond the enquiry
   detail.** The enquiry detail page has stage transitions and
   follow-ups; book-trial and convert-to-member actions exist but
   are only reachable from the enquiry detail's buttons, not a
   dedicated flow.
5. **`/coach/me`** is a stub (profile page not built).
6. **`/owner/staff/[staffId]` is read-only.** Staff directory lists,
   details, and creates work; edit lands with the next staff
   invitation cycle.

## Starting the demo

`pnpm demo:reset` does it all. One command, gated on `DEMO_MODE=true`:

```bash
# From the repo root, with DEMO_MODE exported in the shell:
DEMO_MODE=true pnpm demo:reset

# Equivalent if you prefer a one-liner with the env inline:
DEMO_MODE=true pnpm demo:reset && DEMO_MODE=true PORT=3211 pnpm next dev
```

`pnpm demo:reset` runs `db:reset` → `seed-demo` → `seed-platform-user` →
`db:deploy` in that order. The fourth step is reconciliation, not
seeding: `db:reset` only drops and recreates the `public` schema,
and pg-boss's own `pgboss` schema — where every `sessions.generate`
cron row lives — sits outside it and survives untouched. Without a
reconciliation pass, every tenant a previous demo session ever
created leaves an orphaned schedule row behind once its tenant is
gone; `db:deploy` (`db/deploy.ts`) is the same sync that runs before
a real deploy, and running it here prunes anything whose tenant no
longer exists. If `DEMO_MODE` is **not** set, `demo:reset` itself
exits before spawning any of the four steps. `db/reset.ts`
(`pnpm db:reset`) is *also* directly runnable on its own — as a
standalone script, as CI's own `db:reset` step, or by a deploy
process — so it carries its own gate rather than relying on the
wrapper above it.

**Warm up the platform login before he sits down.** `next dev`
compiles each route on its first visit, not at server start — the
platform login → verify → landing sequence measured ~2.5s of pure
compile time stacked across three routes on a cold server. Do one
throwaway login (wrong code is fine, or a real one) right after
starting the dev server so `/platform/login`, `/platform/verify`,
and `/platform` are already compiled. After that, the flow is fast
for the rest of the session.

**A stale-server-action 404 can appear on the very first submit to
any route that just compiled.** In dev mode, submitting a form on
a freshly-compiled route occasionally throws
`UnrecognizedActionError: Server Action ... was not found on the
server` in the browser console — a Fast-Refresh/action-manifest
artifact, not a data problem (nothing gets written on the failed
attempt). A page reload always clears it and the retry succeeds.
If a button click seems to do nothing on a screen you haven't
visited yet this session, reload once before assuming something is
broken.

**Re-running `seed-platform-user.ts` signs out any open operator
tab.** It deletes and re-provisions the `platform_users` row for
that email (re-runnable by design); `platform_sessions.user_id`
cascades on delete, so every session belonging to that user
disappears immediately. The next request from that tab gets
redirected to `/platform/login`. `demo:reset` chains this script,
so the same applies there. Close or refresh the platform tab
after re-seeding.

When `DEMO_MODE=true`, a sticky banner sits at the top of every
surface (login, owner, coach, reception, parent, platform)
reading **"Demo data — this is a demo tenant. None of this is
real academy data."** The banner is the only place in the runtime
that reads `DEMO_MODE` besides the parser itself; the source-scan
test in `tests/tier1/demo-mode-reads.test.ts` enforces this
confinement so the flag never becomes a feature flag.

**Production hard-fail.** `lib/env.ts` refuses to parse if
`DEMO_MODE=true` and `NODE_ENV=production`. A real club's
deployment cannot accidentally seed demo members into a real
database.

To log in as a phone-role user, type the phone with or without
spaces (the form normalises):

- Owner: `+91 90000 00001`
- Coach (primary): `+91 90000 00002`
- Coach (secondary): `+91 90000 00005`
- Receptionist: `+91 90000 00004`
- Accountant: `+91 90000 00006`
- Parent: `+91 90000 00003` (stub)

The "dev code: XXXXXX" hint appears right under the OTP field in
dev mode.

## Walk order

### 1. Platform operator — 2 minutes

Log in at `/platform/login` with the credentials printed by
`scripts/seed-platform-user.ts`.

- **`/platform`** — the home page shows "Tenants" and "Feature
  catalogue" cards. Click "Tenants".
- **`/platform/tenants`** — the list. **Aqua Worli (Active) is
  the walkthrough target**; it leads the list by virtue of
  status-then-created_at-desc sort. Kicks Football Academy
  (Active) is the second row — click it briefly to show the
  cross-tenant comparison (different sport, different preset,
  different accent). Orphan Demo (Churned) is at the bottom;
  click it once to show the "no transitions available" lifecycle
  state.
- **Tenant detail (`/platform/tenants/<aqua-worli-id>`)** — shows
  Settings (timezone Asia/Kolkata, plan Standard, preset
  swimming v1), Feature state (all enabled by plan baseline),
  Status section with the lifecycle buttons (Suspend / Mark
  churned). The "Owner" section has a phone field with "Invite
  owner" button.
- **`/platform/presets`** — the catalogue shows swimming and
  multi-sport. Click into swimming.
- **Preset detail (`/platform/presets/swimming`)** — the preview
  pane shows counts and breakdown; the "Apply to a tenant" form
  is the picker with demo-academy pre-selected.
- **`/platform/features`** — the feature catalogue with editable
  rows. Skip the editing flow unless the operator asks.

### 2. Owner — 5 minutes

Sign out, log in as `+91 90000 00001`.

- **`/owner` (dashboard)** — the demo data lights this up:
  - Active members: 32
  - Today's registers: 0% by default (the seed marks past
    sessions, not today's)
  - Attendance this week: ~85%
  - Batches running: 6
  - Today's lanes: Morning Squad 07:00, Junior TTS 17:00
  - Needs you today: Follow-up overdue (Meera Nair, Anaya Joshi)
- **`/owner/members`** — list of 40 members (32 active, 5
  paused, 3 lapsed). Filter chips at the top. Click any
  member.
- **Member detail (`/owner/members/<id>`)** — shows name, code,
  Edit link, attendance section, guardian panel (visible on
  minors — `AWS-*` and `JRS-*` rows).
- **`/owner/programs`** — three programs (Learn-to-swim,
  Junior competitive, Adult masters). Six batches across them,
  including the R.2 conflict pair (Late Squad + Holiday
  Recovery, both 18:00–19:00 with Coach Aanya Rao).
  - Add a program ("Water Polo"), edit its name.
  - Add a batch under a program, assign a coach, then edit it
    (rename, change coach). The R.2 conflict warning surfaces
    inline when changing the coach on either Late Squad or
    Holiday Recovery.
- **`/owner/sessions`** — R.1 substitution row is visible: a
  past Morning Squad session shows Coach Bhaskar Menon
  substituted for Coach Aanya Rao. Click the substitution row
  to see the audit trail.
- **`/owner/enquiries`** — 8 seeded enquiries at every stage.
  Click one. Move a `new` enquiry to `contacted`, add a
  follow-up, mark it done.
- **`/owner/reports`** — attendance by batch with CSV export
  (live; was a stub before).
- **`/owner/settings/branding`** + **`/owner/settings/terminology`** —
  both editors are live. The owner dashboard's "Aqua Worli"
  name resolves through the closed-key terminology helper; the
  mango accent is the runtime `--accent` token. Edit and save
  to show the round-trip.

### 3. Receptionist — 2 minutes

Sign out, log in as `+91 90000 00004`. This lands on the
dedicated reception surface (`/reception`), not the old
`/parent` stub.

- **`/reception` (today)** — the same today-sessions list the
  coach sees, for the front desk. Today's 17:00 Junior TTS is
  visible (0/8 marked).
- **`/reception/members/new`** — the full add-member form
  (DOB mandatory, gender optional, guardian fields for minors,
  consent checkbox). Adding a member returns to `/reception`.
- **`/reception/enquiries`** — the quick-capture form. Capture
  a walk-in; it appears in the list. Click an enquiry to open
  its detail (stage transitions + follow-ups) inside the
  reception surface.

### 4. Coach — 3 minutes

Sign out, log in as `+91 90000 00002`.

- **`/coach` (today)** — the today's-sessions list. On
  weekdays the operator will see 07:00 Morning Squad and 17:00
  Junior TTS; weekends only Morning Squad (which runs
  Mon–Fri). Click a session card.
- **`/coach/register/<id>`** — the live register screen for
  that session. Each roster row has Present / Absent / Late
  buttons. Click any present to mark. The dashboard reflects
  in real time.
- **`/coach/schedule`** — the next-7-day schedule across the
  coach's batches, each day's sessions linking to its
  register.
- **`/coach/members`** — the roster: members enrolled in the
  coach's batches, deduped, with the batch names they belong
  to.
- **`/coach/me`** — stub.

### 5. Parent — skip or 30 seconds

Sign out, log in as `+91 90000 00003`. `/parent` is a stub —
say "parents are out of scope today" rather than showing it.

## Editing the demo seed (operator)

`scripts/seed-demo.ts` exposes top-level constants you change:

```ts
const DEMO_TENANT = { slug, name, timezone, currency, gstin, firstLocation };
const DEMO_PROGRAMS = [{ name }];
const DEMO_BATCHES = [{ program, name, daysOfWeek, startTime, capacity }];
const DEMO_PEOPLE = [{ name, phone, role, dateOfBirth? }]; // role: owner|parent|coach|receptionist|accountant|worker
const DEMO_MEMBERS = [{ name, code, dob }];
const DEMO_ENQUIRIES = [{ fullName, phone?, source, stage, notes? }];

// Football tenant — second tenant for the cross-tenant demo.
const DEMO_FOOTBALL_TENANT = { ... };
const DEMO_FOOTBALL_MEMBERS = [{ fullName, memberCode, dateOfBirth, phone?, batch }];
const DEMO_FOOTBALL_ENQUIRIES = [{ fullName, phone, source, stage, notes? }];
```

Rules:

- Member birth dates must yield adult isMinor=false (post-1980)
  — the registration guard refuses otherwise. For minors
  (kids in AWS-* and KFB-* U-14 Squad), the seed attaches a
  guardian with the member's phone; do not skip this.
- Staff phone numbers must be unique across `users.phone`.
- Program names and batch names must be unique within a tenant.
- **Keep at least one batch running every day** in each
  tenant's primary batch (e.g. Morning Squad Mon–Fri on Aqua
  Worli, U-14 Squad Mon/Wed/Fri on Kicks) so "today's
  register" always has a session to show on demo day,
  whatever the weekday.
- Keep at least one enquiry at a non-converted stage so the
  enquiry-detail flow has something to click.

After editing:

```bash
DEMO_MODE=true pnpm demo:reset
```

If you changed counts, names, or stages, **update this runbook
in the same change.** `pnpm check:runbook-sync` (and the CI
hook) will fail otherwise — by design.

## What I did NOT build (so the operator doesn't notice mid-demo)

- **Plan-shape activation** — no real plans, no shape
  activation, no amount on the seeded plan. demo-academy's
  plan_id is the standard seeded plan with no plan_shapes
  attached.
- **Invite flow** — partial. The "Owner" section on
  `/platform/tenants/<id>` accepts a phone number and calls
  `inviteOwnerAction`; the UI doesn't show a confirmation of
  the membership creation yet.
- **Sample-data remove** — hidden on a tenant with no preset
  applied (demo-academy has the `swimming` preset applied, so
  this section IS visible; kicks-academy has `multi-sport`
  applied, also visible).
- **Coach me page, accountant dashboard, parent surface** —
  stubs.

## Quick smoke checks if something looks wrong

- Dashboard says "0 Active members": run `pnpm demo:reset`
  then `pnpm tsx scripts/seed-demo.ts` again. (Should not
  happen post-reset; Aqua Worli's count is 32 active from
  the seed.)
- Coach sees no register link: at least one batch per
  tenant must run on the demo weekday (Morning Squad
  Mon–Fri, U-14 Squad Mon/Wed/Fri). Re-seed.
- Login fails with "verify state" or "expired": the dev
  code hint rotates on a 30-second boundary. Resend the
  code and use the new six digits.
- Platform login fails: the operator password is
  regenerated on every run of `scripts/seed-platform-user.ts`
  — use the creds it printed, not an older run's.
- Tenant list shows the churned row first: something
  changed the sort — see `db/platform-tenants.ts`
  (`listTenants`'s `order by`). The contract is status
  then created_at desc; live tenants lead.

## File map

- `scripts/seed.ts` — the canonical pretest fixture (16
  generic members). DO NOT EDIT for the demo; the operator's
  data lives in `scripts/seed-demo.ts`.
- `scripts/seed-demo.ts` — operator-editable demo data.
- `scripts/seed-platform-user.ts` — seeds the platform
  operator.
- `scripts/check-runbook-sync.ts` — fails CI when the seed
  drifts past the runbook.
- `app/(owner)/owner/...` — owner surface.
- `app/(coach)/coach/...` — coach surface (today, schedule,
  register, members).
- `app/(reception)/reception/...` — receptionist surface
  (today, add member, enquiries + detail).
- `app/(platform)/platform/...` — operator surface.