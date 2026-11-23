import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { setTimeout as delay } from "node:timers/promises";
import { v7 as uuidv7 } from "uuid";
import { startIsolatedDb, type IsolatedDb } from "@/tests/helpers/isolated-db";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";
import { addDays, todayInZone, zonedWallTimeToInstant } from "@/lib/time/tz";

// Covers the owner-review hold on an already-issued booking invoice.

let fixture: IsolatedDb;
let admin: Pool;
let appPool: Pool;
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

function wall(dateIso: string, time: string): string {
  return zonedWallTimeToInstant(dateIso, time, TZ).toISOString();
}

const TOMORROW = addDays(todayInZone(TZ), 1);

beforeAll(async () => {
  fixture = await startIsolatedDb();
  admin = fixture.admin;
  vi.stubEnv("DATABASE_URL", fixture.appUri);
  vi.stubEnv("APP_LOGIN_PASSWORD", decodeURIComponent(new URL(fixture.appUri).password));
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(fixture.adminUri);
  vi.resetModules();
  appPool = (await import("@/db/client")).pool;
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
  await appPool?.end();
  await fixture?.stop();
  vi.unstubAllEnvs();
});

async function issue(dayTime: string, end: string) {
  const created = await bookings.createBooking(ctx, {
    facilityId, subUnitId: laneId, memberId, startsAt: wall(TOMORROW, dayTime), endsAt: wall(TOMORROW, end),
  });
  if (!created.ok) throw new Error(created.error);
  const billed = await billing.requestBookingBill(ctx, created.bookingId);
  if (!billed.ok) throw new Error(billed.error);
  return { bookingId: created.bookingId, invoiceId: billed.bill.invoiceId };
}

it("holds a cancelled booking balance consistently across reads and new collection", async () => {
  const { bookingId, invoiceId } = await issue("09:00", "10:00");
  expect((await bookings.cancelBooking(ctx, bookingId)).ok).toBe(true);
  const refused = await payments.recordPayment(ctx, { invoiceId, amountPaise: PRICE, method: "cash", idempotencyKey: uuidv7() });
  expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/collection is held.*owner to review/i) });
  const { listDeskDues } = await import("@/lib/services/fees-hub");
  const { getInvoice, listMemberInvoices } = await import("@/lib/services/invoices");
  const actionCtx = ctx as Parameters<typeof getInvoice>[0];
  expect(await getInvoice(actionCtx, invoiceId)).toMatchObject({ collectionHold: "booking_cancelled", paidPaise: 0 });
  expect((await listDeskDues(actionCtx)).find(row => row.id === invoiceId)).toMatchObject({ collectionHold: "booking_cancelled", outstandingPaise: PRICE });
  expect((await listMemberInvoices(actionCtx, memberId)).find(row => row.id === invoiceId)).toMatchObject({ collectionHold: "booking_cancelled" });
  const intents = await admin.query("select id from payment_intents where tenant_id=$1 and invoice_id=$2", [tenant, invoiceId]);
  expect(intents.rows).toHaveLength(0);
});

it("replays the earlier recorded payment after cancellation while holding the remainder", async () => {
  const { bookingId, invoiceId } = await issue("11:00", "12:00");
  const start = { invoiceId, amountPaise: PRICE / 2, method: "cash", idempotencyKey: uuidv7() };
  const first = await payments.recordPayment(ctx, start);
  if (!first.ok) throw new Error(first.error);
  expect((await bookings.cancelBooking(ctx, bookingId)).ok).toBe(true);
  expect(await payments.recordPayment(ctx, start)).toMatchObject({ ok: true, replayed: true, id: first.id });
  expect(await payments.recordPayment(ctx, { invoiceId, amountPaise: PRICE / 2, method: "cash" })).toMatchObject({ ok: false, error: expect.stringMatching(/collection is held.*owner to review/i) });
  const ledger = await admin.query("select amount_paise::text from payments where invoice_id=$1", [invoiceId]);
  expect(ledger.rows).toEqual([{ amount_paise: String(PRICE / 2) }]);
});

it("waits for an in-flight cancellation before applying a new payment", async () => {
  const { bookingId, invoiceId } = await issue("14:00", "15:00");
  const cancellation = await admin.connect();
  let result: ReturnType<typeof payments.recordPayment> | undefined;
  try {
    await cancellation.query("begin");
    await cancellation.query("update bookings set status='cancelled' where tenant_id=$1 and id=$2", [tenant, bookingId]);
    const current = await cancellation.query<{ pid: number }>("select pg_backend_pid() as pid");
    result = payments.recordPayment(ctx, { invoiceId, amountPaise: PRICE, method: "cash" });
    let blocked = false;
    for (let round = 0; round < 40 && !blocked; round += 1) {
      const check = await admin.query<{ blocked: boolean }>(
        "select exists (select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) as blocked",
        [current.rows[0]!.pid],
      );
      blocked = check.rows[0]?.blocked === true;
      if (!blocked) await delay(50);
    }
    expect(blocked).toBe(true);
    await cancellation.query("commit");
    expect(await result).toMatchObject({ ok: false, error: expect.stringMatching(/collection is held/i) });
    expect((await admin.query("select id from payments where invoice_id=$1", [invoiceId])).rows).toHaveLength(0);
  } finally {
    await cancellation.query("rollback");
    cancellation.release();
    await result?.catch(() => {});
  }
});
