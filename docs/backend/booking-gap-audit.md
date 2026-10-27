# Booking gap audit — facilities, resources, prices, closures, access

Batch 6 (owner booking lane), 27 October 2026. Branch
`feat/owner-booking-workflow-b6`, base `d692fd3`.

Scope of this audit: what the booking engine already contains, what is
partial, and what is missing, with file evidence. It is written **before**
any production edit in this batch, so the RED evidence in
`docs/handoffs/backend-batch6-2026-10-27.md` refers back to it.

Verdict key: **Exists** (present and wired), **Partial** (present but
incomplete for an authenticated owner flow), **Missing** (absent).

---

## 1. Data model

| Capability | Verdict | Evidence |
|---|---|---|
| Venue / facility catalogue | **Exists** | `db/schema/preset-engine.ts:123` `facilities` (tenant, location, name, kind, capacity, soft delete). Tenant FK `(id, tenant_id)`, RLS + `app_user` grants. |
| Resource / sub-unit (lane, court) | **Exists** | `db/schema/preset-engine.ts:169` `facility_sub_units` (tenant, facility, name, soft delete). Unique live name per facility. |
| Booking row | **Exists** | `db/schema/bookings.ts:37` `bookings` — `location_id`, `facility_id`, `sub_unit_id`, `member_id` XOR `walk_in_name`, `starts_at`/`ends_at` timestamptz, `status`, `price_paise bigint`, `invoice_id`. Checks: time order, status enum, `price_paise >= 0`, member XOR walk-in. |
| Double-booking guarantee | **Exists** | `db/migrations/20260918140000_v02_bookings.sql` — `bookings_no_overlap_excl` EXCLUDE using gist (tenant, facility, `coalesce(sub_unit_id, nil-uuid)`, `tstzrange(starts_at, ends_at, '[)')`) WHERE status in ('held','confirmed'). Half-open range ⇒ back-to-back slots do not conflict; cancelled/completed rows release the slot. |
| Price-rule catalogue | **Exists** | `db/schema/bookings.ts:115` `booking_price_rules` — `facility_id` (NULL = all facilities), `label`, `days_of_week int[]` (0 = Sunday, empty = every day), `start_time`/`end_time` (NULL = all day), `price_paise bigint`, `priority`, `is_active`. DB checks in `db/migrations/20260918141000_v03_booking_pricing.sql`: label 1..80 chars, `price_paise >= 0`, `days_of_week <@ array[0..6]`, window both-or-neither with `end_time > start_time`. |
| Advance-booking window | **Exists** | `bookings.advance_window_days` config key (default 30) — `db/migrations/20260918141000_v03_booking_pricing.sql`, resolved tenant/location-scoped by `lib/services/booking-pricing.ts:180` `checkAdvanceWindowInTx`. |
| Facility closure / maintenance window | **Missing** | No closure table for facilities exists. `db/migrations/20260904100000_tenant_holidays.sql` defines `tenant_holidays`, but it is consumed only by the session generator (`lib/services/holidays.ts`), never by the booking resolver. `lib/services/booking-pricing.ts` has no holiday/closure branch, and `lib/services/bookings.ts` does not check one. |
| Capacity enforcement (N people per slot) | **Missing** | `facilities.capacity` exists but the exclusion constraint is per facility/sub-unit, not per capacity. `bookings.party_size` exists in the architecture sketch (`docs/architecture.md:1046`) but **not** in the shipped table. |
| Cancellation policy / window | **Partial** | `cancelBooking` refuses `completed` and already-`cancelled` rows (`lib/services/bookings.ts:256-261`). There is **no** cancellation-window policy: `bookings.cancellation_window_hours` exists only as an example in `docs/architecture.md:449`, never as a config key or a rule. |
| Recurring / block bookings | **Missing** | Out of R1 scope (`docs/project-scope.md:321` — P4). |
| Equipment / locker allocation | **Missing** | Out of scope (`docs/project-scope.md:322` — L). |

## 2. Price resolution

| Capability | Verdict | Evidence |
|---|---|---|
| Price resolver | **Exists** | `lib/services/booking-pricing.ts:139` `resolveBookingPriceInTx` — tenant + facility match (`facility_id` NULL = catch-all), `days_of_week` match, `[start_time, end_time)` window match, winner by `compareRules` (`:116`): priority → facility-specific → narrowest window → narrower day set → id. |
| Honest refusal when nothing matches | **Exists** | `lib/services/booking-pricing.ts:166` returns `"No price is configured for this slot."` — never a silent zero. |
| Quote entry point | **Exists** | `lib/services/booking-pricing.ts:210` `quoteBookingCore` — facility visibility + price + advance window in one `withTenant()` read. Re-exported as `quoteBooking` (`lib/services/bookings.ts:293`). |
| Price is re-resolved at write time | **Exists** | `lib/services/bookings.ts:156` re-resolves inside the insert's own transaction, so a stale quote can never become a row. The quote is display only. |
| **Price-rule administration (read/write)** | **Missing** | No service, no action, no UI writes `booking_price_rules` anywhere in the tree. `booking_price_rules` is written **only** by seed/insert fixtures in tests (`tests/tier1/bookings-staff-flow.test.ts:88`). This is the dead end `app/(reception)/reception/bookings/page.tsx` was hidden for. |
| Timezone / operating-hours reuse | **Partial** | The resolver reads the tenant timezone (`lib/services/booking-pricing.ts:130`) and matches wall-clock windows. Business hours exist for *locations* (`lib/actions/locations.ts` → `getBusinessHoursAction`/`setBusinessHoursAction`, permission `settings.read`/`settings.manage`) but the booking resolver never consults them — the slot grid is the fixed 06:00–21:00 list in `components/booking-shared.ts`. |

## 3. Access grants and entitlements

| Capability | Verdict | Evidence |
|---|---|---|
| Permission keys | **Exists** | `db/seed-platform.ts:346-347` — `bookings.read`, `bookings.write`, both with module `pool.booking`. |
| Role grants | **Exists** | `lib/services/roles.ts:128-129` — the receptionist template carries `bookings.read` + `bookings.write`. Owner/Admin carry every permission except `attendance.mark` (`lib/services/roles.ts:17-22`). |
| Feature entitlement | **Partial** | `bookings.*` resolves against the **`pool.booking`** feature (`db/seed-platform.ts:346-347`), so `requirePermission(ctx, "bookings.read")` refuses when `pool.booking` is off (`lib/auth/permission.ts:87`). The `pool.booking` feature is GA and present in the standard plan, the swimming preset and the multi-sport preset (`db/seed-platform.ts:248`, `db/preset-definitions.ts:207`), but the **badminton / football / dance presets** carry `court.booking` / `pitch.booking` / `studio.booking` instead (`db/migrations/20260918000000_reference_catalogue.sql:113-116`). A court-only academy therefore cannot use the booking actions at all. This is the "bookings grant maps to pool.booking even for generic bookable activities" finding in `docs/audits/2026-10-09-role-content-permission-audit.md:234`. |
| Management authority for prices | **Exists (unused)** | `settings.manage` is owner/admin only — the receptionist template has `settings.read` but not `settings.manage` (`lib/services/roles.ts:119-135`). This is the existing key that can express "pricing administration is management authority"; it needs no new permission and no new entitlement. |
| Location scoping | **Exists** | `lib/services/location-access.ts` — `resolveLocationAccess`, `locationVisible`, `locationPredicate`; the staff-location scoping key is `access.location_scoped_staff` (default OFF). |

## 4. Service and action surfaces

| Capability | Verdict | Evidence |
|---|---|---|
| Create booking | **Exists** | `lib/services/bookings.ts:91` `createBooking` — zod input, facility/sub-unit/member existence checks inside the tenant transaction, price re-resolution, advance window, insert without a conflict pre-read, audit row in the same transaction. `23P01` maps to `SLOT_TAKEN_ERROR`. |
| Cancel booking | **Exists** | `lib/services/bookings.ts:235` `cancelBooking` — `FOR UPDATE` row lock, status guards, audit row in the same transaction. |
| Day board read | **Exists** | `lib/services/booking-list.ts:66` `listBookingsForDay` — date range in the tenant timezone, optional facility/location filter, location predicate, invoice join for amount due. |
| Bookable facility read | **Exists** | `lib/services/booking-list.ts:183` `listBookableFacilities` — location-scoped, sub-units included. |
| Billing bridge | **Exists** | `lib/services/booking-billing.ts:37` `requestBookingBill` — one invoice (source `other`), SAC + GST snapshotted at issue, booking locked `FOR UPDATE`; walk-in refused with `WALK_IN_BILL_ERROR`. Payment capture is the shared café panel (`components/cafe-payment-panel.tsx`) — cash / UPI QR / card terminal **references**, no PSP. |
| Server actions | **Exists** | `lib/actions/bookings.ts` — `listBookableFacilitiesAction`, `listBookingsAction`, `quoteBookingAction` (`bookings.read`); `createBookingAction`, `cancelBookingAction` (`bookings.write`); `requestBookingBillAction`, `readBookingBillAction` (`payments.record`). |
| Action → permission map | **Exists** | `lib/auth/action-permissions.ts:349-355`. |
| **Owner booking route** | **Missing** | `app/(owner)/owner/` has no `bookings/` segment. The only booking route is `app/(reception)/reception/bookings/page.tsx`, which calls `notFound()` by design (see §5). |

## 5. Routes and UI

| Capability | Verdict | Evidence |
|---|---|---|
| Reception booking counter (component) | **Exists, unreferenced** | `components/booking-screen.tsx` (facility → date → slot → member/walk-in → quote → create → day board → cancel → bill). Built for reception, referenced by no live route. |
| Booking form | **Exists** | `components/booking-form.tsx` — real server quote (`quoteBookingAction`), never a client-side price. |
| Day board | **Exists** | `components/booking-day-list.tsx` — status, price, walk-in "not billable in R1" note, cancel + bill actions. |
| Bill panel | **Exists** | `components/booking-bill-panel.tsx` — subtotal/GST/total re-derived server-side, shared payment panel. |
| Slot grid | **Exists** | `components/booking-shared.ts` — hourly 06:00–21:00, fixed in R1. |
| Reception route | **Exists, intentionally 404** | `app/(reception)/reception/bookings/page.tsx` — `notFound()`; pinned by `tests/tier1/reception-bookings-hidden.test.ts` and by the tile-absence assertion in `tests/mobile/reception-pr3.test.tsx:74`. The route comment names the cause: *"without [price-rule admin UI] every slot is a disabled 'No price is configured for this slot' dead end."* |
| **Owner booking route** | **Missing** | No `app/(owner)/owner/bookings/**`. |
| **Owner price configuration route** | **Missing** | No `app/(owner)/owner/settings/booking-prices/**`. |
| Owner nav entry | **Missing** | `lib/nav.ts` `OWNER_SIDEBAR_GROUPS` has no Bookings item and `OWNER_NAV_PERMISSION_GATES` has no `/owner/bookings` gate. `lib/nav.ts` is coordinator-owned in this batch. |

## 6. Customer self-service — deliberately out of scope

| Capability | Verdict | Evidence |
|---|---|---|
| Public / anonymous booking | **Missing** | `docs/architecture.md:1746` — "A `/book/[slug]/` public-booking tree is also documented but not yet implemented; Phase 3 work." `docs/project-scope.md:317` — public booking page with payment is P3. |
| Member self-service booking | **Missing** | No member-facing booking route exists on any surface. |
| **Authorization shortcut risk** | **Noted, avoided** | Every existing booking action resolves a **staff** permission (`bookings.read` / `bookings.write`) from the caller's staff role through `requireDefaultCtx` → `resolveDefaultMembership` (`lib/auth/context.ts:84`). Reusing `createBookingAction` as an anonymous/member-facing entry point would grant a public caller the staff booking grant, so the owner lane builds its own owner-guarded route and **does not** repurpose the staff actions for customer self-service. |
| Payment gateway | **Out of scope** | Release 1 records cash / UPI QR / card-terminal references only (`AGENTS.md:73-74`; `docs/architecture.md` §10 removal note). No PSP integration is added in this batch. |
| RFID / gate endpoints | **Out of scope** | `lib/services/mock-access/**` is a separate lane; this batch adds no RFID endpoint and does not touch `db/schema` for gates. |

## 7. Summary of the gap this batch closes

1. **Price-rule administration** (read/write service + actions + owner screen) against the
   **existing** `booking_price_rules` schema — no new table, no new entitlement, no new
   permission. Authority is `settings.manage` (owner/admin), so the receptionist does not
   gain pricing administration.
2. **An authenticated owner booking route** (`/owner/bookings`) reusing the existing
   `BookingScreen` engine, guarded by `requireOwner` + the `bookings.read` permission +
   the `pool.booking` feature entitlement, with the no-price state linking to the
   pricing screen.
3. **An owner price configuration route** (`/owner/settings/booking-prices`).

Known residual gaps this batch does **not** close (recorded, not silently ignored):

- Facility **closures / maintenance windows** are not modelled for bookings
  (`tenant_holidays` is session-only). A booking on a closure day is still accepted.
- **Capacity** is not enforced: the exclusion constraint is per facility/sub-unit.
- The **`pool.booking`** entitlement gates booking actions for every sport, so a
  court/pitch/studio-only academy cannot use them without a coordinator decision
  (new permission module or a per-tenant feature mapping — both are entitlement
  changes and therefore out of this lane's authority).
- The **reception** booking route stays 404 (its protected pin is unchanged).
- **Cancellation window / policy** is not implemented; cancellation follows the
  existing status guards only.
