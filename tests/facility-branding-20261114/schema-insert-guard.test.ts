import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { sql } from "drizzle-orm";
import { privilegedFixturePool as admin } from "../db/privileged-fixture";
import { withTenant, type TenantTx } from "@/db/tenant";
import { asTenantId } from "@/lib/ids";
import { env } from "@/lib/env";

const tenantId = asTenantId(uuidv7());
const enabledSite = uuidv7();
const legacySite = uuidv7();
const raceSite = uuidv7();
const app = new Pool({ connectionString: env.DATABASE_URL });
const address = { line1: "Guard road", line2: null, city: "Mumbai", postalCode: "400001" };

beforeAll(async () => {
  await admin.query(`insert into tenants(id,slug,name,status,gstin,billing_legal_name,billing_legal_address,billing_state_code)
    values($1,$2,'Issuer guard fixture','active','27ABCDE1234F1Z5','Issuer guard fixture',$3::jsonb,'27')`,
  [tenantId, `issuer-guard-${tenantId}`, JSON.stringify(address)]);
  for (const [id, name] of [[enabledSite, "Enabled"], [legacySite, "Legacy"], [raceSite, "Race"]]) {
    await admin.query("insert into locations(id,tenant_id,name,is_primary) values($1,$2,$3,false)", [id, tenantId, name]);
  }
  await admin.query(`insert into location_billing_settings(tenant_id,location_id,state_code,facility_billing_enabled,mode)
    values($1,$2,'27',true,'inherit'),($1,$3,'27',false,'inherit')`, [tenantId, enabledSite, raceSite]);
});

afterAll(async () => {
  await admin.query("delete from orders where tenant_id=$1", [tenantId]);
  await admin.query("delete from invoices where tenant_id=$1", [tenantId]);
  await admin.query("delete from locations where tenant_id=$1", [tenantId]);
  await admin.query("delete from tenants where id=$1", [tenantId]);
  await app.end();
  await admin.end();
});

function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown";
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? errorCode(error.cause) : "unknown";
}
async function outcome(operation: Promise<unknown>) {
  try { await operation; return "accepted"; } catch (error) { return errorCode(error); }
}
function legacyInvoice(tx: TenantTx, locationId: string) {
  return tx.execute(sql`insert into invoices(id,tenant_id,location_id,payer_kind,guest_name,invoice_number,
    financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,source,status)
    values(${uuidv7()},${tenantId},${locationId},'guest','Synthetic payer',${`G-${uuidv7().replaceAll("-", "").slice(-12)}`},
    '2026-27','2026-11-14','2026-11-14',100,0,100,'other','issued')`);
}
async function begin(client: PoolClient, isolation = "read committed") {
  if (!["read committed", "repeatable read"].includes(isolation)) throw new Error("Unexpected test isolation");
  await client.query("set role app_user");
  await client.query(`begin isolation level ${isolation}`);
  await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
}
function rawLegacyInvoice(client: PoolClient, locationId: string) {
  return client.query(`insert into invoices(id,tenant_id,location_id,payer_kind,guest_name,invoice_number,
    financial_year,issued_on,due_on,subtotal_paise,tax_paise,total_paise,source,status)
    values($1,$2,$3,'guest','Synthetic payer',$4,'2026-27','2026-11-14','2026-11-14',100,0,100,'other','issued')`,
  [uuidv7(), tenantId, locationId, `G-${uuidv7().replaceAll("-", "").slice(-12)}`]);
}

describe("Enabled-site insert compatibility barrier", () => {
  it("refuses a legacy invoice insert at an enabled site", async () => {
    expect(await outcome(withTenant(tenantId, (tx) => legacyInvoice(tx, enabledSite)))).toBe("23514");
  });

  it("refuses a legacy order insert at an enabled site", async () => {
    expect(await outcome(withTenant(tenantId, (tx) => tx.execute(sql`
      insert into orders(id,tenant_id,location_id,status,channel) values(${uuidv7()},${tenantId},${enabledSite},'placed','counter')
    `)))).toBe("23514");
  });

  it("preserves legacy inserts at an unconfigured site", async () => {
    expect(await outcome(withTenant(tenantId, (tx) => legacyInvoice(tx, legacySite)))).toBe("accepted");
    expect(await outcome(withTenant(tenantId, (tx) => tx.execute(sql`
      insert into orders(id,tenant_id,location_id,status,channel) values(${uuidv7()},${tenantId},${legacySite},'placed','counter')
    `)))).toBe("accepted");
  });

  it("refuses a legacy writer that waits behind concurrent enablement", async () => {
    const setter = await app.connect(); const writer = await app.connect();
    try {
      await begin(setter); await begin(writer);
      await setter.query("select id from tenants where id=$1 for update", [tenantId]);
      await setter.query("update location_billing_settings set facility_billing_enabled=true where tenant_id=$1 and location_id=$2", [tenantId, raceSite]);
      const pid = (await writer.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      let settled = false;
      const insertion = outcome(rawLegacyInvoice(writer, raceSite)).then((value) => { settled = true; return value; });
      let blocked = false;
      const deadline = Date.now() + 5000;
      while (!settled && Date.now() < deadline) {
        const row = (await admin.query<{ wait_event_type: string | null }>(
          "select wait_event_type from pg_stat_activity where pid=$1", [pid],
        )).rows[0];
        if (row?.wait_event_type === "Lock") { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(blocked).toBe(true);
      await setter.query("commit");
      expect(await insertion).toBe("23514");
    } finally {
      await setter.query("rollback"); await writer.query("rollback");
      setter.release(); writer.release();
    }
  });

  it("cannot use a repeatable-read snapshot from before enablement", async () => {
    await admin.query("update location_billing_settings set facility_billing_enabled=false where tenant_id=$1 and location_id=$2", [tenantId, raceSite]);
    const setter = await app.connect(); const writer = await app.connect();
    try {
      await begin(writer, "repeatable read");
      await writer.query("select facility_billing_enabled from location_billing_settings where tenant_id=$1 and location_id=$2", [tenantId, raceSite]);
      await begin(setter);
      await setter.query("select id from tenants where id=$1 for update", [tenantId]);
      await setter.query("update location_billing_settings set facility_billing_enabled=true where tenant_id=$1 and location_id=$2", [tenantId, raceSite]);
      await setter.query("commit");
      expect(["23514", "40001"]).toContain(await outcome(rawLegacyInvoice(writer, raceSite)));
    } finally {
      await setter.query("rollback"); await writer.query("rollback");
      setter.release(); writer.release();
    }
  });
});
