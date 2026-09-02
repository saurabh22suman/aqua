# Demo runbook — Aqua control plane + demo-academy

How to walk the operator, owner, coach, and parent through a
working demo of the system. Each step names the phone number to
sign in with and the screens to show, with the "what's not built
yet" callout the operator should say up front.

## What works

- Auth: phone + OTP code via `better-auth`. The dev-mode hint
  appears in the page (`dev code:` + 6 digits) so OTP delivery is
  a no-op in the demo.
- Four roles log in and land on a working surface:
  - **Owner** (`+91 90000 00001`) → `/owner` (full owner dashboard,
    members, programs, enquiries)
  - **Coach** (`+91 90000 00002`) → `/coach` (today's sessions,
    register screen for the active session)
  - **Parent** (`+91 90000 00003`) → `/parent` (stub — see below)
  - **Platform operator** (`ops@aqua.local` / `w9YbyNGAqSonGN3L` /
    TOTP `397202`) → `/platform` (tenants, presets, features)
- Demo tenant `demo-academy` pre-seeded with 2 batches, 16 members
  (all adults so the registration lock doesn't fire), one
  Morning-Squad session for today with attendance marked for all 16.
- The owner dashboard shows 100% on register, 100% attendance this
  week, "2 Batches running" and a single lane: 07:00 Morning
  Squad — 16/20.

## What is NOT built — say this up front

So the operator doesn't notice a missing screen mid-demo:

1. **No payments, no plan selection, no invoices.** The owner
   dashboard has a "to collect" hero element that only renders
   when there are real invoices; demo-academy has none, so it
   doesn't appear. The "no money work" exclusion per Phase 1's gate.
2. **No receptionist surface.** The receptionist role exists in the
   permission table and the seed scripts (`scripts/seed.ts`,
   `scripts/seed-demo.ts`), but the role's homePath is `/parent`
   (a stub). Owner-side flows cover the same receptionist use
   cases for the demo: capture enquiry, book trial, add member
   with guardian.
3. **No coach schedule or roster.** `/coach/schedule`,
   `/coach/me`, `/coach/members` are stubs (h1 + nav only).
   Only `/coach` (today) and `/coach/register/[id]` (live
   register) work.
4. **No branding / terminology / settings editor.** Owner-side
   `/owner/settings` and `/owner/reports` are stubs.
5. **No enquiry → member conversion UI.** The capture form on
   `/owner/enquiries` exists; the demo starts with zero enquiries
   so the conversion flow isn't walked.
6. **No programme / batch creation UI.** Programs and batches
   are seeded by the demo script. The owner surface doesn't expose
   creation yet; that's Phase 2.6 / 2.7 work.

## Starting the demo

```bash
# From the repo root:

# 1. Reset the DB and apply the demo-academy seed.
#    (The seed is idempotent on (tenant slug, program name, batch name).)
pnpm db:reset
pnpm tsx scripts/seed-demo.ts

# 2. Seed the platform operator.
pnpm tsx scripts/seed-platform-user.ts

# 3. Start the dev server.
PORT=3211 pnpm next dev &
```

`pnpm db:reset` clears the demo-academy tenant's data (because the
seed rewrites). `pnpm tsx scripts/seed-demo.ts` re-creates it.
The seed is idempotent: running it twice will not duplicate
programs/batches.

To log in as a phone-role user, type the phone with or without
spaces (the form normalises):

- Owner: `+91 90000 00001`
- Coach: `+91 90000 00002`
- Parent: `+91 90000 00003`

The "dev code: XXXXXX" hint appears right under the OTP field in
dev mode.

## Walk order

### 1. Platform operator — 2 minutes

Log in with `ops@aqua.local` / `w9YbyNGAqSonGN3L` / TOTP
`397202`.

- **`/platform`** — the home page shows "Tenants" and "Feature
  catalogue" cards. Click "Tenants".
- **`/platform/tenants`** — the list. Click `demo-academy`.
- **Tenant detail (`/platform/tenants/<id>`)** — shows
  Settings (timezone Asia/Kolkata, plan Standard, no preset
  applied), Feature state (all enabled), Status section with
  the lifecycle buttons (Activate / Suspend / Churn).
  The "Owner" section has a phone field with "Invite owner"
  button (Phase 2.7 work). The "Sample data" section will
  only appear if `applyPreset` was run on the tenant; demo-academy
  has no preset applied, so this section is hidden.
- **`/platform/presets`** — the catalogue shows swimming and
  multi-sport. Click into swimming.
- **Preset detail (`/platform/presets/swimming`)** — the
  preview pane shows counts and breakdown; the "Apply to a
  tenant" form is the picker with the demo-academy option
  pre-selected.
- **`/platform/features`** — the feature catalogue with
  editable rows. Skip the editing flow — the owner-side feature
  toggles are the more interesting surface.

### 2. Owner — 4 minutes

Sign out, log in as `+91 90000 00001`.

- **`/owner` (dashboard)** — the demo data lights this up:
  - Today's registers: 100% (16 of 16 marked across 1 session)
  - Active members: 16
  - Attendance this week: 100%
  - 2 Batches running
  - Today's lanes: 07:00 Morning Squad / Swimming Foundations / 16/20
- **`/owner/members`** — list of 16 members. Click any member.
- **Member detail (`/owner/members/<id>`)** — shows name, code,
  Edit link, attendance section. Edit and back.
- **`/owner/programs`** — two programs (Swimming Foundations,
  Junior Competitive). No batch creation yet (Phase 2.7 work).
- **`/owner/enquiries`** — list (empty in demo seed). The
  "Quick capture" form exists; type a name and submit. The
  enquiry appears at the top. (The capture form is the
  Phase 1 work; book-trial / convert-to-member is Phase 2.7.)
- **`/owner/settings`** — stub. (Phase 2.10.)
- **`/owner/reports`** — stub.

### 3. Coach — 2 minutes

Sign out, log in as `+91 90000 00002`.

- **`/coach` (today)** — one session card: 07:00 am Morning
  Squad with 16/32 attendance. (16 is the seeded total. 32 is
  the batch capacity.) Click the card.
- **`/coach/register/<id>`** — the live register screen for
  that session. Each roster row has Present / Absent / Late
  buttons. Click any present to mark. The dashboard reflects
  in real time (the existing register row's status updates).
- **`/coach/schedule`** — stub. ("Schedule" header only.)
- **`/coach/me`** — stub.
- **`/coach/members`** — stub.

### 4. Parent (= receptionist in this build) — 1 minute

Sign out, log in as `+91 90000 00003`.

- **`/parent`** — stub. ("Parent" header only.) The receptionist
  role exists but has no surface; in this demo, reception runs
  through the owner surface (the `/owner/members/new` form has
  a guardian field and a consent checkbox — that is what the
  receptionist flow uses).

## Editing the demo seed (operator)

`scripts/seed-demo.ts` exposes four top-level constants you
change:

```ts
const DEMO_TENANT = { slug, name, timezone, currency, gstin, firstLocation };
const DEMO_PROGRAMS = [{ name }];
const DEMO_BATCHES = [{ program, name, daysOfWeek, startTime, capacity }];
const DEMO_PEOPLE = [{ name, phone, role, dateOfBirth? }];
const DEMO_MEMBERS = [{ name, code, dob }];
```

Rules:

- Member birth dates must yield adult isMinor=false (post-1980)
  — the registration guard refuses otherwise.
- Staff phone numbers must be unique across `users.phone`. The
  seed reuses `+919000000001..3` because `scripts/seed.ts`
  provisions them; on a fresh DB after `pnpm db:reset` you can
  change them.
- Program names and batch names must be unique within a tenant.

After editing:

```bash
pnpm tsx scripts/seed-demo.ts
```

The seed is idempotent on (tenant slug, program name, batch
name) — running it again won't duplicate. The 16 `MEM-001..016`
member rows are NOT idempotent: if you run the seed twice without
`pnpm db:reset`, the second run fails the unique constraint
on `members.tenant_id_member_code_key`. Demo-day run order:
reset → seed.

## What I did NOT build (so the operator doesn't notice mid-demo)

- **Plan-shape activation (2.6)** — there are no real plans,
  no shape activation, no amount on the seeded plan.
  demo-academy's plan_id is the standard seeded plan, but the
  plan has no plan_shapes attached via plan_features.
- **Invite flow (2.7)** — partial. The "Owner" section on
  `/platform/tenants/<id>` accepts a phone number, calls
  `inviteOwnerAction`. We test it; the UI doesn't show a
  confirmation of the membership creation yet.
- **Sample-data remove (2.3)** — the Section is hidden if
  the tenant has no preset applied (which demo-academy is).
  After applying a preset via `/platform/presets/<key>`, the
  "Sample data" section appears on the tenant detail.
- **Coach schedule, coach me, coach members, owner settings,
  owner reports** — all stubs (h1 + nav only).
- **Reports (Phase 4 / Phase 5)** — `/owner/reports` is a stub.

## Quick smoke checks if something looks wrong

- Dashboard says "0 Active members": run
  `pnpm tsx scripts/seed-demo.ts` again. The seed is supposed
  to be idempotent; if it fails with "duplicate key value
  violates", the demo-academy tenant's prior data was not
  cleared. Run `pnpm db:reset` first.
- Coach sees no register link: the seed has only one batch
  (`Morning Squad`). The Morning Squad session is generated
  for today only — if the demo runs after midnight, the session
  won't show. Re-seed.
- Login fails with "verify state" or "expired": the dev code
  hint rotates on a 30-second boundary. Resend the code and use
  the new six digits.

## File map

- `scripts/seed.ts` — the canonical pretest fixture (16 generic
  members). DO NOT EDIT for the demo; the operator's data lives
  in `scripts/seed-demo.ts`.
- `scripts/seed-demo.ts` — operator-editable demo data.
- `scripts/seed-platform-user.ts` — seeds the platform operator.
- `app/(owner)/owner/...` — owner surface.
- `app/(coach)/coach/...` — coach surface.
- `app/(platform)/platform/...` — operator surface.
