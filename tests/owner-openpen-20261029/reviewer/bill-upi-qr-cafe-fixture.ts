#!/usr/bin/env tsx
/**
 * Reviewer-owned synthetic fixtures for the Cafe/Booking bill-linked UPI QR
 * check. QA code only: no schema, product source, credential or permission
 * change, and no DB reset.
 *
 *   node --experimental-strip-types bill-upi-qr-cafe-fixture.ts setup
 *   node --experimental-strip-types bill-upi-qr-cafe-fixture.ts cleanup
 *
 * Connection model mirrors db/client.ts: connect as app_login, verify
 * session_user=app_login and an aqua_test_* database, then select the
 * already-granted app_user role for the transaction.
 *
 * It prepares, namespaced and recorded in its own manifest:
 *   - one Cafe menu category + menu item with a nonzero price,
 *   - one synthetic Cafe order (placed) for the discovered member, so the
 *     real "Request bill" can issue its invoice,
 *   - one synthetic booking for today on the tenant's own facility, together
 *     with the one active nonzero booking price rule that prices it (its own
 *     row, named and recorded; no other price row is read or changed, and no
 *     no-price bypass is used).
 * The browser's real "Request bill" issues the invoice; that invoice id is
 * written back into this manifest so cleanup stays scoped to this run.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Client } from "pg";

export type CafeFixtureManifest = {
  namespace: string;
  createdAt: string;
  database: string;
  tenantId: string;
  memberId: string;
  memberName: string;
  locationId: string;
  timezone: string;
  actors: { owner: string; reception: string };
  cafe: {
    categoryId: string;
    itemId: string;
    itemName: string;
    pricePaise: number;
    orderId: string;
    orderLineId: string;
  };
  booking: null | {
    bookingId: string;
    ruleId: string;
    facilityId: string;
    facilityName: string;
    startsAt: string;
    endsAt: string;
    localStart: string;
    pricePaise: number;
    dateLabel: string;
    reason: string;
  };
  /** Filled by the browser run: server-created invoice ids for cleanup. */
  serverCreatedInvoices: string[];
};

type TargetFile = {
  database?: string;
  tenantId?: string;
  memberId?: string;
  locationId?: string;
  memberName?: string;
  actors?: Array<{ phone: string; status?: string }>;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function guardConnection(): string {
  const url = required("DATABASE_URL");
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\/+/, "");
  if (!database.startsWith("aqua_test_")) {
    throw new Error("Refusing non-disposable database; expected aqua_test_*");
  }
  if (parsed.username !== "app_login") {
    throw new Error("Fixture setup must use the app_login role");
  }
  return url;
}

async function connectAppRole(client: Client): Promise<string> {
  await client.connect();
  const session = await client.query<{ session_user: string; database: string }>(
    "select session_user as session_user, current_database() as database",
  );
  const who = session.rows[0];
  if (!who || who.session_user !== "app_login" || !who.database.startsWith("aqua_test_")) {
    throw new Error("Connected session is not the verified app_login/aqua_test_* target");
  }
  await client.query("set role app_user");
  const current = await client.query<{ current_user: string }>(
    "select current_user as current_user",
  );
  if (current.rows[0]?.current_user !== "app_user") {
    throw new Error("Role selection did not establish current_user=app_user");
  }
  return who.database;
}

function assertTargetDatabase(expected: string | undefined, actual: string): void {
  if (expected && expected !== actual) {
    throw new Error(
      `Discovery target names database ${expected} but the connection is ${actual}; refusing to use another runtime's IDs`,
    );
  }
}

async function loadTarget(): Promise<TargetFile> {
  const path =
    process.env.AQUA_BILL_UPI_TARGET ??
    ".playwright-mcp/bill-upi-qr-fixture/target.json";
  try {
    return JSON.parse(await readFile(resolve(process.cwd(), path), "utf8")) as TargetFile;
  } catch {
    return {};
  }
}

function manifestPath(): string {
  return resolve(
    process.cwd(),
    process.env.AQUA_BILL_UPI_CAFE_FIXTURE ??
      ".playwright-mcp/bill-upi-qr-cafe-fixture/fixture.json",
  );
}

async function scope() {
  const target = await loadTarget();
  const phones = (target.actors ?? [])
    .filter((actor) => (actor.status ?? "active") === "active")
    .map((actor) => actor.phone);
  return {
    database: target.database ?? "",
    tenantId:
      process.env.AQUA_BILL_UPI_TENANT_ID?.trim() ||
      target.tenantId ||
      required("AQUA_BILL_UPI_TENANT_ID"),
    memberId:
      process.env.AQUA_BILL_UPI_MEMBER_ID?.trim() ||
      target.memberId ||
      required("AQUA_BILL_UPI_MEMBER_ID"),
    locationId:
      process.env.AQUA_BILL_UPI_LOCATION_ID?.trim() ||
      target.locationId ||
      required("AQUA_BILL_UPI_LOCATION_ID"),
    memberName: target.memberName ?? null,
    ownerPhone:
      process.env.AQUA_BILL_UPI_OWNER_PHONE?.trim() ||
      phones.find((phone) => phone === "+919000000001") ||
      phones[0] ||
      "+919000000001",
    receptionPhone:
      process.env.AQUA_BILL_UPI_RECEPTION_PHONE?.trim() ||
      phones.find((phone) => phone === "+919000000004") ||
      phones[1] ||
      "+919000000004",
  };
}

async function setup(): Promise<void> {
  const url = guardConnection();
  const s = await scope();
  const path = manifestPath();
  if (existsSync(path)) {
    if (process.env.AQUA_BILL_UPI_REUSE !== "1") {
      throw new Error(
        "A Cafe/Booking fixture manifest already exists; refusing to overwrite it. Run cleanup first, or set AQUA_BILL_UPI_REUSE=1 to re-verify the same IDs.",
      );
    }
    const existing = JSON.parse(await readFile(path, "utf8")) as CafeFixtureManifest;
    await verifyExisting(url, existing);
    console.log(`cafe fixture reused (verified): ${existing.namespace}; manifest=${path}`);
    return;
  }

  const namespace = `BUQRC-${randomUUID().slice(0, 8).toUpperCase()}`;
  const client = new Client({ connectionString: url });
  const database = await connectAppRole(client);
  assertTargetDatabase(s.database || undefined, database);
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [s.tenantId]);
    const member = await client.query<{ full_name: string }>(
      `select p.full_name
         from members m join persons p on p.id = m.person_id and p.tenant_id = m.tenant_id
        where m.tenant_id = $1 and m.id = $2 and m.deleted_at is null
        limit 1`,
      [s.tenantId, s.memberId],
    );
    const location = await client.query<{ timezone: string }>(
      `select l.id, t.timezone from locations l
         join tenants t on t.id = l.tenant_id
        where l.tenant_id = $1 and l.id = $2 limit 1`,
      [s.tenantId, s.locationId],
    );
    if (!member.rows[0] || !location.rows[0]) {
      throw new Error("tenant/member/location scope does not exist or is not live");
    }
    const timezone = location.rows[0].timezone || "Asia/Kolkata";

    // Cafe menu data with a nonzero price (no no-price bypass).
    const categoryId = randomUUID();
    await client.query(
      `insert into menu_categories
         (id, tenant_id, location_id, name, sort_order, is_active, created_by, updated_by)
       values ($1,$2,$3,$4,0,true,null,null)`,
      [categoryId, s.tenantId, s.locationId, `QA cafe ${namespace}`],
    );
    const itemId = randomUUID();
    const itemName = `QA cafe item ${namespace}`;
    const pricePaise = 125_000;
    await client.query(
      `insert into menu_items
         (id, tenant_id, location_id, category_id, name, price_paise, tax_rate_bp,
          sac_code, is_veg, is_active, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,0,'9997',true,true,null,null)`,
      [itemId, s.tenantId, s.locationId, categoryId, itemName, pricePaise],
    );
    const orderId = randomUUID();
    await client.query(
      `insert into orders
         (id, tenant_id, location_id, member_id, status, channel, created_by, updated_by)
       values ($1,$2,$3,$4,'placed','counter',null,null)`,
      [orderId, s.tenantId, s.locationId, s.memberId],
    );
    const orderLineId = randomUUID();
    await client.query(
      `insert into order_lines
         (id, tenant_id, order_id, item_id, item_name, qty, unit_price_paise,
          tax_rate_bp, sac_code, line_paise, tax_paise)
       values ($1,$2,$3,$4,$5,1,$6,0,'9997',$6,0)`,
      [orderLineId, s.tenantId, orderId, itemId, itemName, pricePaise],
    );

    const booking = await createBooking(client, s, namespace, timezone);

    await client.query("commit");
    const manifest: CafeFixtureManifest = {
      namespace,
      createdAt: new Date().toISOString(),
      database: s.database,
      tenantId: s.tenantId,
      memberId: s.memberId,
      memberName: member.rows[0].full_name,
      locationId: s.locationId,
      timezone,
      actors: { owner: s.ownerPhone, reception: s.receptionPhone },
      cafe: {
        categoryId,
        itemId,
        itemName,
        pricePaise,
        orderId,
        orderLineId,
      },
      booking,
      serverCreatedInvoices: [],
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`cafe fixture ready: ${namespace}; manifest=${path}`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * One identifiable booking, its own price rule, and both rows recorded.
 *
 * The slot is computed by Postgres in the discovered timezone: the local day
 * stays a plain timestamp (no zone) and a single AT TIME ZONE turns it into
 * the instant. The day number is `dow` (0 = Sunday), which is what the
 * booking price rules and the pricing resolver use.
 *
 * The price rule is this fixture's own: one active, nonzero rule scoped to
 * the tenant's existing facility and to the exact slot. No other price row
 * is read as a rule or changed. The booking row is created under its own
 * SAVEPOINT so one refused slot cannot abort the surrounding transaction.
 */
async function createBooking(
  client: Client,
  s: Awaited<ReturnType<typeof scope>>,
  namespace: string,
  timezone: string,
): Promise<CafeFixtureManifest["booking"]> {
  const facilities = await client.query<{ id: string; name: string }>(
    `select id, name from facilities
      where tenant_id = $1 and location_id = $2 and deleted_at is null
      order by name limit 1`,
    [s.tenantId, s.locationId],
  );
  const facility = facilities.rows[0];
  if (!facility) return null;

  const slotTimes = [
    "21:00", "20:00", "19:00", "18:00", "17:00", "16:00", "15:00",
    "14:00", "13:00", "12:00", "11:00", "10:00", "09:00", "08:00",
  ];
  const slots = await client.query<{
    local_time: string;
    local_end: string;
    starts_at: Date;
    ends_at: Date;
    dow: number;
    date_label: string;
  }>(
    `with local_day as (
        select ((now() at time zone $1)::date)::timestamp as ts,
               to_char(((now() at time zone $1)::date), 'DD/MM/YYYY') as label
     )
     select s.local_time,
            (s.local_time::time + interval '1 hour')::text as local_end,
            (local_day.ts + (s.local_time::time - time '00:00')) at time zone $1 as starts_at,
            (local_day.ts + (s.local_time::time - time '00:00') + interval '1 hour') at time zone $1 as ends_at,
            extract(dow from (local_day.ts + (s.local_time::time - time '00:00')))::int as dow,
            local_day.label as date_label
       from unnest($2::text[]) as s(local_time)
       cross join local_day`,
    [timezone, slotTimes],
  );

  const pricePaise = 125_000;
  for (const slot of slots.rows) {
    const bookingId = randomUUID();
    const ruleId = randomUUID();
    await client.query("savepoint booking_slot");
    try {
      await client.query(
        `insert into bookings
           (id, tenant_id, location_id, facility_id, member_id, starts_at, ends_at,
            status, price_paise, notes, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,$9,null,null)`,
        [
          bookingId,
          s.tenantId,
          s.locationId,
          facility.id,
          s.memberId,
          slot.starts_at,
          slot.ends_at,
          pricePaise,
          `QA booking ${namespace}`,
        ],
      );
      // This fixture's own price rule, scoped to the same facility and slot.
      // The window must end after it starts (the table's own check), and it
      // covers the whole one-hour booking.
      await client.query(
        `insert into booking_price_rules
           (id, tenant_id, facility_id, label, days_of_week, start_time, end_time,
            price_paise, priority, is_active, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,1000,true,null,null)`,
        [
          ruleId,
          s.tenantId,
          facility.id,
          `QA price ${namespace}`,
          [slot.dow],
          slot.local_time,
          slot.local_end,
          pricePaise,
        ],
      );
      await client.query("release savepoint booking_slot");
      return {
        bookingId,
        ruleId,
        facilityId: facility.id,
        facilityName: facility.name,
        startsAt: new Date(slot.starts_at).toISOString(),
        endsAt: new Date(slot.ends_at).toISOString(),
        localStart: slot.local_time,
        pricePaise,
        dateLabel: slot.date_label,
        reason: "own price rule and booking created for the tenant timezone slot",
      };
    } catch {
      // The no-overlap exclusion can refuse one slot; that refusal must not
      // abort the surrounding transaction.
      await client.query("rollback to savepoint booking_slot").catch(() => {});
      await client.query("release savepoint booking_slot").catch(() => {});
    }
  }
  return null;
}

async function verifyExisting(
  url: string,
  manifest: CafeFixtureManifest,
): Promise<void> {
  const client = new Client({ connectionString: url });
  const database = await connectAppRole(client);
  assertTargetDatabase(manifest.database || undefined, database);
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [manifest.tenantId]);
    const order = await client.query<{ id: string }>(
      "select id from orders where tenant_id = $1 and id = $2 limit 1",
      [manifest.tenantId, manifest.cafe.orderId],
    );
    const item = await client.query<{ id: string }>(
      "select id from menu_items where tenant_id = $1 and id = $2 limit 1",
      [manifest.tenantId, manifest.cafe.itemId],
    );
    let bookingRows = 0;
    let ruleRows = 0;
    if (manifest.booking) {
      const booking = await client.query<{ id: string }>(
        "select id from bookings where tenant_id = $1 and id = $2 limit 1",
        [manifest.tenantId, manifest.booking.bookingId],
      );
      bookingRows = booking.rows.length;
      const rule = await client.query<{ id: string }>(
        "select id from booking_price_rules where tenant_id = $1 and id = $2 limit 1",
        [manifest.tenantId, manifest.booking.ruleId],
      );
      ruleRows = rule.rows.length;
    }
    await client.query("commit");
    if (
      order.rows.length !== 1 ||
      item.rows.length !== 1 ||
      (manifest.booking !== null && (bookingRows !== 1 || ruleRows !== 1))
    ) {
      throw new Error(
        "Existing Cafe/Booking fixture rows are missing; refusing to reuse this manifest. Run cleanup and set up again.",
      );
    }
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function cleanup(): Promise<void> {
  const url = guardConnection();
  const path = manifestPath();
  const manifest = JSON.parse(await readFile(path, "utf8")) as CafeFixtureManifest;
  const client = new Client({ connectionString: url });
  const database = await connectAppRole(client);
  assertTargetDatabase(manifest.database || undefined, database);
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [manifest.tenantId]);
    // The booking row references the invoice it was billed to, so it goes
    // first; then the invoice's own lines and the invoice.
    if (manifest.booking) {
      await client.query("delete from bookings where tenant_id=$1 and id=$2", [
        manifest.tenantId,
        manifest.booking.bookingId,
      ]);
      await client.query("delete from booking_price_rules where tenant_id=$1 and id=$2", [
        manifest.tenantId,
        manifest.booking.ruleId,
      ]);
    }
    const invoices = manifest.serverCreatedInvoices ?? [];
    if (invoices.length > 0) {
      await client.query(
        "delete from invoice_line_items where tenant_id=$1 and invoice_id = any($2::uuid[])",
        [manifest.tenantId, invoices],
      );
      await client.query("delete from invoices where tenant_id=$1 and id = any($2::uuid[])", [
        manifest.tenantId,
        invoices,
      ]);
    }
    await client.query(
      "delete from order_lines where tenant_id=$1 and id = $2",
      [manifest.tenantId, manifest.cafe.orderLineId],
    );
    await client.query("delete from orders where tenant_id=$1 and id = $2", [
      manifest.tenantId,
      manifest.cafe.orderId,
    ]);
    await client.query("delete from menu_items where tenant_id=$1 and id = $2", [
      manifest.tenantId,
      manifest.cafe.itemId,
    ]);
    await client.query("delete from menu_categories where tenant_id=$1 and id = $2", [
      manifest.tenantId,
      manifest.cafe.categoryId,
    ]);
    await client.query("commit");
    console.log(`cafe fixture cleaned: ${manifest.namespace}`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export type BillSnapshot = {
  invoice: {
    id: string;
    status: string;
    paidPaise: string;
    totalPaise: string;
  } | null;
  payments: string[];
  reversals: string[];
  intents: string[];
  intentsTable: boolean;
};

/** Read-only, app-role, tenant-scoped snapshot for the bill created in the browser. */
export async function readBillSnapshot(
  manifest: CafeFixtureManifest,
  invoiceId: string,
): Promise<BillSnapshot> {
  const url = guardConnection();
  const client = new Client({ connectionString: url });
  const database = await connectAppRole(client);
  assertTargetDatabase(manifest.database || undefined, database);
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [manifest.tenantId]);
    const invoice = await client.query<{
      id: string;
      status: string;
      paid_paise: string;
      total_paise: string;
    }>(
      `select id, status, paid_paise::text as paid_paise, total_paise::text as total_paise
         from invoices where tenant_id=$1 and id=$2 limit 1`,
      [manifest.tenantId, invoiceId],
    );
    const payments = await client.query<{ id: string }>(
      "select id from payments where tenant_id=$1 and invoice_id=$2 order by id",
      [manifest.tenantId, invoiceId],
    );
    const reversals = await client.query<{ id: string }>(
      `select r.id from payment_reversals r
         join payments p on p.id = r.payment_id and p.tenant_id = r.tenant_id
        where r.tenant_id=$1 and p.invoice_id=$2 order by r.id`,
      [manifest.tenantId, invoiceId],
    );
    const intentsTable = await client.query<{ exists: boolean }>(
      "select to_regclass('public.payment_intents') is not null as exists",
    );
    let intents: string[] = [];
    if (intentsTable.rows[0]?.exists) {
      const rows = await client.query<{ id: string }>(
        "select id from payment_intents where tenant_id=$1 and invoice_id=$2 order by id",
        [manifest.tenantId, invoiceId],
      );
      intents = rows.rows.map((row) => row.id);
    }
    await client.query("commit");
    const row = invoice.rows[0];
    return {
      invoice: row
        ? {
            id: row.id,
            status: row.status,
            paidPaise: row.paid_paise,
            totalPaise: row.total_paise,
          }
        : null,
      payments: payments.rows.map((entry) => entry.id),
      reversals: reversals.rows.map((entry) => entry.id),
      intents,
      intentsTable: Boolean(intentsTable.rows[0]?.exists),
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export type BookingSnapshot = {
  bookingId: string;
  invoiceId: string | null;
  status: string;
  pricePaise: string;
  startsAt: string;
  endsAt: string;
  facilityId: string;
  memberId: string | null;
};

/**
 * Read-only, app-role, tenant-scoped snapshot of the fixture booking.
 *
 * The booking row carries the invoice id the server linked to it, so this is
 * the proof that the invoice opened in the browser is the one this fixture
 * owns — not another booking's bill.
 */
export async function readBookingSnapshot(
  manifest: CafeFixtureManifest,
  bookingId: string,
): Promise<BookingSnapshot | null> {
  const url = guardConnection();
  const client = new Client({ connectionString: url });
  const database = await connectAppRole(client);
  assertTargetDatabase(manifest.database || undefined, database);
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [manifest.tenantId]);
    const rows = await client.query<{
      id: string;
      invoice_id: string | null;
      status: string;
      price_paise: string;
      starts_at: Date;
      ends_at: Date;
      facility_id: string;
      member_id: string | null;
    }>(
      `select id,
              invoice_id,
              status,
              price_paise::text as price_paise,
              starts_at,
              ends_at,
              facility_id,
              member_id
         from bookings
        where tenant_id = $1 and id = $2
        limit 1`,
      [manifest.tenantId, bookingId],
    );
    await client.query("commit");
    const row = rows.rows[0];
    if (!row) return null;
    return {
      bookingId: row.id,
      invoiceId: row.invoice_id,
      status: row.status,
      pricePaise: row.price_paise,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
      facilityId: row.facility_id,
      memberId: row.member_id,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

/** Record the server-created invoice ids so cleanup stays scoped to this run. */
export async function recordServerInvoices(invoiceIds: string[]): Promise<void> {
  const path = manifestPath();
  const manifest = JSON.parse(await readFile(path, "utf8")) as CafeFixtureManifest;
  manifest.serverCreatedInvoices = [
    ...new Set([...(manifest.serverCreatedInvoices ?? []), ...invoiceIds]),
  ];
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
}

/** The approved synthetic receiver for the shared QR, from the main fixture. */
export async function readApprovedReceiver(): Promise<{
  vpa: string;
  payeeName: string;
} | null> {
  const path =
    process.env.AQUA_BILL_UPI_FIXTURE ??
    ".playwright-mcp/bill-upi-qr-fixture/fixture.json";
  try {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), path), "utf8")) as {
      receiver?: { vpa: string; payeeName: string };
    };
    return manifest.receiver ?? null;
  } catch {
    return null;
  }
}

if (process.argv[1]?.endsWith("bill-upi-qr-cafe-fixture.ts")) {
  const command = process.argv[2];
  if (command === "setup") await setup();
  else if (command === "cleanup") await cleanup();
  else {
    console.error("usage: bill-upi-qr-cafe-fixture.ts setup|cleanup");
    process.exitCode = 1;
  }
}
