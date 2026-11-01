#!/usr/bin/env tsx
/**
 * Owner redesign · System lane — the browser-evidence fixture.
 *
 * The rendered-geometry probe needs the OWNER surfaces to have something
 * to measure:
 *
 *   * a second LOCATION, so the facility switcher renders at all (the
 *     switcher renders itself away for a single-location tenant);
 *   * CAPTURED PAYMENTS in the current period, so the payment mix draws
 *     a donut and a legend instead of its empty state.
 *
 * This fixture writes SYNTHETIC rows into the DISPOSABLE browser
 * database of this lane. It never touches a development or customer
 * database, and it is never used by the application.
 *
 * SAFETY — the guard below is checked BEFORE the first read or write:
 *
 *   1. AQUA_HARNESS_TEST_DATABASE=disposable and AQUA_NO_DOTENV=1, the
 *      two markers the harness writes into its private profile;
 *   2. both connection URLs must name a LOCAL host and the SAME
 *      aqua_test_* database;
 *   3. the runtime URL must use the app_login role and the migration URL
 *      the aqua role;
 *   4. the ACTUAL current_database() and current_user() of both
 *      connections must match that database and role — the URL is a
 *      claim, the session is the proof.
 *
 * The privileged (migration) connection is used for the ONE lookup that
 * the application role cannot make (the tenant catalogue row by slug).
 * Every tenant-scoped write runs inside withTenant(), with the
 * application role and the tenant RLS context.
 */
import { Pool } from "pg";
import { assertDisposableTarget, assertSession } from "@/tests/db/owner-browser-fixture";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { pool } from "@/db/client";
import { locations, members, invoices, payments } from "@/db/schema";
import { asTenantId } from "@/lib/ids";

const SLUG = process.env.AQUA_E2E_TENANT_SLUG ?? "demo-academy";
const SECOND_LOCATION = "Andheri";

async function main() {
  const guard = assertDisposableTarget();
  const admin = new Pool({ connectionString: guard.migration.toString() });
  try {
    const identity = await assertSession(admin, guard.database, ["aqua"], "the migration connection");
    const found = await admin
      .query<{ id: string }>(
        `select id::text as id from tenants where slug = $1 limit 1`,
        [SLUG],
      )
      .then((result) => result.rows);
    const tenant = found[0];
    if (!tenant) throw new Error(`no tenant with the slug ${SLUG}`);
    const tenantId = tenant.id;

    await withTenant(tenantId, async (tx) => {
      const scoped = asTenantId(tenantId);
      // 1 — a second location, so the facility switcher exists.
      const existing = await tx
        .select({ id: locations.id, name: locations.name })
        .from(locations)
        .where(eq(locations.tenantId, scoped));
      if (!existing.some((row) => row.name === SECOND_LOCATION)) {
        await tx.insert(locations).values({
          tenantId: scoped,
          name: SECOND_LOCATION,
          kind: "club",
          isPrimary: false,
        });
        console.log(`second location "${SECOND_LOCATION}" added`);
      }
      const primary = existing[0];
      if (!primary) throw new Error("the tenant has no location");

      // 2 — captured payments, so the payment mix has a donut to draw.
      const already = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.tenantId, scoped));
      if (already.length > 0) {
        console.log(`payments already present (${already.length})`);
        return;
      }
      const rows = await tx
        .select({ id: members.id })
        .from(members)
        .where(eq(members.tenantId, scoped))
        .limit(6);
      if (rows.length === 0) throw new Error("the tenant has no members");

      const amounts = [840000n, 600000n, 380000n];
      const methods = ["cash", "upi", "card"] as const;
      const issuedOn = new Date().toISOString().slice(0, 10);
      for (const [index, member] of rows.entries()) {
        const amount = amounts[index % amounts.length]!;
        const method = methods[index % methods.length]!;
        const [invoice] = await tx
          .insert(invoices)
          .values({
            tenantId: scoped,
            locationId: primary.id,
            memberId: member.id,
            invoiceNumber: `DEMO/${issuedOn.replace(/-/g, "")}/${index + 1}`,
            financialYear: "2026-27",
            issuedOn,
            dueOn: issuedOn,
            subtotalPaise: amount,
            taxPaise: 0n,
            totalPaise: amount,
            paidPaise: amount,
            status: "paid",
            source: "membership",
          })
          .returning({ id: invoices.id });
        await tx.insert(payments).values({
          tenantId: scoped,
          invoiceId: invoice!.id,
          memberId: member.id,
          locationId: primary.id,
          amountPaise: amount,
          method,
          channel: "counter",
          receivedAt: new Date(),
          status: "captured",
          reference: method === "cash" ? null : `DEMO-${index + 1}`,
        });
      }
      console.log(`captured payments seeded for ${rows.length} members`);
    });

    console.log(
      `fixture ready: ${SLUG} (${identity.db}) has a second location and captured payments`,
    );
  } finally {
    // Both pools close, even on failure, so a seed error can never hold
    // the shared queue's slot.
    await admin.end().catch(() => {});
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
