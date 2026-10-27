// B6 — reading the synthetic records back out of a database.
//
// The drill compares the source's rows with the destination's rows
// field by field. Counts are not enough: a restored row with the
// right tenant and the wrong phone number is not a restored row.
//
// Money is compared as the string PostgreSQL returns for a bigint
// column, so "118000" is compared with "118000" and never with a
// float that might have been rounded on the way through.

import type { Pool } from "pg";
import type { SyntheticFixture, TenantFixture } from "./seed";

export type TenantRecord = {
  tenant: { id: string; slug: string; name: string; status: string };
  location: {
    id: string;
    name: string;
    kind: string;
    isPrimary: boolean;
  };
  role: { id: string; key: string };
  user: { id: string; phone: string };
  person: { id: string; fullName: string };
  member: {
    id: string;
    memberCode: string;
    status: string;
    personId: string;
    locationId: string;
  };
  membership: {
    id: string;
    userId: string;
    roleId: string;
    status: string;
    allLocations: boolean;
  };
  invoice: {
    id: string;
    invoiceNumber: string;
    subtotalPaise: string;
    taxPaise: string;
    totalPaise: string;
    paidPaise: string;
    status: string;
  };
  payment: {
    id: string;
    amountPaise: string;
    method: string;
    reference: string | null;
    status: string;
  };
};

export type MoneyComparison = {
  expectedTotalPaise: string;
  restoredInvoiceTotalPaise: string;
  restoredPaymentAmountPaise: string;
  exact: boolean;
};

/** Reads both synthetic tenants out of a database, in a stable order. */
export async function readTenantRecords(
  pool: Pool,
  fixture: SyntheticFixture,
): Promise<TenantRecord[]> {
  const records: TenantRecord[] = [];
  for (const tenant of [fixture.tenantA, fixture.tenantB]) {
    records.push(await readTenantRecord(pool, tenant));
  }
  return records;
}

async function readTenantRecord(
  pool: Pool,
  tenant: TenantFixture,
): Promise<TenantRecord> {
  const tenantRow = await pool.query<{
    id: string;
    slug: string;
    name: string;
    status: string;
  }>("select id, slug, name, status from tenants where id = $1", [tenant.tenantId]);
  const locationRow = await pool.query<{
    id: string;
    name: string;
    kind: string;
    is_primary: boolean;
  }>(
    "select id, name, kind, is_primary from locations where id = $1",
    [tenant.locationId],
  );
  const roleRow = await pool.query<{ id: string; key: string }>(
    "select id, key from roles where id = $1",
    [tenant.roleId],
  );
  const userRow = await pool.query<{ id: string; phone: string }>(
    "select id, phone from users where id = $1",
    [tenant.userId],
  );
  const personRow = await pool.query<{ id: string; full_name: string }>(
    "select id, full_name from persons where id = $1",
    [tenant.personId],
  );
  const memberRow = await pool.query<{
    id: string;
    member_code: string;
    status: string;
    person_id: string;
    location_id: string;
  }>(
    "select id, member_code, status, person_id, location_id from members where id = $1",
    [tenant.memberId],
  );
  const membershipRow = await pool.query<{
    id: string;
    user_id: string;
    role_id: string;
    status: string;
    all_locations: boolean;
  }>(
    "select id, user_id, role_id, status, all_locations from tenant_memberships where id = $1",
    [tenant.membershipId],
  );
  const invoiceRow = await pool.query<{
    id: string;
    invoice_number: string;
    subtotal_paise: string;
    tax_paise: string;
    total_paise: string;
    paid_paise: string;
    status: string;
  }>(
    `select id, invoice_number, subtotal_paise, tax_paise, total_paise, paid_paise, status
       from invoices where id = $1`,
    [tenant.invoiceId],
  );
  const paymentRow = await pool.query<{
    id: string;
    amount_paise: string;
    method: string;
    reference: string | null;
    status: string;
  }>(
    "select id, amount_paise, method, reference, status from payments where id = $1",
    [tenant.paymentId],
  );

  const location = one(locationRow, "location");
  const role = one(roleRow, "role");
  const user = one(userRow, "user");
  const person = one(personRow, "person");
  const member = one(memberRow, "member");
  const membership = one(membershipRow, "membership");
  const invoice = one(invoiceRow, "invoice");
  const payment = one(paymentRow, "payment");

  return {
    tenant: one(tenantRow, "tenant"),
    location: {
      id: location.id,
      name: location.name,
      kind: location.kind,
      isPrimary: location.is_primary,
    },
    role: { id: role.id, key: role.key },
    user: { id: user.id, phone: user.phone },
    person: { id: person.id, fullName: person.full_name },
    member: {
      id: member.id,
      memberCode: member.member_code,
      status: member.status,
      personId: member.person_id,
      locationId: member.location_id,
    },
    membership: {
      id: membership.id,
      userId: membership.user_id,
      roleId: membership.role_id,
      status: membership.status,
      allLocations: membership.all_locations,
    },
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoice_number,
      subtotalPaise: invoice.subtotal_paise,
      taxPaise: invoice.tax_paise,
      totalPaise: invoice.total_paise,
      paidPaise: invoice.paid_paise,
      status: invoice.status,
    },
    payment: {
      id: payment.id,
      amountPaise: payment.amount_paise,
      method: payment.method,
      reference: payment.reference,
      status: payment.status,
    },
  };
}

function one<T>(result: { rows: T[] }, label: string): T {
  if (result.rows.length !== 1) {
    throw new Error(
      `Expected exactly one restored ${label} row, found ${result.rows.length}.`,
    );
  }
  return result.rows[0]!;
}

/**
 * Compares the restored money against what was seeded. The expected
 * value is the fixture's, and the restored value is what PostgreSQL
 * returned — a string, because the column is a bigint.
 */
export function compareMoney(
  records: TenantRecord[],
  fixture: SyntheticFixture,
): MoneyComparison {
  const expected = fixture.tenantA.totalPaise.toString();
  const invoice = records.find((r) => r.invoice.id === fixture.tenantA.invoiceId);
  const payment = records.find((r) => r.payment.id === fixture.tenantA.paymentId);
  const restoredInvoice = invoice?.invoice.totalPaise ?? "missing";
  const restoredPayment = payment?.payment.amountPaise ?? "missing";
  return {
    expectedTotalPaise: expected,
    restoredInvoiceTotalPaise: restoredInvoice,
    restoredPaymentAmountPaise: restoredPayment,
    exact:
      restoredInvoice === expected &&
      restoredPayment === expected &&
      fixture.tenantB.totalPaise.toString() === expected,
  };
}
