#!/usr/bin/env tsx
/**
 * Reviewer-owned synthetic fixtures for the bill-linked UPI QR check.
 *
 * This is QA code, not app implementation. It never changes schema, product
 * source, actor credentials, or resets a database. It writes only namespaced
 * rows into the already verified disposable aqua_test_* database and cleans
 * only the IDs recorded in its own manifest.
 *
 * Setup:
 *   node --experimental-strip-types bill-upi-qr-fixture.ts setup
 * Cleanup:
 *   node --experimental-strip-types bill-upi-qr-fixture.ts cleanup
 *
 * Required environment (no root .env is read by this file):
 *   DATABASE_URL             app_login connection to aqua_test_*
 *   AQUA_BILL_UPI_TENANT_ID  existing synthetic tenant
 *   AQUA_BILL_UPI_MEMBER_ID  existing synthetic member
 *   AQUA_BILL_UPI_LOCATION_ID existing synthetic location
 *   AQUA_BILL_UPI_RECEIVER_VPA / _NAME approved synthetic UPI receiver
 *   AQUA_BILL_UPI_FIXTURE    ignored manifest path
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Client } from "pg";

export type Manifest = {
  namespace: string;
  createdAt: string;
  database: string;
  tenantId: string;
  memberId: string;
  locationId: string;
  memberName: string;
  actors: { owner: string; reception: string };
  receiver: { vpa: string; payeeName: string; nickname: string; paymentQrId: string };
  invoices: {
    openA: { id: string; number: string; amountPaise: number };
    openB: { id: string; number: string; amountPaise: number };
    closed: { id: string; number: string; amountPaise: number };
    void: { id: string; number: string; amountPaise: number };
  };
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
  // Mirror db/client.ts: app_login is intentionally NOINHERIT; the app
  // transaction runs under the already-granted app_user role.
  await client.query("set role app_user");
  const current = await client.query<{ current_user: string }>(
    "select current_user as current_user",
  );
  if (current.rows[0]?.current_user !== "app_user") {
    throw new Error("Role selection did not establish current_user=app_user");
  }
  return who.database;
}

/** Refuse to act on a target discovery file that names another database. */
function assertTargetDatabase(expected: string | undefined, actual: string): void {
  if (expected && expected !== actual) {
    throw new Error(
      `Discovery target names database ${expected} but the connection is ${actual}; refusing to use another runtime's IDs`,
    );
  }
}

type TargetFile = {
  database?: string;
  login?: string;
  role?: string;
  tenantId?: string;
  memberId?: string;
  locationId?: string;
  memberName?: string;
  actors?: Array<{ phone: string; status?: string }>;
};

/** Authoritative, read-only discovery output for the runtime under test. */
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

/**
 * Scope comes from the authoritative, read-only discovery output for the
 * runtime under test. Environment variables may override it, but the
 * discovered tenant/member/location are never invented here.
 */
async function resolveScope(): Promise<{
  database: string;
  tenantId: string;
  memberId: string;
  locationId: string;
  memberName: string | null;
  ownerPhone: string | null;
  receptionPhone: string | null;
  vpa: string;
  payeeName: string;
}> {
  const target = await loadTarget();
  const actorPhones = (target.actors ?? [])
    .filter((actor) => (actor.status ?? "active") === "active")
    .map((actor) => actor.phone);
  return {
    database: target.database ?? "",
    tenantId: process.env.AQUA_BILL_UPI_TENANT_ID?.trim() || target.tenantId || required("AQUA_BILL_UPI_TENANT_ID"),
    memberId: process.env.AQUA_BILL_UPI_MEMBER_ID?.trim() || target.memberId || required("AQUA_BILL_UPI_MEMBER_ID"),
    locationId: process.env.AQUA_BILL_UPI_LOCATION_ID?.trim() || target.locationId || required("AQUA_BILL_UPI_LOCATION_ID"),
    memberName: target.memberName ?? null,
    ownerPhone: actorPhones.find((phone) => phone === "+919000000001") ?? actorPhones[0] ?? null,
    receptionPhone: actorPhones.find((phone) => phone === "+919000000004") ?? actorPhones[1] ?? null,
    vpa: process.env.AQUA_BILL_UPI_RECEIVER_VPA?.trim() || "khelsuite-qa-20261030@upi",
    payeeName: process.env.AQUA_BILL_UPI_RECEIVER_NAME?.trim() || "QA only - do not pay",
  };
}

function fixturePath(): string {
  return resolve(
    process.cwd(),
    process.env.AQUA_BILL_UPI_FIXTURE ??
      ".playwright-mcp/bill-upi-qr-fixture/fixture.json",
  );
}

/** Re-verify an existing manifest's own rows; never write on reuse. */
async function verifyExistingFixture(url: string, manifest: Manifest): Promise<void> {
  const client = new Client({ connectionString: url });
  const database = await connectAppRole(client);
  assertTargetDatabase(manifest.database || undefined, database);
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [manifest.tenantId]);
    const ids = Object.values(manifest.invoices).map((invoice) => invoice.id);
    const invoices = await client.query<{ id: string }>(
      "select id from invoices where tenant_id=$1 and id = any($2::uuid[]) order by id",
      [manifest.tenantId, ids],
    );
    const receiver = await client.query<{ id: string }>(
      "select id from payment_qrs where tenant_id=$1 and id=$2",
      [manifest.tenantId, manifest.receiver.paymentQrId],
    );
    await client.query("commit");
    if (invoices.rows.length !== ids.length || receiver.rows.length !== 1) {
      throw new Error(
        "Existing fixture rows are missing; refusing to reuse this manifest. Run cleanup and set up again.",
      );
    }
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function setup(): Promise<void> {
  const url = guardConnection();
  const scope = await resolveScope();
  const tenantId = scope.tenantId;
  const memberId = scope.memberId;
  const locationId = scope.locationId;
  const vpa = scope.vpa;
  const payeeName = scope.payeeName;
  const manifestPath = fixturePath();
  if (existsSync(manifestPath)) {
    if (process.env.AQUA_BILL_UPI_REUSE !== "1") {
      throw new Error(
        "A fixture manifest already exists; refusing to overwrite it. Run cleanup first, or set AQUA_BILL_UPI_REUSE=1 to re-verify and reuse the same IDs.",
      );
    }
    const existing = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
    if (
      existing.tenantId !== tenantId ||
      existing.memberId !== memberId ||
      existing.locationId !== locationId
    ) {
      throw new Error(
        "Existing fixture manifest points at a different tenant/member/location; refusing to reuse or overwrite it.",
      );
    }
    await verifyExistingFixture(url, existing);
    console.log(`fixture reused (verified): ${existing.namespace}; manifest=${manifestPath}`);
    return;
  }
  const namespace = `BUQR-${randomUUID().slice(0, 8).toUpperCase()}`;
  const client = new Client({ connectionString: url });
  const database = await connectAppRole(client);
  assertTargetDatabase(scope.database || undefined, database);
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const member = await client.query<{ full_name: string }>(
      `select p.full_name
         from members m join persons p on p.id = m.person_id and p.tenant_id = m.tenant_id
        where m.tenant_id = $1 and m.id = $2 and m.deleted_at is null
        limit 1`,
      [tenantId, memberId],
    );
    const location = await client.query(
      "select 1 from locations where tenant_id = $1 and id = $2 limit 1",
      [tenantId, locationId],
    );
    if (!member.rows[0] || !location.rows[0]) {
      throw new Error("tenant/member/location fixture scope does not exist or is not live");
    }
    const today = new Date().toISOString().slice(0, 10);
    const financialYear = "2026-27";
    const makeInvoice = async (suffix: string, amount: number, status: "issued" | "paid" | "void") => {
      const id = randomUUID();
      const number = `${namespace}-${suffix}`;
      await client.query(
        `insert into invoices
           (id, tenant_id, location_id, member_id, invoice_number, financial_year,
            issued_on, due_on, subtotal_paise, tax_paise, total_paise, paid_paise,
            status, source, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$7,$8,0,$8,$9,$10,'membership',null,null)`,
        [
          id,
          tenantId,
          locationId,
          memberId,
          number,
          financialYear,
          today,
          amount,
          status === "paid" ? amount : 0,
          status,
        ],
      );
      await client.query(
        `insert into invoice_line_items
           (id, tenant_id, invoice_id, description, sac_code, amount_paise, tax_rate_bp, tax_paise)
         values ($1,$2,$3,$4,'9997',$5,0,0)`,
        [randomUUID(), tenantId, id, `Synthetic bill-linked UPI fixture ${suffix}`, amount],
      );
      return { id, number, amountPaise: amount };
    };
    const openA = await makeInvoice("A", 125_000, "issued");
    const openB = await makeInvoice("B", 75_000, "issued");
    const closed = await makeInvoice("C", 50_000, "paid");
    const voided = await makeInvoice("V", 30_000, "void");
    const paymentQrId = randomUUID();
    await client.query(
      `insert into payment_qrs
         (id, tenant_id, nickname, kind, upi_id, payee_name, is_active, sort_order,
          created_by, updated_by)
       values ($1,$2,$3,'upi',$4,$5,true,0,null,null)`,
      [paymentQrId, tenantId, `${namespace} UPI`, vpa, payeeName],
    );
    await client.query("commit");
    const manifest: Manifest = {
      namespace,
      createdAt: new Date().toISOString(),
      database: scope.database,
      tenantId,
      memberId,
      locationId,
      memberName: member.rows[0].full_name,
      actors: {
        owner: scope.ownerPhone ?? "+919000000001",
        reception: scope.receptionPhone ?? "+919000000004",
      },
      receiver: { vpa, payeeName, nickname: `${namespace} UPI`, paymentQrId },
      invoices: { openA, openB, closed, void: voided },
    };
    const path = manifestPath;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`fixture ready: ${namespace}; manifest=${path}`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function cleanup(): Promise<void> {
  const url = guardConnection();
  const manifest = JSON.parse(await readFile(fixturePath(), "utf8")) as Manifest;
  const client = new Client({ connectionString: url });
  const database = await connectAppRole(client);
  assertTargetDatabase(manifest.database || undefined, database);
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [manifest.tenantId]);
    const ids = Object.values(manifest.invoices).map((invoice) => invoice.id);
    await client.query("delete from invoice_line_items where tenant_id=$1 and invoice_id = any($2::uuid[])", [
      manifest.tenantId,
      ids,
    ]);
    await client.query("delete from invoices where tenant_id=$1 and id = any($2::uuid[])", [
      manifest.tenantId,
      ids,
    ]);
    await client.query("delete from payment_qrs where tenant_id=$1 and id=$2", [
      manifest.tenantId,
      manifest.receiver.paymentQrId,
    ]);
    await client.query("commit");
    console.log(`fixture cleaned: ${manifest.namespace}`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export type InvoiceFinancialState = {
  id: string;
  status: string;
  paidPaise: string;
  totalPaise: string;
};

export type MutationSnapshot = {
  payments: string[];
  reversals: string[];
  intents: string[];
  intentsTable: boolean;
  invoices: InvoiceFinancialState[];
};

/** Read-only, app-role, tenant-scoped identity snapshot for the fixture invoices. */
export async function readMutationSnapshot(manifest: Manifest): Promise<MutationSnapshot> {
  const url = guardConnection();
  const client = new Client({ connectionString: url });
  const database = await connectAppRole(client);
  assertTargetDatabase(manifest.database || undefined, database);
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [manifest.tenantId]);
    const invoiceIds = Object.values(manifest.invoices).map((invoice) => invoice.id);
    const payments = await client.query<{ id: string }>(
      "select id from payments where tenant_id=$1 and invoice_id = any($2::uuid[]) order by id",
      [manifest.tenantId, invoiceIds],
    );
    const reversals = await client.query<{ id: string }>(
      `select r.id from payment_reversals r
        join payments p on p.id = r.payment_id and p.tenant_id = r.tenant_id
       where r.tenant_id=$1 and p.invoice_id = any($2::uuid[]) order by r.id`,
      [manifest.tenantId, invoiceIds],
    );
    const intentsTable = await client.query<{ exists: boolean }>(
      "select to_regclass('public.payment_intents') is not null as exists",
    );
    let intents: string[] = [];
    if (intentsTable.rows[0]?.exists) {
      const rows = await client.query<{ id: string }>(
        "select id from payment_intents where tenant_id=$1 and invoice_id = any($2::uuid[]) order by id",
        [manifest.tenantId, invoiceIds],
      );
      intents = rows.rows.map((row) => row.id);
    }
    const invoiceRows = await client.query<{
      id: string;
      status: string;
      paid_paise: string;
      total_paise: string;
    }>(
      `select id, status, paid_paise::text as paid_paise, total_paise::text as total_paise
         from invoices where tenant_id=$1 and id = any($2::uuid[]) order by id`,
      [manifest.tenantId, invoiceIds],
    );
    await client.query("commit");
    return {
      payments: payments.rows.map((row) => row.id),
      reversals: reversals.rows.map((row) => row.id),
      intents,
      intentsTable: Boolean(intentsTable.rows[0]?.exists),
      invoices: invoiceRows.rows.map((row) => ({
        id: row.id,
        status: row.status,
        paidPaise: row.paid_paise,
        totalPaise: row.total_paise,
      })),
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("bill-upi-qr-fixture.ts")) {
  const command = process.argv[2];
  if (command === "setup") await setup();
  else if (command === "cleanup") await cleanup();
  else {
    console.error("usage: bill-upi-qr-fixture.ts setup|cleanup");
    process.exitCode = 1;
  }
}
