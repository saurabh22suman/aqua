import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";
import { computeTax } from "@/lib/money/arithmetic";
import { addDays, todayInZone, zonedWallTimeToInstant } from "@/lib/time/tz";

// V-04 — staff booking flow. Written before the service + UI exist:
// the first run is deliberately red.
//
// The money rules pinned here are the café split applied to a
// booking:
//   * a booking snapshots the V-03 resolved price (GST-inclusive:
//     the price quoted is the price paid);
//   * "Request bill" issues exactly one invoice, source 'other', one
//     line "Booking: <facility> <time>", with the configured SAC and
//     GST rate snapshotted at issue;
//   * the invoice total equals the booking price to the paisa —
//     proven across a wide price/rate sweep, because the base/tax
//     split is derived with splitTotal and passed explicitly, never
//     recomputed by a rounding path that can differ;
//   * a walk-in booking is billed to a named guest (no member; no
//     anonymous payment path); the invoice remains bound to that guest;
//   * cancelling writes a booking.cancel audit row; a cancelled
//     booking cannot be billed.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const loc = uuidv7();
const actor = asUserId(uuidv7());
const roleId = uuidv7(), membershipId = uuidv7();
const personId = uuidv7();
const memberId = asMemberId(uuidv7());
const facilityId = uuidv7();
const laneId = uuidv7();
const ctx = { tenantId: tenant, userId: actor, requestId: uuidv7() };

let bookings: typeof import("@/lib/services/bookings");
let billing: typeof import("@/lib/services/booking-billing");
let payments: typeof import("@/lib/services/payments");

const PRICE = 50_000;
const SAC = "999723";
const RATE_BP = 1800;

function wall(dateIso: string, time: string): string {
  return zonedWallTimeToInstant(dateIso, time, TZ).toISOString();
}

const TOMORROW = addDays(todayInZone(TZ), 1);

beforeAll(async () => {
  bookings = await import("@/lib/services/bookings");
  billing = await import("@/lib/services/booking-billing");
  payments = await import("@/lib/services/payments");

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone, gstin) values ($1, $2, 'Booking Flow', 'active', $3, '27ABCDE1234F1Z5')",
    [tenant, `v04-${RUN}`, TZ],
  );
  for (const id of [tenant]) await admin.query("insert into tenant_features(tenant_id,feature_key,enabled) values($1,'pool.booking',true)", [id]);
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Flow Site', true)",
    [loc, tenant],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+91${String(BigInt("0x" + uuidv7().replaceAll("-", "").slice(-12)) % 4_000_000_000n + 6_000_000_000n)}`,
  ]);
  await admin.query("insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values($1,$2,'owner','Owner','/owner',0)",[roleId,tenant]);
  await admin.query("insert into role_permissions(tenant_id,role_id,permission_key) select $1,$2,p.key from (values ('bookings.read'),('bookings.write'),('invoices.read'),('invoices.write'),('payments.record')) p(key)",[tenant,roleId]);
  await admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$2,$3,$4,'active',true)",[membershipId,tenant,actor,roleId]);
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Flow Member')",
    [personId, tenant],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberId, tenant, personId, loc, `V04-${RUN}`],
  );
  await admin.query(
    "insert into facilities (id, tenant_id, location_id, name, kind, capacity) values ($1, $2, $3, 'Indoor Court', 'court', 1)",
    [facilityId, tenant, loc],
  );
  await admin.query(
    "insert into facility_sub_units (id, tenant_id, facility_id, name) values ($1, $2, $3, 'Court 1')",
    [laneId, tenant, facilityId],
  );
  await admin.query(
    `insert into booking_price_rules (id, tenant_id, facility_id, label, days_of_week, start_time, end_time, price_paise, priority, is_active)
     values ($1, $2, null, 'Default', '{}', null, null, $3, 0, true)`,
    [uuidv7(), tenant, PRICE],
  );
}, 60_000);

afterAll(async () => {
  await admin.query("delete from receipts where tenant_id = $1", [tenant]);
  await admin.query("delete from payments where tenant_id = $1", [tenant]);
  await admin.query("delete from invoice_line_items where tenant_id = $1", [
    tenant,
  ]);
  await admin.query("delete from bookings where tenant_id = $1", [tenant]);
  await admin.query("delete from invoices where tenant_id = $1", [tenant]);
  await admin.query("delete from booking_price_rules where tenant_id = $1", [
    tenant,
  ]);
  await admin.query("delete from facility_sub_units where tenant_id = $1", [
    tenant,
  ]);
  await admin.query("delete from facilities where tenant_id = $1", [tenant]);
  await admin.query("delete from members where tenant_id = $1", [tenant]);
  await admin.query("delete from persons where tenant_id = $1", [tenant]);
  await admin.query("delete from tenant_memberships where tenant_id = $1", [tenant]);
  await admin.query("delete from role_permissions where tenant_id = $1", [tenant]);
  await admin.query("delete from roles where tenant_id = $1", [tenant]);
  await admin.query("delete from locations where tenant_id = $1", [tenant]);
  await admin.query("delete from tenant_features where tenant_id=$1", [tenant]);
  await admin.query("delete from tenants where id = $1", [tenant]);
  await admin.query("delete from users where id=$1 and not exists (select 1 from audit_log where actor_id=users.id)",[actor]);
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("V-04 staff booking flow", () => {
  it("creates a member booking at the resolved V-03 price", async () => {
    const created = await bookings.createBooking(ctx, {
      facilityId,
      subUnitId: laneId,
      memberId,
      startsAt: wall(TOMORROW, "07:00"),
      endsAt: wall(TOMORROW, "08:00"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.pricePaise).toBe(PRICE);

    const { rows } = await admin.query<{
      price_paise: string;
      member_id: string;
      walk_in_name: string | null;
    }>("select price_paise, member_id, walk_in_name from bookings where id = $1", [
      created.bookingId,
    ]);
    expect(Number(rows[0]!.price_paise)).toBe(PRICE);
    expect(rows[0]!.member_id).toBe(memberId);
    expect(rows[0]!.walk_in_name).toBeNull();
  });

  it("issues one source='other' invoice whose total equals the booking price to the paisa, then collects it", async () => {
    const created = await bookings.createBooking(ctx, {
      facilityId,
      subUnitId: laneId,
      memberId,
      startsAt: wall(TOMORROW, "09:00"),
      endsAt: wall(TOMORROW, "10:00"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const billed = await billing.requestBookingBill(ctx, created.bookingId);
    expect(billed.ok).toBe(true);
    if (!billed.ok) return;
    expect(billed.alreadyBilled).toBe(false);
    expect(billed.bill.documentKind).toBe("tax_invoice");
    expect(billed.bill.totalPaise).toBe(PRICE);
    expect(billed.bill.amountDuePaise).toBe(PRICE);
    expect(billed.bill.lineDescription).toMatch(/^Booking: /);

    const invoice = await admin.query<{
      source: string;
      subtotal_paise: string;
      tax_paise: string;
      total_paise: string;
      member_id: string;
    }>(
      "select source, subtotal_paise, tax_paise, total_paise, member_id from invoices where id = $1",
      [billed.bill.invoiceId],
    );
    expect(invoice.rows[0]!.source).toBe("other");
    expect(invoice.rows[0]!.member_id).toBe(memberId);
    expect(Number(invoice.rows[0]!.total_paise)).toBe(PRICE);
    expect(
      Number(invoice.rows[0]!.subtotal_paise) + Number(invoice.rows[0]!.tax_paise),
    ).toBe(PRICE);

    const lines = await admin.query<{
      sac_code: string;
      tax_rate_bp: number;
      amount_paise: string;
      tax_paise: string;
      description: string;
    }>(
      "select sac_code, tax_rate_bp, amount_paise, tax_paise, description from invoice_line_items where invoice_id = $1",
      [billed.bill.invoiceId],
    );
    expect(lines.rows).toHaveLength(1);
    expect(lines.rows[0]!.sac_code).toBe(SAC);
    expect(lines.rows[0]!.tax_rate_bp).toBe(RATE_BP);
    expect(lines.rows[0]!.description).toMatch(/^Booking: /);

    // A second request returns the same invoice, never a second one.
    const again = await billing.requestBookingBill(ctx, created.bookingId);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.alreadyBilled).toBe(true);
      expect(again.bill.invoiceId).toBe(billed.bill.invoiceId);
    }

    const paid = await payments.recordPayment(ctx, {
      invoiceId: billed.bill.invoiceId,
      amountPaise: PRICE,
      method: "cash",
    });
    expect(paid.ok).toBe(true);

    const after = await billing.readBookingBill(ctx, created.bookingId);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.bill.amountDuePaise).toBe(0);
    }
  });

  it("bills a named walk-in once as a guest", async () => {
    const created = await bookings.createBooking(ctx, {
      facilityId,
      subUnitId: null,
      walkInName: "Walk-in Guest",
      startsAt: wall(TOMORROW, "11:00"),
      endsAt: wall(TOMORROW, "12:00"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const billed = await billing.requestBookingBill(ctx, created.bookingId);
    expect(billed.ok).toBe(true);
    if (!billed.ok) return;
    const again = await billing.requestBookingBill(ctx, created.bookingId);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.bill.invoiceId).toBe(billed.bill.invoiceId);
    const { rows } = await admin.query(
      "select b.id as booking_id, b.invoice_id, i.tenant_id, i.location_id, i.member_id, i.payer_kind, i.guest_name, i.total_paise::text from bookings b join invoices i on i.id=b.invoice_id and i.tenant_id=b.tenant_id where b.id=$1",
      [created.bookingId],
    );
    expect(rows).toEqual([expect.objectContaining({ booking_id: created.bookingId, invoice_id: billed.bill.invoiceId, tenant_id: tenant, location_id: loc, member_id: null, payer_kind: "guest", guest_name: "Walk-in Guest", total_paise: String(PRICE) })]);
    const count = await admin.query<{ n: string }>("select count(*)::text n from invoices where tenant_id=$1 and payer_kind='guest' and guest_name=$2", [tenant, "Walk-in Guest"]);
    expect(count.rows[0]?.n).toBe("1");
  });

  it("writes a booking.cancel audit row, and a cancelled booking cannot be billed", async () => {
    const created = await bookings.createBooking(ctx, {
      facilityId,
      subUnitId: laneId,
      memberId,
      startsAt: wall(TOMORROW, "13:00"),
      endsAt: wall(TOMORROW, "14:00"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const cancelled = await bookings.cancelBooking(ctx, created.bookingId);
    expect(cancelled.ok).toBe(true);

    const { rows } = await admin.query<{ n: string }>(
      "select count(*)::text as n from audit_log where tenant_id = $1 and action = 'booking.cancel' and entity_id = $2",
      [tenant, created.bookingId],
    );
    expect(Number(rows[0]!.n)).toBe(1);

    const billed = await billing.requestBookingBill(ctx, created.bookingId);
    expect(billed.ok).toBe(false);
    if (!billed.ok) expect(billed.error).toMatch(/cancelled/i);
  });

  it("splits every realistic price into base + tax exactly, at every configured rate", () => {
    for (const rate of [0, 500, 1200, 1800, 2800]) {
      for (let price = 100; price <= 20_000; price++) {
        const split = billing.splitInclusivePrice(price, rate);
        expect(
          split.base + split.tax,
          `price ${price} rate ${rate} must conserve paise`,
        ).toBe(price);
        // The stored tax is the inclusive remainder; it can differ
        // from a fresh computeTax(base, rate) by one paisa of
        // rounding, never more.
        expect(
          Math.abs(computeTax(split.base, rate) - split.tax),
          `price ${price} rate ${rate} tax drift`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });
});
