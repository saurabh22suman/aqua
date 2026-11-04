// Backend validation 2026-10-29 — lane E (jobs, integrations and privacy).
//
// F9 — the token-scoped parent receipt must not be storable by a
// browser or any shared cache.
//
// The gap: app/p/[token]/route.ts (the parent page) answers with
// "Cache-Control: no-store" and says why: the page carries personal
// data about a specific child. Its sibling route,
// app/p/[token]/receipt/[paymentId]/route.ts, answered with
// "cache-control: private, max-age=300" — so the SAME signed
// credential produced two different caching policies, and the receipt
// (a child's payment PDF) stayed in the browser cache for five
// minutes after the page was closed. On a shared device that is the
// child's financial data left behind.
//
// This file drives the REAL route handler against the REAL database:
// the token is signed with the real signing service, and the receipt
// is served by the real receipt service (app_login, RLS on). Fixture
// setup/cleanup runs through the privileged fixture pool
// (tests/db/privileged-fixture.ts).
//
// Agent-owned file.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { asMemberId, asTenantId } from "@/lib/ids";
import { signParentLinkToken } from "@/lib/services/parent-link";
import { privilegedFixturePool } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

const { GET } = await import("@/app/p/[token]/receipt/[paymentId]/route");

const RUN = Date.now().toString(36);
const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const locA = uuidv7();
const locB = uuidv7();
const personA = uuidv7();
const personSibling = uuidv7();
const personB = uuidv7();
const childA = asMemberId(uuidv7());
const sibling = asMemberId(uuidv7());
const childB = asMemberId(uuidv7());
const planA = uuidv7();

let paymentChildA = "";
let paymentSibling = "";
let paymentOtherTenant = "";

async function seedMember(
  tenant: string,
  person: string,
  member: string,
  location: string,
  code: string,
): Promise<void> {
  await privilegedFixturePool.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [member, tenant, person, location, code],
  );
}

async function seedPayment(
  tenant: string,
  member: string,
  location: string,
  invoiceNumber: string,
  tag: string,
): Promise<string> {
  await privilegedFixturePool.query(
    `insert into invoices (id, tenant_id, location_id, member_id, invoice_number, financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise, paid_paise, status)
     values (gen_random_uuid(), $1, $2, $3, $4, '2026-27', '2026-09-01', '2026-09-10', 100000, 0, 100000, 100000, 'paid')`,
    [tenant, location, member, invoiceNumber],
  );
  const rows = await privilegedFixturePool.query<{ id: string }>(
    `insert into payments (id, tenant_id, member_id, location_id, invoice_id, amount_paise, method, received_at, status)
     select gen_random_uuid(), $1, $2, $3, i.id, 100000, 'cash', '2026-09-05T10:00:00Z', 'captured'
       from invoices i where i.tenant_id = $1 and i.invoice_number = $4
     returning id::text`,
    [tenant, member, location, invoiceNumber],
  );
  void tag;
  return rows.rows[0]!.id;
}

beforeAll(async () => {
  await privilegedFixturePool.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'E Receipt A', 'active', 'Asia/Kolkata'),
       ($3, $4, 'E Receipt B', 'active', 'Asia/Kolkata')`,
    [tenantA, `e-rcpt-a-${RUN}`, tenantB, `e-rcpt-b-${RUN}`],
  );
  await privilegedFixturePool.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $2, 'Main', true), ($3, $4, 'Main', true)`,
    [locA, tenantA, locB, tenantB],
  );
  await privilegedFixturePool.query(
    `insert into persons (id, tenant_id, full_name, date_of_birth) values
       ($1, $2, 'Receipt Child', '2015-01-01'),
       ($3, $2, 'Receipt Sibling', '2016-01-01'),
       ($4, $5, 'Other Child', '2015-01-01')`,
    [personA, tenantA, personSibling, personB, tenantB],
  );
  await privilegedFixturePool.query(
    "insert into membership_plans (id, tenant_id, location_id, name, kind, duration_days, amount_paise) values ($1, $2, $3, 'Monthly', 'duration', 30, 100000)",
    [planA, tenantA, locA],
  );
  await seedMember(tenantA, personA, childA, locA, `EA${RUN}`);
  await seedMember(tenantA, personSibling, sibling, locA, `ES${RUN}`);
  await seedMember(tenantB, personB, childB, locB, `EB${RUN}`);

  paymentChildA = await seedPayment(tenantA, childA, locA, `IA${RUN}`, "child");
  paymentSibling = await seedPayment(tenantA, sibling, locA, `IS${RUN}`, "sibling");
  paymentOtherTenant = await seedPayment(tenantB, childB, locB, `IB${RUN}`, "other");
});

afterAll(async () => {
  for (const tenant of [tenantA, tenantB]) {
    await privilegedFixturePool.query("delete from receipts where tenant_id = $1::uuid", [tenant]);
    await privilegedFixturePool.query("delete from payments where tenant_id = $1::uuid", [tenant]);
    await privilegedFixturePool.query("delete from invoices where tenant_id = $1::uuid", [tenant]);
    await privilegedFixturePool.query("delete from members where tenant_id = $1::uuid", [tenant]);
    await privilegedFixturePool.query("delete from persons where tenant_id = $1::uuid", [tenant]);
    await privilegedFixturePool.query("delete from membership_plans where tenant_id = $1::uuid", [tenant]);
    await privilegedFixturePool.query("delete from locations where tenant_id = $1::uuid", [tenant]);
    await deleteAuditRowsForTenant(privilegedFixturePool, tenant);
    await privilegedFixturePool.query("delete from tenants where id = $1::uuid", [tenant]);
  }
  await privilegedFixturePool.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

function request(path: string): Request {
  return new Request(`http://localhost${path}`);
}

async function call(token: string, paymentId: string): Promise<Response> {
  return GET(request(`/p/${token}/receipt/${paymentId}`) as never, {
    params: Promise.resolve({ token, paymentId }),
  });
}

describe("F9 — the parent receipt is not storable", () => {
  it("serves the token's own payment and refuses to let it be stored", async () => {
    const { token } = signParentLinkToken({ tenantId: tenantA, personId: childA });
    const response = await call(token, paymentChildA);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");

    // The parent's own policy (app/p/[token]/route.ts): the page
    // carries personal data about a specific child, so it is
    // no-store. The receipt is the same credential and the same data.
    const cacheControl = response.headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("no-store");
    expect(cacheControl).not.toContain("max-age");
  });

  it("serves the stored copy on a second read without changing the policy", async () => {
    const { token } = signParentLinkToken({ tenantId: tenantA, personId: childA });
    const first = await call(token, paymentChildA);
    expect(first.status).toBe(200);
    const second = await call(token, paymentChildA);
    expect(second.status).toBe(200);
    expect(second.headers.get("cache-control")).toContain("no-store");
  });

  it("refuses a sibling's payment under the same token", async () => {
    const { token } = signParentLinkToken({ tenantId: tenantA, personId: childA });
    const response = await call(token, paymentSibling);
    expect(response.status).toBe(404);
  });

  it("refuses another tenant's payment under the same token", async () => {
    const { token } = signParentLinkToken({ tenantId: tenantA, personId: childA });
    const response = await call(token, paymentOtherTenant);
    expect(response.status).toBe(404);
  });

  it("refuses a forged token", async () => {
    const { token } = signParentLinkToken({ tenantId: tenantA, personId: childA });
    const forged = `${token.slice(0, -2)}xx`;
    const response = await call(forged, paymentChildA);
    expect(response.status).toBe(404);
  });

  it("refuses an expired token", async () => {
    const { token } = signParentLinkToken({
      tenantId: tenantA,
      personId: childA,
      ttlSeconds: -60,
    });
    const response = await call(token, paymentChildA);
    expect(response.status).toBe(404);
  });

  it("refuses a forged payment id", async () => {
    const { token } = signParentLinkToken({ tenantId: tenantA, personId: childA });
    const response = await call(token, uuidv7());
    expect(response.status).toBe(404);
  });

  it("the receipt route stays a zero-JavaScript route handler", async () => {
    // The parent page must ship zero client JavaScript
    // (docs/architecture.md §11.3). Its receipt sibling is a route
    // handler too — it must not introduce a client bundle, a script
    // tag or a third-party origin. The production-artefact proof
    // (pnpm e2e:parent-link-zero-js) runs once on the combined
    // integration build; this is the static pin that catches an edit
    // that would break it before then.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/p/[token]/receipt/[paymentId]/route.ts", "utf8");
    expect(source).not.toContain("use client");
    expect(source).not.toMatch(/<script/i);
    expect(source).not.toMatch(/https?:\/\/(?!localhost)/);
  });
});
