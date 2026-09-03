# Demo runbook — Aqua control plane + demo-academy

How to walk the operator, owner, coach, parent, and receptionist
through a working demo of the system. Each step names the phone
number to sign in with and the screens to show, with the "what's
not built yet" callout the operator should say up front.

## What works

- Auth: phone + OTP code via `better-auth`. The dev-mode hint
  appears in the page (`dev code:` + 6 digits) so OTP delivery is
  a no-op in the demo.
- Five roles log in and land on a working surface:
  - **Owner** (`+91 90000 00001`) → `/owner` (full owner dashboard,
    members, programs + program/batch create/edit, enquiries)
  - **Coach** (`+91 90000 00002`) → `/coach` (today's sessions,
    register screen, next-7-day schedule, roster)
  - **Receptionist** (`+91 90000 00004`) → `/reception` (today's
    sessions, add member, log enquiry, enquiry detail)
  - **Parent** (`+91 90000 00003`) → `/parent` (stub — see below)
  - **Platform operator** (`ops@aqua.local` / password printed by
    `pnpm tsx scripts/seed-platform-user.ts` / TOTP on the same
    line) → `/platform` (tenants, presets, features)
- Demo tenant `demo-academy` pre-seeded with 2 batches, 16 members
  (all adults so the registration lock doesn't fire), a
  Morning-Squad session that runs **every day** (so there is always
  a today-session to show) with attendance marked for all 16, and
  3 enquiries at different stages (new / contacted /
  trial_scheduled) so the detail flow can be walked.
- The owner dashboard shows 100% on register, 100% attendance this
  week, "2 Batches running" and a lane: 07:00 Morning Squad /
  Swimming Foundations / 16/16.

## What is NOT built — say this up front

So the operator doesn't notice a missing screen mid-demo:

1. **No payments, no plan selection, no invoices.** The owner
   dashboard has a "to collect" hero element that only renders
   when there are real invoices; demo-academy has none, so it
   doesn't appear. The "no money work" exclusion per Phase 1's gate.
2. **Parent surface.** `/parent` is still a stub — parents are
   deliberately out of scope until the parent app lands. A parent
   login exists so the role doesn't 404, but there is nothing to
   show. Name this rather than demo it.
3. **No branding / terminology / settings editor.** Owner-side
   `/owner/settings` and `/owner/reports` are stubs.
4. **No book-trial / convert-to-member UI beyond the enquiry
   detail.** The enquiry detail page has stage transitions and
   follow-ups; book-trial and convert-to-member actions exist but
   are only reachable from the enquiry detail's buttons, not a
   dedicated flow.
5. **`/coach/me`** is a stub (profile page not built).

## Starting the demo

`pnpm demo:reset` does it all. One command, gated on `DEMO_MODE=true`:

```bash
# From the repo root, with DEMO_MODE exported in the shell:
DEMO_MODE=true pnpm demo:reset

# Equivalent if you prefer a one-liner with the env inline:
DEMO_MODE=true pnpm demo:reset && DEMO_MODE=true PORT=3211 pnpm next dev
```

`pnpm demo:reset` runs `db:reset` → `seed-demo` → `seed-platform-user` in that order. If `DEMO_MODE` is **not** set, `demo:reset` itself exits before spawning any of the three steps — a misfired `pnpm demo:reset` does nothing. `db/reset.ts` (`pnpm db:reset`) is *also* directly runnable on its own — as a standalone script, as CI's own `db:reset` step, or by a deploy process — so it carries its own gate rather than relying on the wrapper above it: it refuses unconditionally when `NODE_ENV=production`, and otherwise refuses unless `DEMO_MODE=true` or `--i-understand` is passed explicitly (`pnpm db:reset -- --i-understand`), printing the target host and database name and — when run from an interactive terminal — requiring you to type the database name back before it drops the schema. The same `DEMO_MODE` guard is also on `scripts/seed-demo.ts` and `scripts/seed-platform-user.ts` if you ever want to run the steps by hand:

```bash
DEMO_MODE=true pnpm db:reset
DEMO_MODE=true pnpm tsx scripts/seed-demo.ts
DEMO_MODE=true pnpm tsx scripts/seed-platform-user.ts
DEMO_MODE=true PORT=3211 pnpm next dev
```

**Re-running `seed-platform-user.ts` signs out any open operator tab.**
It deletes and re-provisions the `platform_users` row for that email
(re-runnable by design); `platform_sessions.user_id` cascades on
delete, so every session belonging to that user — including the one
in a browser tab you're mid-demo in — disappears immediately. The
next request from that tab gets redirected to `/platform/login`, not
because anything in the tenant-creation or auth code is broken, but
because the session it was relying on genuinely no longer exists.
`demo:reset` chains this script, so the same applies there. Close or
refresh the platform tab after re-seeding.

When `DEMO_MODE=true`, a sticky banner sits at the top of every surface
(login, owner, coach, reception, parent, platform) reading
**"Demo data — this is a demo tenant. None of this is real academy data."**
The banner is the only place in the runtime that reads `DEMO_MODE`
besides the parser itself; the source-scan test in
`tests/tier1/demo-mode-reads.test.ts` enforces this confinement so
the flag never becomes a feature flag.

**Production hard-fail.** `lib/env.ts` refuses to parse if
`DEMO_MODE=true` and `NODE_ENV=production` (build phase exempt, for
the same reason `BETTER_AUTH_SECRET` is exempt). A real club's
deployment cannot accidentally seed demo members into a real
database.

To log in as a phone-role user, type the phone with or without
spaces (the form normalises):

- Owner: `+91 90000 00001`
- Coach: `+91 90000 00002`
- Parent: `+91 90000 00003`
- Receptionist: `+91 90000 00004`

The "dev code: XXXXXX" hint appears right under the OTP field in
dev mode.

## Walk order

### 1. Platform operator — 2 minutes

Log in at `/platform/login` with the credentials printed by
`scripts/seed-platform-user.ts`.

- **`/platform`** — the home page shows "Tenants" and "Feature
  catalogue" cards. Click "Tenants".
- **`/platform/tenants`** — the list. Click `demo-academy`.
- **Tenant detail (`/platform/tenants/<id>`)** — shows
  Settings (timezone Asia/Kolkata, plan Standard, no preset
  applied), Feature state (all enabled), Status section with
  the lifecycle buttons (Activate / Suspend / Churn).
  The "Owner" section has a phone field with "Invite owner"
  button. The "Sample data" section will only appear if
  `applyPreset` was run on the tenant; demo-academy has no
  preset applied, so this section is hidden.
- **`/platform/presets`** — the catalogue shows swimming and
  multi-sport. Click into swimming.
- **Preset detail (`/platform/presets/swimming`)** — the
  preview pane shows counts and breakdown; the "Apply to a
  tenant" form is the picker with the demo-academy option
  pre-selected.
- **`/platform/features`** — the feature catalogue with
  editable rows. Skip the editing flow — the owner-side feature
  toggles are the more interesting surface.

### 2. Owner — 5 minutes

Sign out, log in as `+91 90000 00001`.

- **`/owner` (dashboard)** — the demo data lights this up:
  - Today's registers: 100% (16 of 16 marked across 1 session)
  - Active members: 16
  - Attendance this week: 100%
  - 2 Batches running
  - Today's lanes: 07:00 Morning Squad / Swimming Foundations / 16/16
- **`/owner/members`** — list of 16 members. Click any member.
- **Member detail (`/owner/members/<id>`)** — shows name, code,
  Edit link, attendance section. Edit and back.
- **`/owner/programs`** — two programs (Swimming Foundations,
  Junior Competitive). **Create + edit both programs and batches**
  here, including the coach picker on a batch:
  - Add a program ("Water Polo"), edit its name.
  - Add a batch ("Wednesday Evening") under a program, assign a
    coach from the picker, then edit the batch (rename, change
    coach). This is the "let me add a Wednesday evening batch"
    moment — it works.
- **`/owner/enquiries`** — three seeded enquiries at different
  stages. Click one.
- **Enquiry detail (`/owner/enquiries/<id>`)** — stage pill with
  "Move to …" buttons, follow-up list with add / mark-done, and
  Book-trial / Convert actions. Move a `new` enquiry to
  `contacted`, add a follow-up, mark it done.
- **`/owner/settings`** — stub. (Phase 2.10.)
- **`/owner/reports`** — stub.

### 3. Receptionist — 2 minutes

Sign out, log in as `+91 90000 00004`. This lands on the dedicated
reception surface (`/reception`), not the old `/parent` stub.

- **`/reception` (today)** — the same today-sessions list the
  coach sees, for the front desk.
- **`/reception/members/new`** — the full add-member form
  (guardian fields for minors, consent checkbox). Adding a member
  returns to `/reception`.
- **`/reception/enquiries`** — the quick-capture form. Capture a
  walk-in; it appears in the list. Click an enquiry to open its
  detail (stage transitions + follow-ups) inside the reception
  surface.

### 4. Coach — 3 minutes

Sign out, log in as `+91 90000 00002`.

- **`/coach` (today)** — one session card: 07:00 am Morning
  Squad with 16/16 attendance. Click the card.
- **`/coach/register/<id>`** — the live register screen for
  that session. Each roster row has Present / Absent / Late
  buttons. Click any present to mark. The dashboard reflects
  in real time.
- **`/coach/schedule`** — the next-7-day schedule across the
  coach's batches, each day's sessions linking to its register.
- **`/coach/members`** — the roster: members enrolled in the
  coach's batches, deduped, with the batch names they belong to.
- **`/coach/me`** — stub.

### 5. Parent — skip or 30 seconds

Sign out, log in as `+91 90000 00003`. `/parent` is a stub — say
"parents are out of scope today" rather than showing it.

## Editing the demo seed (operator)

`scripts/seed-demo.ts` exposes top-level constants you change:

```ts
const DEMO_TENANT = { slug, name, timezone, currency, gstin, firstLocation };
const DEMO_PROGRAMS = [{ name }];
const DEMO_BATCHES = [{ program, name, daysOfWeek, startTime, capacity }];
const DEMO_PEOPLE = [{ name, phone, role, dateOfBirth? }]; // role: owner|parent|coach|receptionist|accountant|worker
const DEMO_MEMBERS = [{ name, code, dob }];
const DEMO_ENQUIRIES = [{ fullName, phone?, source, stage, notes? }];
```

Rules:

- Member birth dates must yield adult isMinor=false (post-1980)
  — the registration guard refuses otherwise.
- Staff phone numbers must be unique across `users.phone`.
- Program names and batch names must be unique within a tenant.
- **Keep the first batch running every day** (`daysOfWeek:
  [0,1,2,3,4,5,6]`) so "today's register" always has a session to
  show on demo day, whatever the weekday.
- Keep at least one `DEMO_ENQUIRIES` row at a non-converted stage
  so the enquiry-detail flow has something to click.

After editing:

```bash
pnpm tsx scripts/seed-demo.ts
```

Demo-day run order: **reset → seed**. The member rows are not
idempotent; a second run without reset hits
`members.tenant_id_member_code_key`.

## What I did NOT build (so the operator doesn't notice mid-demo)

- **Plan-shape activation (2.6)** — no real plans, no shape
  activation, no amount on the seeded plan. demo-academy's
  plan_id is the standard seeded plan with no plan_shapes attached.
- **Invite flow (2.7)** — partial. The "Owner" section on
  `/platform/tenants/<id>` accepts a phone number and calls
  `inviteOwnerAction`; the UI doesn't show a confirmation of the
  membership creation yet.
- **Sample-data remove (2.3)** — hidden on a tenant with no preset
  applied (demo-academy). Apply a preset first and the "Sample
  data" section appears on the tenant detail.
- **Owner settings, owner reports, coach me** — stubs.
- **Reports (Phase 4 / Phase 5)** — `/owner/reports` is a stub.

## Quick smoke checks if something looks wrong

- Dashboard says "0 Active members": run `pnpm db:reset` then
  `pnpm tsx scripts/seed-demo.ts` again.
- Coach sees no register link: the first batch must run every day
  (`daysOfWeek: [0,1,2,3,4,5,6]`). Re-seed.
- Login fails with "verify state" or "expired": the dev code hint
  rotates on a 30-second boundary. Resend the code and use the
  new six digits.
- Platform login fails: the operator password is regenerated on
  every run of `scripts/seed-platform-user.ts` — use the creds it
  printed, not an older run's.

## File map

- `scripts/seed.ts` — the canonical pretest fixture (16 generic
  members). DO NOT EDIT for the demo; the operator's data lives
  in `scripts/seed-demo.ts`.
- `scripts/seed-demo.ts` — operator-editable demo data.
- `scripts/seed-platform-user.ts` — seeds the platform operator.
- `app/(owner)/owner/...` — owner surface.
- `app/(coach)/coach/...` — coach surface (today, schedule,
  register, members).
- `app/(reception)/reception/...` — receptionist surface (today,
  add member, enquiries + detail).
- `app/(platform)/platform/...` — operator surface.