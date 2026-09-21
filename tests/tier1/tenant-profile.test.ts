import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import {
  getTenantProfile,
  updateTenantProfile,
} from "@/lib/services/tenant-profile";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// PR2-C1 — academy profile settings. The owner must be able to fix
// a typo'd GSTIN (and name/currency/timezone) from Settings without a
// platform operator, with an audit row and no rewrite of already-issued
// documents (the GSTIN snapshot on an invoice is immutable history).

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const actorId = asUserId(uuidv7());
const invoiceId = uuidv7();
const personId = uuidv7();
const memberId = uuidv7();
const locationId = uuidv7();

const ctxA = { tenantId: tenantA, userId: actorId };

async function tenantRow(id: TenantId) {
  const { rows } = await admin.query<{
    name: string;
    currency: string;
    timezone: string;
    gstin: string | null;
  }>(
    "select name, currency, timezone, gstin from tenants where id = $1",
    [id],
  );
  return rows[0]!;
}

beforeAll(async () => {
  // audit_log.actor_id references users(id); mint a real actor row.
  await admin.query(
    "insert into users (id, phone) values ($1, $2) on conflict do nothing",
    [actorId, `+9198${String(Date.now()).slice(-8)}`],
  );
  await admin.query(
    `insert into tenants (id, slug, name, status, timezone, currency, gstin) values
       ($1, $2, 'Profile Test Academy', 'active', 'Asia/Kolkata', 'INR', null),
       ($3, $4, 'Other Academy', 'active', 'Asia/Kolkata', 'INR', '29AAAAA0000A1Z5')`,
    [tenantA, `profile-${RUN}`, tenantB, `profile-b-${RUN}`],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [locationId, tenantA],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Profile Member')",
    [personId, tenantA],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberId, tenantA, personId, locationId, `PRO-${RUN}`],
  );
  // An issued invoice carrying the old (wrong) GSTIN snapshot.
  await admin.query(
    `insert into invoices (id, tenant_id, location_id, member_id, invoice_number, financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise, status, gstin)
     values ($1, $2, $3, $4, $5, '2026-27', '2026-09-01', '2026-09-10', 100000, 0, 100000, 'issued', '27WRONG1234F1Z5')`,
    [invoiceId, tenantA, locationId, memberId, `PR-${RUN}-1`],
  );
});

afterAll(async () => {
  for (const tenant of [tenantA, tenantB]) {
    await admin.query("delete from invoices where tenant_id = $1", [tenant]);
    await admin.query("delete from members where tenant_id = $1", [tenant]);
    await admin.query("delete from persons where tenant_id = $1", [tenant]);
    await admin.query("delete from locations where tenant_id = $1", [tenant]);
    await deleteAuditRowsForTenant(admin, tenant);
  }
  await admin.query("delete from tenants where id = any($1::uuid[])", [
    [tenantA, tenantB],
  ]);
  await admin.end();
});

describe("getTenantProfile", () => {
  it("returns the tenant's editable identity fields", async () => {
    const profile = await getTenantProfile({ tenantId: tenantA });
    expect(profile).toEqual({
      name: "Profile Test Academy",
      currency: "INR",
      timezone: "Asia/Kolkata",
      gstin: null,
    });
  });
});

describe("updateTenantProfile", () => {
  it("fixes a typo'd GSTIN, normalises case and writes an audit row", async () => {
    const result = await updateTenantProfile(ctxA, {
      gstin: "27abcde1234f1z5",
    });
    expect(result).toEqual({ kind: "ok" });

    expect((await tenantRow(tenantA)).gstin).toBe("27ABCDE1234F1Z5");

    const audit = await admin.query<{
      action: string;
      before: { gstin: string | null };
      after: { gstin: string | null };
      changed_fields: string[];
    }>(
      "select action, before, after, changed_fields from audit_log where tenant_id = $1 and action = 'tenant.profile.update' order by created_at desc limit 1",
      [tenantA],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.before.gstin).toBeNull();
    expect(audit.rows[0]!.after.gstin).toBe("27ABCDE1234F1Z5");
    expect(audit.rows[0]!.changed_fields).toContain("gstin");
  });

  it("leaves already-issued invoice snapshots untouched", async () => {
    await updateTenantProfile(ctxA, { name: "Profile Test Academy Renamed" });
    const { rows } = await admin.query<{ gstin: string | null; status: string }>(
      "select gstin, status from invoices where id = $1",
      [invoiceId],
    );
    expect(rows[0]!.gstin).toBe("27WRONG1234F1Z5");
    expect(rows[0]!.status).toBe("issued");
    expect((await tenantRow(tenantA)).name).toBe("Profile Test Academy Renamed");
  });

  it("rejects an invalid GSTIN with a field-level message and writes nothing", async () => {
    const before = await tenantRow(tenantA);
    const result = await updateTenantProfile(ctxA, { gstin: "NOT-A-GSTIN" });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("invalid");
    expect(result.message).toMatch(/gstin/i);
    expect(await tenantRow(tenantA)).toEqual(before);
  });

  it("rejects a bad currency and an unknown timezone", async () => {
    const badCurrency = await updateTenantProfile(ctxA, { currency: "rupees" });
    expect(badCurrency.kind).toBe("error");
    const badZone = await updateTenantProfile(ctxA, { timezone: "Mars/Olympus" });
    expect(badZone.kind).toBe("error");
  });

  it("clears the GSTIN with an empty string", async () => {
    const result = await updateTenantProfile(ctxA, { gstin: "" });
    expect(result).toEqual({ kind: "ok" });
    expect((await tenantRow(tenantA)).gstin).toBeNull();
  });

  it("is tenant-scoped — another tenant's profile is unchanged", async () => {
    const before = await tenantRow(tenantB);
    await updateTenantProfile(ctxA, { name: "Scoped Update" });
    expect(await tenantRow(tenantB)).toEqual(before);
  });

  it("refuses without an actor", async () => {
    const result = await updateTenantProfile(
      { tenantId: tenantA, userId: undefined },
      { name: "No Actor" },
    );
    expect(result.kind).toBe("error");
  });
});
