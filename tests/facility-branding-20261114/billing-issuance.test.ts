import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "@/tests/db/privileged-fixture";
import { asTenantId } from "@/lib/ids";
import { withTenant } from "@/db/tenant";
import { issueInvoiceInTx } from "@/lib/services/invoice-issue";
import { sql } from "drizzle-orm";

const tenantId = asTenantId(uuidv7());
const locationId = uuidv7();
const registrationId = uuidv7();
const address = { line1: "Site road", line2: null, city: "Bengaluru", postalCode: "560001" };
const rollback = new Error("rollback test invoice");

beforeAll(async () => {
  await admin.query("insert into tenants (id, slug, name, status, gstin) values ($1, $2, 'Billing test', 'active', '27ABCDE1234F1Z5')", [tenantId, `billing-site-${tenantId}`]);
  await admin.query("insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Site', true)", [locationId, tenantId]);
  await admin.query("insert into billing_registrations (id, tenant_id, legal_name, legal_address, state_code, gstin) values ($1, $2, 'Site issuer', $3::jsonb, '29', '29ABCDE1234F1Z5')", [registrationId, tenantId, JSON.stringify(address)]);
  await admin.query("insert into location_billing_settings (tenant_id, location_id, state_code, facility_billing_enabled, mode, registration_id) values ($1, $2, '29', true, 'registered_override', $3)", [tenantId, locationId, registrationId]);
});

afterAll(async () => {
  await admin.query("delete from locations where id = $1 and tenant_id = $2", [locationId, tenantId]);
  await admin.query("delete from tenants where id = $1", [tenantId]);
  await admin.end();
});

describe("enabled site invoice issuer", () => {
  it("issues the site registration and immutable issuer snapshot, not the club GSTIN", async () => {
    let saved: unknown;
    try {
      await withTenant(tenantId, async (tx) => {
        const result = await issueInvoiceInTx(tx, { tenantId, locationId, payerKind: "guest", guestName: "Guest", source: "other", issuedOn: "2026-11-14", dueOn: "2026-11-14", lines: [{ description: "Local service", amountPaise: 10000 }] }, null);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error);
        const resultRows = await tx.execute<{ gstin: string; issuer_snapshot_version: number; issuer_legal_name: string; issuer_legal_address: unknown; issuer_state_code: string }>(
          sql`select gstin, issuer_snapshot_version, issuer_legal_name, issuer_legal_address, issuer_state_code from invoices where id = ${result.invoiceId}`,
        );
        saved = resultRows.rows[0];
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    expect(saved).toMatchObject({ gstin: "29ABCDE1234F1Z5", issuer_snapshot_version: 1, issuer_legal_name: "Site issuer", issuer_legal_address: address, issuer_state_code: "29" });
  });

  it("refuses issuance for a deleted site", async () => {
    let issued = true;
    try {
      await withTenant(tenantId, async (tx) => {
        await tx.execute(sql`update locations set deleted_at = now() where id = ${locationId} and tenant_id = ${tenantId}`);
        const result = await issueInvoiceInTx(tx, { tenantId, locationId, payerKind: "guest", guestName: "Guest", source: "other", issuedOn: "2026-11-14", dueOn: "2026-11-14", lines: [{ description: "Local service", amountPaise: 10000 }] }, null);
        issued = result.ok;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    expect(issued).toBe(false);
  });
});
