import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId } from "@/lib/ids";
import {
  financialYearFor,
  formatInvoiceNumber,
} from "@/lib/invoice-numbering";

// C-31 — gapless invoice numbering. The done-when is a concurrency
// test: fifty parallel invoices produce fifty sequential numbers with
// no gaps or duplicates. Rollback-never-burns is proven too.

let container: StartedPostgreSqlContainer;
let admin: Pool;

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const RUN = Date.now().toString(36);

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";

  process.env.DATABASE_URL = `postgresql://app_login:${encodeURIComponent(appPassword)}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(adminUri, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(adminUri);

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'Inv A', 'active'), ($3, $4, 'Inv B', 'active')",
    [tenantA, `inv-a-${RUN}`, tenantB, `inv-b-${RUN}`],
  );
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("financial year and formatting", () => {
  it("runs April 1 to March 31", () => {
    expect(financialYearFor("2026-04-01")).toBe("2026-27");
    expect(financialYearFor("2026-12-31")).toBe("2026-27");
    expect(financialYearFor("2027-01-15")).toBe("2026-27");
    expect(financialYearFor("2027-03-31")).toBe("2026-27");
    expect(financialYearFor("2027-04-01")).toBe("2027-28");
  });

  it("prints the FY and zero-pads the serial within GST's 16 chars", () => {
    expect(formatInvoiceNumber("2026-27", 1)).toBe("INV/2026-27/0001");
    expect(formatInvoiceNumber("2026-27", 42)).toBe("INV/2026-27/0042");
    expect(formatInvoiceNumber("2026-27", 9999)).toBe("INV/2026-27/9999");
    expect(formatInvoiceNumber("2026-27", 9999).length).toBeLessThanOrEqual(16);
  });
});

describe("gapless allocation", () => {
  it("allocates sequentially inside one transaction flow", async () => {
    const { withTenant } = await import("@/db/tenant");
    const { allocateInvoiceNumber } = await import(
      "@/lib/services/invoice-numbering"
    );

    const numbers: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const allocated = await withTenant(tenantA, (tx) =>
        allocateInvoiceNumber(tx, tenantA, "2026-09-14"),
      );
      numbers.push(allocated.invoiceNumber);
    }
    expect(numbers).toEqual([
      "INV/2026-27/0001",
      "INV/2026-27/0002",
      "INV/2026-27/0003",
    ]);
  });

  it("produces fifty sequential numbers with no gaps under concurrency", async () => {
    const { withTenant } = await import("@/db/tenant");
    const { allocateInvoiceNumber } = await import(
      "@/lib/services/invoice-numbering"
    );
    const FY = "2027-28";

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        withTenant(tenantA, (tx) =>
          allocateInvoiceNumber(tx, tenantA, "2027-05-10"),
        ),
      ),
    );

    const serials = results
      .map((r) => r.serial)
      .sort((a, b) => a - b);
    expect(serials).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(results.map((r) => r.invoiceNumber)).size).toBe(50);
    for (const result of results) expect(result.financialYear).toBe(FY);
  });

  it("does not burn a number when the allocating transaction rolls back", async () => {
    const { withTenant } = await import("@/db/tenant");
    const { allocateInvoiceNumber } = await import(
      "@/lib/services/invoice-numbering"
    );

    await expect(
      withTenant(tenantA, async (tx) => {
        await allocateInvoiceNumber(tx, tenantA, "2026-09-14");
        throw new Error("invoice failed after numbering");
      }),
    ).rejects.toThrow("invoice failed after numbering");

    const next = await withTenant(tenantA, (tx) =>
      allocateInvoiceNumber(tx, tenantA, "2026-09-14"),
    );
    // The rolled-back attempt at 2026-27 was after 0003; the next
    // successful one is 0004 — the rolled-back serial is reused, not
    // skipped.
    expect(next.invoiceNumber).toBe("INV/2026-27/0004");
  });

  it("keeps separate series per tenant and per financial year", async () => {
    const { withTenant } = await import("@/db/tenant");
    const { allocateInvoiceNumber } = await import(
      "@/lib/services/invoice-numbering"
    );

    const forB = await withTenant(tenantB, (tx) =>
      allocateInvoiceNumber(tx, tenantB, "2026-09-14"),
    );
    expect(forB.invoiceNumber).toBe("INV/2026-27/0001");

    const nextFy = await withTenant(tenantA, (tx) =>
      allocateInvoiceNumber(tx, tenantA, "2028-04-02"),
    );
    expect(nextFy.invoiceNumber).toBe("INV/2028-29/0001");
  });

  it("keeps counters tenant-isolated under RLS", async () => {
    const { withTenant } = await import("@/db/tenant");
    const { invoiceNumberCounters } = await import(
      "@/db/schema/invoice-numbering"
    );

    const rowsForB = await withTenant(tenantB, (tx) =>
      tx.select().from(invoiceNumberCounters),
    );
    expect(rowsForB.every((row) => row.tenantId === tenantB)).toBe(true);
    expect(rowsForB.some((row) => row.tenantId === tenantA)).toBe(false);
  });
});
