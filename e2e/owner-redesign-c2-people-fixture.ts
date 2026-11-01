#!/usr/bin/env tsx
/**
 * Owner redesign · People lane (C2) — the browser-evidence fixture.
 *
 * The rendered-geometry probe needs the OWNER people surfaces to have
 * something to measure:
 *
 *   * a member whose name is long enough to need truncation in the
 *     directory row (the demo seed's names are short);
 *   * an issued invoice with an outstanding balance, so the Fees hub
 *     renders a real invoice row and its collection context.
 *
 * This fixture writes SYNTHETIC rows into the DISPOSABLE browser
 * database of this lane. It never touches a development or customer
 * database, and it is never used by the application.
 *
 * SAFETY — the guard below is checked BEFORE the first read or write:
 * `AQUA_HARNESS_TEST_DATABASE=disposable` and `AQUA_NO_DOTENV=1`, and
 * the database named by the connection URLs must be a LOCAL
 * `aqua_test_*` database.
 */
import { Pool } from "pg";
import { eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { pool } from "@/db/client";
import { enquiries, locations, members } from "@/db/schema";
import { createMember } from "@/lib/services/register";
import { issueInvoiceInTx } from "@/lib/services/invoice-issue";
import { asTenantId, type UserId } from "@/lib/ids";
import { requireMigrationUrl } from "@/lib/env";

const SLUG = "demo-academy";
const LONG_NAME = "Aaradhya Balasubramanian Iyer-Chandrasekhar";
const LONG_CODE = "AQUA-999";
/** A deliberately long location name: the picker's INTRINSIC width must
 *  not be what sizes it, so the flex-row contract is measurable. */
const LONG_LOCATION_NAME =
  "Demo Annex Community Swimming Academy And Fitness Centre";

function assertDisposable(): void {
  if (process.env.AQUA_HARNESS_TEST_DATABASE !== "disposable") {
    throw new Error("Refusing to seed: the disposable-test marker is missing.");
  }
  if (process.env.AQUA_NO_DOTENV !== "1") {
    throw new Error("Refusing to seed: the dotenv loader must be disabled.");
  }
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("Refusing to seed: the target is not local.");
  }
  if (!url.pathname.startsWith("/aqua_test_")) {
    throw new Error("Refusing to seed: the target is not a disposable test database.");
  }
}

async function main() {
  assertDisposable();
  const admin = new Pool({ connectionString: requireMigrationUrl("e2e fixture") });
  const { rows: tenantRows } = await admin.query<{ id: string }>(
    "select id from tenants where slug = $1",
    [SLUG],
  );
  const tenantRow = tenantRows[0];
  if (!tenantRow) {
    throw new Error("The demo tenant is missing — run `pnpm seed` first.");
  }
  const tenantId = asTenantId(tenantRow.id);

  const locationId = await withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(isNull(locations.deletedAt))
      .limit(1);
    return rows[0]?.id ?? null;
  });
  if (!locationId) throw new Error("The demo tenant has no location.");

  // A long-named member, so the directory row's truncation and the
  // phone/metadata line can be measured with real content.
  const existing = await withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ id: members.id })
      .from(members)
      .where(eq(members.memberCode, LONG_CODE))
      .limit(1);
    return rows[0]?.id ?? null;
  });

  let memberId = existing;
  if (!memberId) {
    const created = await createMember(
      { tenantId, userId: undefined as unknown as UserId },
      {
        fullName: LONG_NAME,
        dateOfBirth: "1990-06-11",
        gender: "female",
        locationId,
        memberCode: LONG_CODE,
        phone: "+919812340099",
        consents: [
          {
            purpose: "processing",
            policyVersion: "2026.1",
            evidence: { channel: "e2e-fixture" },
          },
        ],
      },
    );
    if (!created.ok) throw new Error(`Fixture: createMember failed — ${created.error}`);
    memberId = created.memberId;
  }

  // A SECOND location, so the member's facility picker renders (the
  // facilities panel only offers a picker when another location exists).
  const secondLocation = await withTenant(tenantId, async (tx) => {
    const existing = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.name, LONG_LOCATION_NAME))
      .limit(1);
    if (existing[0]) return existing[0].id;
    const [created] = await tx
      .insert(locations)
      .values({ tenantId, name: LONG_LOCATION_NAME, kind: "club", isPrimary: false })
      .returning({ id: locations.id });
    return created.id;
  });
  console.log(`fixture second location → ${secondLocation}`);

  // One ENQUIRY in the "contacted" stage, so the enquiry detail route
  // and its trial workflow are reachable in the browser check.
  const enquiryId = await withTenant(tenantId, async (tx) => {
    const existing = await tx
      .select({ id: enquiries.id })
      .from(enquiries)
      .where(eq(enquiries.fullName, "Browser Check Enquiry"))
      .limit(1);
    if (existing[0]) return existing[0].id;
    const [created] = await tx
      .insert(enquiries)
      .values({
        tenantId,
        fullName: "Browser Check Enquiry",
        phone: "+919812340077",
        source: "online",
        stage: "contacted",
        locationId,
      })
      .returning({ id: enquiries.id });
    return created.id;
  });
  console.log(`fixture enquiry → ${enquiryId}`);

  // One issued invoice with an outstanding balance.
  await withTenant(tenantId, async (tx) => {
    const issued = await issueInvoiceInTx(
      tx,
      {
        tenantId,
        locationId,
        memberId,
        issuedOn: "2026-10-01",
        dueOn: "2026-10-10",
        lines: [
          {
            description: "Monthly Swim membership",
            amountPaise: 250000,
            taxRateBp: 1200,
          },
        ],
      },
      null,
    );
    if (!issued.ok) throw new Error(`Fixture: invoice failed — ${issued.error}`);
    console.log(`fixture invoice → ${issued.invoiceNumber} (${issued.totalPaise} paise)`);
  });

  console.log(`fixture ready → tenant ${tenantId}, member ${memberId}`);
  await admin.end();
  await pool.end();
}

main().catch((error) => {
  console.error("fixture failed:", error);
  process.exitCode = 1;
});
