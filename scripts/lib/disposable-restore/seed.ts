// B6 — the synthetic data the drill proves survives a backup.
//
// Two synthetic tenants, in one disposable database, with nothing in
// them that belongs to a real club: generated names, generated phone
// numbers, generated member codes, and money expressed in exact bigint
// paise.
//
// Two tenants, not one, because the interesting property of a restored
// database is not "the rows came back" — it is "the rows came back
// AND the second tenant's rows are still invisible to the first
// tenant's scope". One tenant cannot show that.
//
// The money is deliberately not round: a total of 118000 paise with a
// tax of 18000 paise proves that bigint paise survived a binary
// round trip without float rounding.

import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";

export type TenantFixture = {
  tenantId: string;
  slug: string;
  name: string;
  locationId: string;
  locationName: string;
  roleId: string;
  roleKey: string;
  userId: string;
  phone: string;
  personId: string;
  memberId: string;
  memberCode: string;
  membershipId: string;
  invoiceId: string;
  invoiceNumber: string;
  totalPaise: bigint;
  paidPaise: bigint;
  paymentId: string;
  paymentAmountPaise: bigint;
  paymentReference: string;
};

export type SyntheticFixture = {
  tenantA: TenantFixture;
  tenantB: TenantFixture;
};

/** Exact paise — never a float, never a rupee amount. */
const SUBTOTAL_PAISE = 100000n;
const TAX_PAISE = 18000n;
const TOTAL_PAISE = SUBTOTAL_PAISE + TAX_PAISE;

function buildTenantFixture(label: string, index: number): TenantFixture {
  return {
    tenantId: uuidv7(),
    slug: `drill-${label}-${index}`,
    name: `Drill ${label.toUpperCase()} Synthetic Club`,
    locationId: uuidv7(),
    locationName: `Drill ${label.toUpperCase()} Location`,
    roleId: uuidv7(),
    roleKey: "owner",
    userId: uuidv7(),
    phone: `+9199${String(10_000_000 + index)}`,
    personId: uuidv7(),
    memberId: uuidv7(),
    memberCode: `DRILL-${label.toUpperCase()}-001`,
    membershipId: uuidv7(),
    invoiceId: uuidv7(),
    invoiceNumber: `DR-${label.toUpperCase()}-0001`,
    totalPaise: TOTAL_PAISE,
    paidPaise: TOTAL_PAISE,
    paymentId: uuidv7(),
    paymentAmountPaise: TOTAL_PAISE,
    paymentReference: `DRILL-REF-${label.toUpperCase()}-0001`,
  };
}

/**
 * Writes the synthetic fixture into the source database.
 *
 * The writes go through the privileged connection because `tenants` and
 * every other tenant table is under FORCE ROW LEVEL SECURITY — this is
 * fixture setup, exactly like the seeded tenant rows in
 * tests/tier1/isolation.test.ts, and never a request path.
 */
export async function seedSyntheticFixture(
  adminUri: string,
): Promise<SyntheticFixture> {
  const pool = new Pool({ connectionString: adminUri });
  const tenantA = buildTenantFixture("a", 1);
  const tenantB = buildTenantFixture("b", 2);

  try {
    for (const tenant of [tenantA, tenantB]) {
      await pool.query(
        "insert into tenants (id, slug, name, status) values ($1, $2, $3, 'active')",
        [tenant.tenantId, tenant.slug, tenant.name],
      );
      await pool.query(
        "insert into locations (id, tenant_id, name, kind, is_primary) values ($1, $2, $3, 'club', true)",
        [tenant.locationId, tenant.tenantId, tenant.locationName],
      );
      await pool.query(
        "insert into roles (id, tenant_id, key, name, is_system) values ($1, $2, $3, $4, true)",
        [tenant.roleId, tenant.tenantId, tenant.roleKey, "Owner"],
      );
      await pool.query(
        "insert into users (id, phone) values ($1, $2)",
        [tenant.userId, tenant.phone],
      );
      await pool.query(
        "insert into persons (id, tenant_id, full_name) values ($1, $2, $3)",
        [tenant.personId, tenant.tenantId, `Drill ${tenant.name} Person`],
      );
      await pool.query(
        "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
        [
          tenant.memberId,
          tenant.tenantId,
          tenant.personId,
          tenant.locationId,
          tenant.memberCode,
        ],
      );
      await pool.query(
        "insert into tenant_memberships (id, tenant_id, user_id, role_id, all_locations, status) values ($1, $2, $3, $4, true, 'active')",
        [
          tenant.membershipId,
          tenant.tenantId,
          tenant.userId,
          tenant.roleId,
        ],
      );
      await pool.query(
        `insert into invoices
           (id, tenant_id, location_id, member_id, invoice_number, financial_year,
            issued_on, due_on, subtotal_paise, tax_paise, total_paise, paid_paise, status)
         values ($1, $2, $3, $4, $5, '2026-27', '2026-10-01', '2026-10-31',
                 $6, $7, $8, $8, 'paid')`,
        [
          tenant.invoiceId,
          tenant.tenantId,
          tenant.locationId,
          tenant.memberId,
          tenant.invoiceNumber,
          SUBTOTAL_PAISE.toString(),
          TAX_PAISE.toString(),
          TOTAL_PAISE.toString(),
        ],
      );
      await pool.query(
        `insert into payments
           (id, tenant_id, invoice_id, member_id, location_id, amount_paise, method, channel, reference, status)
         values ($1, $2, $3, $4, $5, $6, 'upi', 'counter', $7, 'captured')`,
        [
          tenant.paymentId,
          tenant.tenantId,
          tenant.invoiceId,
          tenant.memberId,
          tenant.locationId,
          TOTAL_PAISE.toString(),
          tenant.paymentReference,
        ],
      );
    }
  } finally {
    await pool.end();
  }

  return { tenantA, tenantB };
}
