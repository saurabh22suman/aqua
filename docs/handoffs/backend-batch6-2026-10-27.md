# Handoff — backend batch 6: owner booking workflow + booking price configuration

Owner lane: **BOOKING**. Branch `feat/owner-booking-workflow-b6`, base
`d692fd3`. Written 27 October 2026 by the booking-lane agent.

**Delivery status: local reviewable diff only.** No commit, no push, no PR,
no merge, no deploy, no label, no edit to `main` or `develop`. The
coordinator reviews and integrates.

---

## 1. What this batch delivers

1. **Owner-authorized booking price configuration** — a read/write service and
   server actions against the **existing** `booking_price_rules` schema, plus an
   owner screen at `/owner/settings/booking-prices`. No new table, no new
   column, no new permission, no new entitlement.
2. **An authenticated owner booking desk** at `/owner/bookings` — reusing the
   existing `BookingScreen` engine (facility → lane → date → slot → real server
   quote → member or walk-in → confirm → day board → cancel → bill).
3. **An audit of the whole booking surface** — `docs/backend/booking-gap-audit.md`
   (Exists / Partial / Missing matrix with file evidence).

Not delivered (out of this lane's authority or explicitly excluded): public or
member self-service checkout, any payment-gateway integration, any RFID/gate
endpoint, a reception rollout, a new schema, and any change to role grants or
feature entitlements.

## 1a. Hardening pass — 27 October 2026 (controlled 31 Oct soft release)

The coordinator's independent review found a **real authorization hole** in
the price-rule write path. It is **fixed**, with RED/GREEN evidence and
mutation proofs (§15). In one line: `saveBookingPriceRule` loaded the rule
being edited by `(tenant_id, id)` and then authorised only the **destination**
facility, so a location-restricted caller who learned another location's rule
id could **relocate** that rule into its own location, or **claim** a
tenant-wide rule by pointing it at its own facility. The write path now
authorises the rule **where it stands** before any mutation, using the same
policy `setBookingPriceRuleActive` already followed — one policy, two call
sites.

The same pass re-checked the delivered workflow (exclusivity, duplicate/retry,
roles, isolation, cancel/release) and pinned it with a new regression file
(§15.3). It also made the booking desk's "Manage prices" entry point
**permission-aware** (§15.4) — a small issue found during the re-check.

No new schema, no new entitlement, no public/customer booking surface, no
payment integration, no shared nav/shell/theme edit. `pool.booking` and every
other feature entitlement are unchanged.

The hardening pass added **18 new tests** (9 for the write scope, 9 for the
workflow regression), **3 new mutation proofs**, and fixed **one small issue**
(the permission-aware "Manage prices" link). It also **characterised one
known gap** in the exclusion constraint's granularity rather than papering
over it (§15.6). One **load-sensitive timeout in a protected test** was
observed and is reported as **not** caused by this batch (§15.8).

## 2. The audit (step 1 of the task)

`docs/backend/booking-gap-audit.md` — written **before** any production edit in
this batch.

Headline findings:

| Finding | Status |
|---|---|
| `facilities`, `facility_sub_units`, `bookings`, `booking_price_rules` schemas | Exists |
| Overlap guarantee (`bookings_no_overlap_excl`, btree_gist, half-open range) | Exists |
| Price resolver, honest refusal, price re-resolved at write time | Exists |
| Create / cancel / day-board / billing services and actions | Exists |
| **Price-rule administration** | **Missing — the whole dead end** |
| **Owner booking route** | **Missing** |
| **Facility closures / maintenance windows** | **Missing** (no closure table; `tenant_holidays` is session-only) |
| **Capacity enforcement** | **Missing** (`facilities.capacity` unused by the engine; no `party_size` column) |
| **Cancellation window / policy** | **Partial** (status guards only) |
| **`pool.booking` entitlement gates every sport's bookings** | **Partial** — a court/pitch/studio-only academy has `court.booking`/`pitch.booking`/`studio.booking` and *not* `pool.booking`, so its `bookings.*` grants are refused |

That last row is a **coordinator decision**: a new permission module, or a
per-tenant feature mapping, or a tenant_feature fallback. All three are
entitlement changes, so none was taken here.

## 3. Authority and the permission decision

Pricing administration rides the **existing** `settings.manage` key:

- `settings.manage` is owner/admin only — the receptionist template carries
  `settings.read` but **not** `settings.manage` (`lib/services/roles.ts:119-135`).
- `settings` is an always-on module (`lib/auth/permission.ts:42`), so no
  entitlement change was needed to express "pricing is management authority".

Therefore **no blocker**: the existing keys express this safely. The four new
entries in `lib/auth/action-permissions.ts` are the only edit to that file; no
grant, entitlement or other entry was touched.

| Action | Permission | Why |
|---|---|---|
| `listBookingPriceRulesAction` | `settings.manage` | the price catalogue is management configuration |
| `saveBookingPriceRuleAction` | `settings.manage` | writing a price |
| `setBookingPriceRuleActiveAction` | `settings.manage` | retiring/restoring a price |
| `getBookingPriceStatusAction` | `bookings.read` | the booking screen asks only "is anything priced?" and gets counts |

The booking screen's own flow reuses the **existing** booking actions
(`bookings.read` / `bookings.write` / `payments.record`) unchanged.

**Customer self-service was deliberately not built.** Every existing booking
action resolves a *staff* grant through `requireDefaultCtx` →
`resolveDefaultMembership` (`lib/auth/context.ts:84`). Reusing
`createBookingAction` as an anonymous or member-facing entry point would hand
a public caller the staff booking grant, so the owner lane built its own
owner-guarded route instead and did not repurpose the staff actions.

## 4. Changed files

New:

```
app/(owner)/owner/bookings/page.tsx
app/(owner)/owner/bookings/loading.tsx
app/(owner)/owner/settings/booking-prices/page.tsx
app/(owner)/owner/settings/booking-prices/loading.tsx
components/bookings/booking-price-manager.tsx
components/bookings/booking-price-rule-form.tsx
components/bookings/booking-price-rule-list.tsx
components/bookings/booking-price-shared.ts
lib/services/booking-price-admin.ts
lib/services/booking-price-rules.ts
lib/services/booking-price-writes.ts
lib/actions/booking-price-admin.ts
docs/backend/booking-gap-audit.md
docs/handoffs/backend-batch6-2026-10-27.md
tests/backend-b6/bookings/price-admin.test.ts
tests/backend-b6/bookings/price-admin-actions.test.ts
tests/backend-b6/bookings/owner-booking-flow.test.ts
tests/backend-b6/bookings/booking-actions-auth.test.ts
tests/backend-b6/bookings/owner-bookings-page.test.tsx
tests/backend-b6/bookings/booking-price-manager.test.tsx
tests/backend-b6/bookings/fixtures/seed-browser-fixture.ts
```

Modified (one file, additions only):

```
lib/auth/action-permissions.ts   (+10 lines: the four new action entries)
```

**Not touched** (shared / protected): `components/booking-{screen,form,day-list,bill-panel,shared}.tsx/.ts`,
`lib/services/bookings.ts`, `lib/services/booking-list.ts`,
`lib/services/booking-pricing.ts`, `lib/services/booking-billing.ts`,
`lib/actions/bookings.ts`, `lib/nav.ts`, the owner shell / layout / bottom nav,
`app/globals.css` tokens, `DESIGN.md`, `package.json`, `db/schema/**`,
`db/migrations/**`, `app/(reception)/**`, `tests/tier1/**`, `tests/mobile/**`.

`git diff lib/auth/action-permissions.ts` is the only diff against an existing
tracked file, and it contains only the four new entries.

## 5. RED → GREEN → REFACTOR evidence

### 5.1 Price administration service — strict RED

The service did not exist. To make the RED an **assertion failure** rather
than a module-not-found import error (which `docs/engineering-standard.md`
says is not a RED), the module was first created as a **shape-only stub**: it
accepted any input, persisted nothing and listed nothing — the honest
"the feature does not exist yet" answer. The stub was replaced by the real
implementation in the GREEN step.

```
$ python3 .opencode/scripts/harness.py test tests/backend-b6/bookings/price-admin.test.ts
```

Result: **12 failed / 12** — every failure an `AssertionError`, no import
error, no reference error:

```
AssertionError: expected true to be false            (×5 — the refusals)
AssertionError: expected { ok: false, … } to match object { ok: true, pricePaise: 40000 }
AssertionError: expected { ok: false, … } to match object { ok: true, pricePaise: 60000 }
AssertionError: expected undefined to be '12345'
AssertionError: expected [] to have a length of 1 but got +0
AssertionError: expected [] to have a length of 2 but got +0
AssertionError: expected +0 to be 1
AssertionError: expected [] to deeply equal [ 'Mine' ]
```

### 5.2 GREEN

```
$ python3 .opencode/scripts/harness.py test tests/backend-b6/bookings/
 Test Files  6 passed (6)
      Tests  42 passed (42)
```

### 5.3 Action-layer RED

The action-layer test was authored with the action (the behaviour lives in the
service, whose RED is above); its GREEN is captured and the action layer's
**structure** is additionally pinned by the protected
`tests/tier1/server-action-preamble.test.ts` (parse → permission → service, and
the `ACTION_PERMISSION_MAP` key must match the literal). To prove the
authorisation assertions actually detect a missing gate, the gate was removed
and the test re-run — see §6.

**A regression the protected suite caught.** After the price moved to the
action boundary as typed rupees, `saveBookingPriceRuleAction` called
`rupeesToPaise` *between* the parse and the permission check. The protected
preamble test refused it ("parsed input but the next statement isn't a
permission check"), because the standing rule is parse → permission → any
other work. Fixed by moving the conversion **after** the permission check, so
an unauthorised caller gets the refusal rather than a conversion; the order is
now parse → permission → service. Re-run: green.

### 5.4 REFACTOR

- The price parsing was moved to the boundary: the **service** stores integer
  paise; the **action** takes the rupees the owner typed and converts them
  server-side with exact integer arithmetic (`rupeesToPaise`). The client
  never computes money. One shared field shape (`priceRuleFieldShape`) keeps
  the two schemas from drifting.
- The price administration was split along its own responsibility boundaries
  so no product file approaches the 300-line rule: the **pure contract**
  (`lib/services/booking-price-rules.ts` — schema, paise conversion, time
  normalisation, row mapping, 128 lines), the **read side**
  (`lib/services/booking-price-admin.ts` — the catalogue and the booking
  screen's counts, 111 lines), the **write side**
  (`lib/services/booking-price-writes.ts` — create, change, retire, 283
  lines). `booking-price-admin.ts` re-exports the other two, so callers keep
  one import. `pnpm check:lines` reports **no new offender** from this
  batch.
- The rule-shape, day-label, paise→rupees and window-summary helpers moved
  into `components/bookings/booking-price-shared.ts`; the price editor was
  split into manager (44) / form (282) / list (127) so no component file
  approaches the rule.
- `getBookingPriceStatus` was corrected to join the facility's location so the
  count honours the same location intersection as the catalogue.
- The price editor's list was corrected to re-read the server catalogue after a
  mutation (see the browser finding in §8).

`pnpm typecheck` and `pnpm lint` are clean after the refactor.

## 6. Security negatives and mutation proofs

Each mutation was applied to the working tree, the focused test re-run, and
the file restored. Every mutation flips the test red — the tests detect the
failure they claim to cover.

| # | Mutation | Test | Observed |
|---|---|---|---|
| 1 | drop `if (!hasFeature(ctx, "pool.booking")) notFound()` from `/owner/bookings` | `owner-bookings-page.test.tsx` | **FAIL** — "promise resolved … instead of rejecting" |
| 2 | drop `requirePagePermission(ctx, "bookings.read")` | `owner-bookings-page.test.tsx` | **FAIL** — "promise resolved … instead of rejecting" |
| 3 | swallow a failed facility read (`catch { facilities = [] }`) | `owner-bookings-page.test.tsx` | **FAIL** — "reports a failed read instead of an empty board" |
| 4 | drop `requirePermission(ctx, "settings.manage")` from `saveBookingPriceRuleAction` | `price-admin-actions.test.ts` | **FAIL** — "promise resolved { ok: true, rule: … } instead of rejecting" |
| 5 | drop the location intersection on a price-rule write | `price-admin.test.ts` | **FAIL** — "expected true to be false" |
| 6 | drop `router.refresh()` after activating/deactivating a price | `booking-price-manager.test.tsx` | **FAIL** — "expected vi.fn() to be called at least once" |

Standing negatives (asserted, not assumed):

- A **receptionist** (`settings.read`, `bookings.read`, `bookings.write` — no
  `settings.manage`) is refused by `listBookingPriceRulesAction`,
  `saveBookingPriceRuleAction` and `setBookingPriceRuleActiveAction`
  (`price-admin-actions.test.ts`).
- A **role without `bookings.write`** is refused by create and cancel; a role
  without `bookings.read` is refused by list and quote
  (`booking-actions-auth.test.ts`).
- **`pool.booking` switched off** → every booking action refuses with
  `feature_disabled`, and `/owner/bookings` 404s
  (`booking-actions-auth.test.ts`, `owner-bookings-page.test.tsx`).
- **Another tenant**: its rules are neither listed nor editable, and its
  facilities are not bookable (`price-admin.test.ts`, `owner-booking-flow.test.ts`).
- **Another site**: a location-scoped caller can neither price nor book a
  facility outside its locations (`price-admin.test.ts`,
  `owner-booking-flow.test.ts`).
- **Invalid input** is refused before the permission check runs, so a
  malformed request never reaches a service
  (`price-admin-actions.test.ts`, `booking-actions-auth.test.ts`).
- **Audit atomicity**: `booking_price_rule.create` / `.update` rows are written
  in the **same transaction** as the rule (`price-admin.test.ts`).

Money: the price is `bigint` paise end to end — the stored value is read back
as `"12345"`, never a float; the action converts the typed rupees with
`BigInt`; the booking snapshots the resolved price; the invoice total equals
the booking price to the paisa.

## 7. Test inventory (all green)

```
tests/backend-b6/bookings/price-admin.test.ts            12
tests/backend-b6/bookings/price-admin-actions.test.ts      6
tests/backend-b6/bookings/price-admin-scope.test.ts         9   (hardening)
tests/backend-b6/bookings/owner-booking-flow.test.ts       8
tests/backend-b6/bookings/booking-reliability.test.ts      9   (hardening)
tests/backend-b6/bookings/booking-actions-auth.test.ts     5
tests/backend-b6/bookings/owner-bookings-page.test.tsx     8
tests/backend-b6/bookings/booking-price-manager.test.tsx   4
                                                    total 61
```

Protected suites re-run unchanged (no protected assertion was edited):

```
tests/tier1/server-action-preamble.test.ts   passed   (the action scanner:
tests/action-permission-scan.test.ts         passed    parse → permission →
tests/page-guard-scan.test.ts               passed    service, and the
tests/tier1/bookings-pricing.test.ts         passed    ACTION_PERMISSION_MAP
tests/tier1/bookings-overlap.test.ts         passed    key must match the
tests/tier1/bookings-staff-flow.test.ts      passed    literal)
tests/tier1/reception-bookings-hidden.test.ts passed
tests/db/bookings-advance-window-clock.test.ts passed
tests/tier1/utilisation.test.ts              passed
tests/tier1/role-gating-matrix.test.ts       passed
tests/tier1/roles-permissions.test.ts        passed
tests/tier1/loading-files.test.ts            passed
```

Final focused run: **18 files, 568 tests, 0 failed** (the six b6 files plus
the twelve protected files above); after the last change (the persistent
"Manage prices" entry point) the b6 files alone are **42 tests, 0 failed**.

`pnpm typecheck` — clean. `pnpm lint` — clean. `pnpm check:lines` — **no new
offender** from this batch (the 33 files over the hard limit are all
pre-existing and untouched).

## 8. Browser evidence

Dev server: `pnpm dev --port 3134` against the harness's **disposable** test
database (127.0.0.1:55464, `aqua_test_faad52f370`), started from this worktree
with its own `.next`. Fixture: `tests/backend-b6/bookings/fixtures/seed-browser-fixture.ts`
(a disposable academy: one location, one pool, one priced rule, one member, an
owner login). Login `+91 90000 00601` / PIN `123456`.

**Build mode: `next dev`, not a production build.** The R1 production build
was not run in this batch (the release gate is the coordinator's, under the
shared build lock). The artifact under test is therefore the dev artifact; a
production-build comparison is listed as an open item in §12.

Screenshots (`docs/handoffs/evidence/`):

| File | Viewport | What it shows |
|---|---|---|
| `b6-owner-bookings-390x844.png` | 390×844 | the desk: facility, lane, date, slot, member/walk-in, **Price ₹400.00** (a real server quote), empty day board |
| `b6-owner-bookings-390x844-scrolled.png` | 390×844 | scrolled to the bottom — day board card fully clear of the fixed bottom nav |
| `b6-owner-bookings-390x844-created.png` | 390×844 | the booking created: "Booked at ₹400.00", the day-board row "09:00 am–10:00 am · Aarav Sharma · Confirmed · ₹400.00" with **Request bill** and **Cancel** |
| `b6-owner-bookings-390x844-conflict.png` | 390×844 | the second attempt on the same slot: **"That slot is taken. Pick another time."**, and the walk-in note "A walk-in is recorded but not payable in R1 — billing needs a member." |
| `b6-owner-bookings-390x844-no-price.png` | 390×844 | the no-price state: "No price is configured for any slot yet, so every booking will be refused. **Set the prices** first." + the quote's "No price is configured for this slot." + a disabled **Create booking** |
| `b6-owner-bookings-1280x900.png` | 1280×900 | the desktop owner shell (sidebar + top bar) with the desk |
| `b6-owner-booking-prices-1280x900.png` | 1280×900 | the price editor with the configured rules, the deactivate control and the server's refusal of an inverted window |
| `b6-owner-booking-prices-1280x900-top.png` | 1280×900 | the top of the price editor |

Measured geometry (390×844): `scrollWidth 390 == clientWidth 390` — **no
horizontal overflow**; document scrollHeight 1149 > 844, so the page scrolls;
the fixed bottom nav occupies y 780–844 and the last day-board card ends
above it.

Console: **0 errors** on both routes.

Controls exercised in the browser (not just rendered): facility select, lane
select, date, time slot, member/walk-in toggle, member search + selection,
**Create booking**, **Cancel**, price name / facility / price / day chips /
from / to / priority / active, **Save price**, **Edit**, **Deactivate** /
**Activate**, the "Set the prices" link (in the no-price state) and the
persistent **Manage prices** link (always present, verified to point at
`/owner/settings/booking-prices`).

**Re-verified after the hardening pass (§15)**, on the same disposable
environment and the same dev server (port 3134): the booking desk renders
with the **Manage prices** link → `/owner/settings/booking-prices` and a live
quote ("Price ₹400.00"); the price editor saves a rule ("Price saved.", the
form cleared, the new row in the list) and the **Deactivate** toggle still
flips the row to "Inactive" after the refactor. Console: **0 errors**.

### Defect the browser found (fixed, and now pinned)

The **Deactivate** button wrote the change to the server but never re-read the
catalogue, so the row kept saying "Active" until a full page reload. Found in
the 1280×900 walkthrough, fixed in
`components/bookings/booking-price-rule-list.tsx` (`router.refresh()` after a
successful toggle), and pinned by mutation #6 plus
`booking-price-manager.test.tsx`.

## 9. Functional flow that now works

`no price configured` → the quote refuses honestly → **Set the prices** →
a rule is saved → the quote resolves the configured price → the booking is
taken at that price → it appears on the day board → it can be billed
(`Request bill`, one invoice, source `other`, total = the quoted price) →
**Cancel** → the slot is released and the same slot can be booked again.

Concurrency: two simultaneous requests for the same slot → **exactly one**
succeeds (the database's EXCLUDE constraint decides; there is no conflict
pre-read). Back-to-back slots both succeed (the range is half-open). A
cancelled booking releases its slot.

## 10. Known failures, risks and open items

1. **Production build not run.** The browser evidence is the **dev** artifact.
   The coordinator's release gate must cover the production build, the 150 KB
   first-load JS budget for the two new routes, and the font budget.
2. **`pool.booking` gates every sport.** A badminton / football / dance academy
   has `court.booking` / `pitch.booking` / `studio.booking` and not
   `pool.booking`, so its `bookings.*` grants are refused and `/owner/bookings`
   404s for it. **Coordinator decision needed** — this is an entitlement
   change and was deliberately not taken here.
3. **Facility closures are not modelled.** A booking on a closure day is still
   accepted; `tenant_holidays` is session-only and the booking resolver does
   not consult it.
4. **Capacity is not enforced.** The exclusion constraint is per
   facility/sub-unit; `facilities.capacity` is not used by the engine and
   `party_size` does not exist.
5. **Cancellation policy** is the existing status guards only — no
   cancellation window.
6. **Business hours are not consulted by the resolver.** The slot grid is the
   fixed 06:00–21:00 list in `components/booking-shared.ts`; the tenant's
   `operations.business_hours` is not applied to bookings. Recorded in the
   audit as Partial.
7. **Native time inputs render in the browser's locale** ("09:00 PM" in the
   en-US test browser). The stored value is always `HH:MM` and the round trip
   is locale-independent, but the displayed format is the browser's, not
   Aqua's. DESIGN.md §"Redesign contract" already flags that setting `lang`
   does not control native date/time formatting.
8. **The price editor's content column is `max-w-2xl`**, so it sits left of
   centre on a wide desktop with empty space to the right. This matches the
   sibling settings pages (`/owner/settings/activities`,
   `/owner/settings/payment-qrs`), so it is the product's current settings
   composition, not something this batch introduced.
9. **No navigation entry.** `/owner/bookings` and
   `/owner/settings/booking-prices` are reachable by URL only — see §11.
10. **Visual acceptance is separate from this functional evidence.** The
    screenshots above prove rendering and control behaviour, not the human's
    design approval. The latest human direction (Lavender Club) is still under
    review, so **no visual redesign was attempted**: this batch reuses the
    existing primitives, tokens and components.

## 11. Request to the coordinator (shared / protected files)

1. **Navigation entry** — `lib/nav.ts` is coordinator-owned. Two entries are
   needed:
   - sidebar (Operations group): `{ href: "/owner/bookings", label: "Bookings", iconName: "calendar-check" }`
   - and the gate `"/owner/bookings": "bookings.read"` in
     `OWNER_NAV_PERMISSION_GATES`, so a permission-limited role (the
     Accountant) does not see a destination whose page refuses it.
   The price screen needs no nav entry — it sits under **Settings →
   Facilities & activities**; adding a link from `/owner/settings/activities`
   to `/owner/settings/booking-prices` would be a natural place, but
   `app/(owner)/owner/settings/activities/page.tsx` is not this lane's file.
2. **`tests/tier1/loading-files.test.ts`** lists the routes with a pinned
   `loading.tsx`. The two new routes have their own `loading.tsx` (both use
   `@/components/skeleton` with ≥4 `<Skeleton w=` usages, the shape the test
   enforces); adding them to that protected list needs human authorisation.
3. **The `pool.booking` entitlement** for non-swimming sports (§10.2).
4. **Reception rollout** stays out of this batch: `app/(reception)/reception/bookings/page.tsx`
   still 404s and its protected pin
   (`tests/tier1/reception-bookings-hidden.test.ts`) is untouched. The owner
   route can be reviewed and exercised in the meantime.

## 12. Remaining customer scope (not built)

Public/anonymous booking, member self-service booking, payment-gateway
checkout, RFID/gate check-in, cancellation policy, capacity limits, recurring
and block bookings, equipment and locker allocation. The audit lists the
schema, entitlement and policy work each would need; none of it was started.

## 13. Resources and reproduction

Owned resources:

| Resource | Value |
|---|---|
| Disposable test DB | 127.0.0.1:55464, database `aqua_test_faad52f370` (harness container, tmpfs) |
| Harness profile | `.env.aqua-harness-test.local` (mode 0600, git-ignored) |
| Dev server | port **3134**, `next dev`, this worktree's own `.next`; log `/tmp/opencode/b6-logs/dev-3134.log` |
| Browser fixture | `tests/backend-b6/bookings/fixtures/seed-browser-fixture.ts` |
| Screenshots | `docs/handoffs/evidence/` |
| Build | **not run** (release gate is the coordinator's, under `/home/soloengine/.local/state/aqua-harness/design-build.lock`) |

The dev server was started by this lane and stopped at the end of the batch;
no other process was touched.

Reproduce:

```bash
cd /home/soloengine/thedutchrabbit/aqua-worktrees/backend-booking-workflow
python3 .opencode/scripts/harness.py --port 55464 prepare-test
python3 .opencode/scripts/harness.py test tests/backend-b6/bookings/
pnpm typecheck && pnpm lint

# browser evidence
set -a; source .env.aqua-harness-test.local; set +a
export BETTER_AUTH_URL=http://localhost:3134
pnpm exec tsx tests/backend-b6/bookings/fixtures/seed-browser-fixture.ts
pnpm dev --port 3134
# sign in with the phone/PIN the fixture prints
```

## 14. Files changed (final, reviewable diff)

```
 M lib/auth/action-permissions.ts
?? app/(owner)/owner/bookings/
?? app/(owner)/owner/settings/booking-prices/
?? components/bookings/
?? docs/backend/
?? docs/handoffs/
?? lib/actions/booking-price-admin.ts
?? lib/services/booking-price-admin.ts
?? lib/services/booking-price-rules.ts
?? lib/services/booking-price-scope.ts
?? lib/services/booking-price-writes.ts
?? tests/backend-b6/
```

After the hardening pass (§15) the same tree carries two more test files
(`tests/backend-b6/bookings/price-admin-scope.test.ts`,
`tests/backend-b6/bookings/booking-reliability.test.ts`) and three more
production files (`lib/services/booking-price-scope.ts`,
`lib/services/booking-price-writes.ts`,
`app/(owner)/owner/bookings/page.tsx`). Final focused run: **20 files, 588
tests, 0 failed** (8 b6 files + 12 protected files); `pnpm typecheck` and
`pnpm lint` clean; `pnpm check:lines` reports no new offender.

Nothing is committed. The coordinator reviews this working tree, integrates,
and owns the release gate and the human's promotion to `main`.

---

## 15. Hardening pass — the coordinator's authorization finding

### 15.1 The finding, verified

The coordinator wrote: *"`saveBookingPriceRule` scopes only destination
facility after reassignment. Existing rule loaded tenant+id but original
facility/tenantwide visibility not authorized."*

**Verified — the finding was correct.** In `saveBookingPriceRule`
(`lib/services/booking-price-writes.ts`, before the fix):

```ts
// the rule being edited — loaded, but NOT authorised
const [row] = await tx.select().from(bookingPriceRules)
  .where(and(eq(bookingPriceRules.id, input.id),
              eq(bookingPriceRules.tenantId, ctx.tenantId)))
  .for("update");
existing = row;                                  // ← no visibility check

// only the DESTINATION was checked
const effectiveFacilityId = input.facilityId === undefined
  ? (existing?.facilityId ?? null) : input.facilityId;
if (effectiveFacilityId) {
  const facility = await facilityFor(tx, ctx.tenantId, effectiveFacilityId);
  if (!locationVisible(access, facility.locationId)) {
    return { ok: false, error: "Facility not found." };   // ← destination only
  }
}
// …the update then writes facilityId: effectiveFacilityId
```

Loading a row by id is not authorisation: the id may have come from anywhere.
A location-restricted caller (one whose membership carries an explicit
location list, with `access.location_scoped_staff` on) could therefore:

1. **Relocate** another location's rule into its own location — the
   destination passed the check, the original facility was never
   authorised — and then edit it freely.
2. **Claim** a tenant-wide rule (`facility_id IS NULL`, which prices every
   location) by pointing it at its own facility, silently taking the
   tenant-wide price out of the catalogue.

`setBookingPriceRuleActive` did **not** have this hole: it checked the rule
it was toggling where it stood, and refused a tenant-wide rule for a
restricted caller.

### 15.2 The fix

The write path now authorises the rule **where it stands**, before the
destination is computed and before any write, using the policy the toggle
path already followed. One helper, one policy, two call sites:

```ts
// lib/services/booking-price-writes.ts
async function authoriseRuleAccess(tx, ctx, access, rule): Promise<string | null> {
  if (rule.facilityId) {
    const facility = await facilityFor(tx, ctx.tenantId, rule.facilityId);
    if (!facility || !locationVisible(access, facility.locationId)) {
      return "Price rule not found.";
    }
    return null;
  }
  if (!access.unrestricted) return "Price rule not found.";   // tenant-wide
  return null;
}
```

- `saveBookingPriceRule` calls it right after loading `existing`; the
  **destination** check is unchanged and still runs.
- `setBookingPriceRuleActive` now calls the same helper instead of its own
  inline copy, so the two write paths cannot drift again.

The refusal message is deliberately `"Price rule not found."` — a caller who
may not reach a rule learns nothing about whether it exists (the same
non-disclosure the toggle path already used). **Tenant-wide authority is
narrowed, not expanded**: a restricted caller can now neither create nor
edit a tenant-wide rule, where before it could effectively take one over.

A rejection writes **nothing**: the refusal returns before the update and
before `writeAudit`, and the audit row lives in the same transaction as the
change.

### 15.3 RED → GREEN → REFACTOR evidence

**RED** — new file `tests/backend-b6/bookings/price-admin-scope.test.ts` (9
tests). The two security assertions failed against the delivered code:

```
$ python3 .opencode/scripts/harness.py test tests/backend-b6/bookings/price-admin-scope.test.ts

 FAIL … > refuses to relocate another location's rule into the caller's own location
AssertionError: expected true to be false // Object.is equality
 FAIL … > refuses to claim a tenant-wide rule
AssertionError: expected true to be false // Object.is equality
 Tests  3 failed | 6 passed (9)
```

That is the hole, proved: `expected true to be false` is the *restricted
caller's write succeeding*.

**GREEN**

```
$ python3 .opencode/scripts/harness.py test tests/backend-b6/bookings/price-admin-scope.test.ts
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

**REFACTOR** — the duplicated visibility block in `setBookingPriceRuleActive`
was replaced by the shared policy, so the save path and the toggle path now
state the same rule once. The policy then moved into its own module
(`lib/services/booking-price-scope.ts`: `facilityFor` +
`authoriseRuleAccess`), so the write-scope rule has a name and a home, and
`lib/services/booking-price-writes.ts` holds only the two mutations
(270 lines — every price module is now under the 300-line rule; `pnpm
check:lines` reports no new offender). `pnpm typecheck` and `pnpm lint` clean.

**Mutation proofs** (each applied, the focused test re-run, the file
restored):

| # | Mutation | Observed |
|---|---|---|
| 7 | drop the `authoriseRuleAccess` call from `saveBookingPriceRule` | **FAIL ×2** — "expected true to be false" on the relocation and the tenant-wide claim |
| 8 | audit the *rejected* write (write an audit row before returning the refusal) | **FAIL ×2** — "expected 2 to be 1": the "no audit mutation on rejection" assertion is independently detected |
| 9 | weaken `authoriseRuleAccess` to skip the facility check | **FAIL ×2** — the relocation test **and** "refuses to deactivate another location's rule": the save path and the toggle path now genuinely share one policy |

Mutations 7 and 9 were re-run **after** the refactor below and still flip the
tests red.

### 15.4 Regression re-check of the delivered workflow

New file `tests/backend-b6/bookings/booking-reliability.test.ts` (9 tests).
It pins what the workflow already guarantees, so a later change cannot
quietly weaken it. Everything below was re-verified against the current
code; **no behaviour was found to be broken**.

| Property | Result |
|---|---|
| **Exclusive slot** — two concurrent requests for one slot | exactly one wins; the loser writes **no booking row and no audit row**; the refusal is `SLOT_TAKEN_ERROR` |
| Same lane, same time | refused (`SLOT_TAKEN_ERROR`) |
| Two different lanes, same time | both accepted (the constraint is per sub-unit) |
| Adjacent / back-to-back slots | both accepted (half-open range) |
| **Duplicate / retry** — the same create sent twice | refused; **one** booking row, **one** `booking.create` audit row — the retry changed nothing |
| **Duplicate / retry** — "request bill" sent twice | the **same** invoice (`alreadyBilled: true`); **one** invoice row |
| **Roles** — a role without `bookings.write` / `bookings.read` | refused by create/cancel and by list/quote (`booking-actions-auth.test.ts`) |
| **Roles** — a receptionist without `settings.manage` | refused by every price-administration action (`price-admin-actions.test.ts`) |
| **Cross tenant** — another tenant's facility / rule / booking | refused; the other tenant's rows and the audit trail are untouched |
| **Cross location** — a restricted caller's other site | cannot price, book, or cancel there; the record keeps its status and no audit row is written |
| **Cancel / release** | the slot is free again; the cancelled row **stays on the day board as history**; a second cancel is refused ("already cancelled") and writes **no second audit row**; a completed booking cannot be cancelled |

**One known gap was characterised, not fixed** (see §15.6).

### 15.5 Small issue found and fixed: the "Manage prices" entry point

The booking desk's "Manage prices" link was **unconditional**, so a caller
who may read bookings but not manage prices was offered a route to a page
that 404s for them. The link is now **permission-aware**
(`hasPermission(ctx, "settings.manage")`), and the no-price notice states
the fact either way — only the route to it is withheld from a caller who may
not take it.

RED (page test, a caller with `bookings.read` but not `settings.manage`):

```
AssertionError: expected <a …(3)></a> to be null
```

GREEN: `owner-bookings-page.test.tsx` 8/8.

### 15.6 Remaining policy decisions (for the coordinator)

1. **The exclusion constraint's granularity (KNOWN GAP, characterised).**
   `bookings_no_overlap_excl` keys on
   `coalesce(sub_unit_id, '00000000-…-000000000000')`, so a booking of the
   **whole facility** and a booking of **lane A** are *different* keys and
   both are accepted for the same wall-clock slot. The day board shows both
   rows, so an owner can see the overlap — but the database does not prevent
   it. This is the constraint's granularity, i.e. a **schema decision**: the
   migration is protected, this batch adds no schema, and the insert
   exclusion stays the sole authority on concurrency (a pre-check would
   reintroduce exactly the check-then-insert race the constraint exists to
   remove). The behaviour is pinned by an explicitly-labelled
   characterisation test in `booking-reliability.test.ts` so it cannot change
   silently. **Decision needed:** whether "whole facility" should conflict
   with every sub-unit of that facility, and if so how (a new constraint, a
   convention, or a product rule that a facility with sub-units is never
   booked as a whole).
2. **The duplicate-retry message.** A retried create is refused with
   *"That slot is taken. Pick another time."* — safe (no second booking) but
   misleading when the first attempt actually succeeded. The message is
   pinned verbatim by the protected `tests/tier1/bookings-overlap.test.ts`
   (`expect(failure.error).toBe(bookings.SLOT_TAKEN_ERROR)`), so it was
   **not** changed here. **Decision needed:** a separate "you already have a
   booking for that slot" wording, or an idempotency key.
3. **`pool.booking` still gates every sport** — unchanged by this pass, still
   an entitlement decision (§10.2). No non-swimming sport was silently
   unlocked.
4. **The price editor's facility picker lists every facility** in the tenant
   (it reads the settings facility catalogue), while the save path refuses a
   facility outside the caller's locations. For an owner/admin — who reach
   every location — the two agree. For a hypothetical location-restricted
   manager, the picker would offer a facility the save then refuses with
   "Facility not found." Not a security hole (the refusal is enforced
   server-side and the failure is honest), but the picker should eventually
   read the same location-scoped source. Left alone here because the
   location-scoped read (`listBookableFacilitiesAction`) is gated on
   `bookings.read`, which would couple the price screen to the
   `pool.booking` feature, and `lib/actions/activities.ts` is not this lane's
   file.
5. **Facility closures, capacity and a cancellation window** remain
   unimplemented (§10.3–§10.5) — unchanged by this pass.

### 15.7 Hardening-pass file changes

New:

```
tests/backend-b6/bookings/price-admin-scope.test.ts      9
tests/backend-b6/bookings/booking-reliability.test.ts     9
```

Modified:

```
lib/services/booking-price-writes.ts   (authorise the rule being written;
                                         one shared policy for both write paths)
app/(owner)/owner/bookings/page.tsx     (permission-aware "Manage prices")
```

New (the write-scope policy got its own module during the refactor):

```
lib/services/booking-price-scope.ts    (facilityFor + authoriseRuleAccess)
```

Nothing else changed. No new schema, no migration, no entitlement change, no
permission-map change, no shared nav/shell/theme edit, no protected test
edit. `git diff` against the pre-hardening tree is confined to those two
production files.

### 15.8 One load-sensitive timeout in a protected test (NOT caused by this batch)

During the combined run, `tests/tier1/bookings-staff-flow.test.ts` failed
once with **`Error: Test timed out in 5000ms`** on its pure-arithmetic case
("splits every realistic price into base + tax exactly, at every configured
rate" — a ~99,500-iteration loop with no database access).

Evidence that it is **not** this batch's doing:

1. The file **passes on its own** (5/5) and passes in the combined run at a
   normal machine load.
2. The failing run was at **load average 17.5**; the passing runs were at
   10–12. Other sessions were running dev servers, a demo seed and builds
   at that moment.
3. `git diff d692fd3 -- lib/money/ lib/services/booking-billing.ts
   lib/services/bookings.ts lib/services/booking-pricing.ts` is **empty** —
   every file that test exercises is byte-identical to the base commit. The
   whole tracked-file diff of this batch is still 10 added lines in
   `lib/auth/action-permissions.ts`.

The protected test was **not** edited and its timeout was **not** raised.
Flagging it because the coordinator's integration run may hit the same
flake on a busy machine: the case is CPU-bound with a 5s budget and no
database work, so it is sensitive to machine load rather than to code.
