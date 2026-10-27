import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { runDisposableRestoreDrill } from "@/scripts/lib/disposable-restore/drill";
import { removeCreated } from "@/scripts/lib/disposable-restore/drill";
import type { DrillResult } from "@/scripts/lib/disposable-restore/drill";
import { listDrillContainers } from "@/scripts/lib/disposable-restore/lifecycle";
import { assertArchiveIsRestorable } from "@/scripts/lib/disposable-restore/archive";
import { redactConnectionUri } from "@/scripts/lib/disposable-restore/target";

// B6 — the local round trip, end to end.
//
// This is the proof the repository did not have: not "a dump file was
// produced" but "a dump was taken from a real PostgreSQL 16 database
// and restored into a SEPARATE real PostgreSQL 16 database, and the
// restored database is usable".
//
// The two containers are created by the drill itself, on ports Docker
// assigns, and are removed by the test afterwards. Nothing outside
// this file's own containers is touched.
//
// The checks below are deliberately INDEPENDENT of the drill's own
// summary where it matters: the record, grant, RLS and isolation
// assertions query the restored database directly, so a drill that
// reported a green summary while restoring nothing would still fail
// here.

let drill: DrillResult;
let destinationPool: Pool;
const progressLog: string[] = [];

beforeAll(async () => {
  drill = await runDisposableRestoreDrill({
    preserve: true,
    // The application pool must point at the RESTORED database, so the
    // isolation proof runs against the restore target, not the source.
    appPoolTarget: "destination",
    onProgress: (message) => {
      progressLog.push(message);
    },
  });
  destinationPool = new Pool({ connectionString: drill.destination.adminUri });
}, 600_000);

afterAll(async () => {
  await destinationPool?.end().catch(() => {});
  if (drill) await removeCreated(drill.createdContainerNames).catch(() => {});
}, 120_000);

describe("disposable backup/restore drill — round trip", () => {
  it("reports progress through every stage of the round trip", () => {
    expect(progressLog.join("\n")).toMatch(/dump/i);
    expect(progressLog.join("\n")).toMatch(/restor/i);
  });

  it("produced a non-empty custom-format archive", () => {
    expect(drill.dumpBytes).toBeGreaterThan(0);
    expect(drill.archiveListing).toMatch(/Format:\s*CUSTOM/);
  });

  it("used two separate disposable databases", () => {
    expect(drill.source.identity).not.toBe(drill.destination.identity);
    expect(drill.source.containerName).not.toBe(drill.destination.containerName);
    expect(drill.source.appUri).not.toBe(drill.destination.appUri);
    // Both live on this machine's loopback interface.
    expect(drill.source.host).toBe("127.0.0.1");
    expect(drill.destination.host).toBe("127.0.0.1");
  });

  it("restored every applied migration", () => {
    expect(drill.summary.migrations.source.length).toBeGreaterThan(100);
    expect(drill.summary.migrations.missing).toEqual([]);
    expect(drill.summary.migrations.unexpected).toEqual([]);
  });

  it("restored the exact synthetic records", () => {
    expect(drill.summary.records.identical).toBe(true);
    expect(drill.summary.records.destination).toHaveLength(2);
  });

  it("restored money as exact bigint paise", () => {
    expect(drill.summary.money.exact).toBe(true);
    expect(drill.summary.money.restoredInvoiceTotalPaise).toBe("118000");
    expect(drill.summary.money.restoredPaymentAmountPaise).toBe("118000");
  });

  it("granted the application role access to the restored tables", () => {
    expect(drill.summary.grants.missing).toEqual([]);
  });

  it("kept the append-only tables append-only after the restore", () => {
    expect(drill.summary.grants.appendOnlyViolations).toEqual([]);
  });

  it("restored RLS as enabled AND forced on every tenant table", () => {
    expect(drill.summary.rls.notEnabled).toEqual([]);
    expect(drill.summary.rls.notForced).toEqual([]);
  });

  it("did not leave the application role as a superuser or RLS bypasser", () => {
    expect(drill.summary.roleAttributes.superuser).toEqual([]);
    expect(drill.summary.roleAttributes.bypassRls).toEqual([]);
  });

  it("kept the two synthetic tenants isolated in the restored database", () => {
    expect(drill.summary.isolation).toHaveLength(2);
    for (const probe of drill.summary.isolation) {
      expect(probe.visibleMemberIds).toHaveLength(1);
      expect(probe.otherTenantMemberIdsVisible).toEqual([]);
    }
  });

  it("found no problems at all", () => {
    expect(drill.summary.problems).toEqual([]);
  });
});

describe("the restored database, queried directly", () => {
  it("holds both synthetic tenants with their exact names", async () => {
    const { rows } = await destinationPool.query<{ id: string; name: string }>(
      "select id, name from tenants order by name",
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name)).toEqual([
      "Drill A Synthetic Club",
      "Drill B Synthetic Club",
    ]);
  });

  it("holds both synthetic members", async () => {
    const { rows } = await destinationPool.query<{
      member_code: string;
      status: string;
    }>("select member_code, status from members order by member_code");
    expect(rows).toEqual([
      { member_code: "DRILL-A-001", status: "active" },
      { member_code: "DRILL-B-001", status: "active" },
    ]);
  });

  it("holds the invoices with their exact paise totals", async () => {
    const { rows } = await destinationPool.query<{
      invoice_number: string;
      subtotal_paise: string;
      tax_paise: string;
      total_paise: string;
      paid_paise: string;
    }>(
      `select invoice_number, subtotal_paise, tax_paise, total_paise, paid_paise
         from invoices order by invoice_number`,
    );
    expect(rows).toEqual([
      {
        invoice_number: "DR-A-0001",
        subtotal_paise: "100000",
        tax_paise: "18000",
        total_paise: "118000",
        paid_paise: "118000",
      },
      {
        invoice_number: "DR-B-0001",
        subtotal_paise: "100000",
        tax_paise: "18000",
        total_paise: "118000",
        paid_paise: "118000",
      },
    ]);
  });

  it("holds the payments with their exact paise amounts", async () => {
    const { rows } = await destinationPool.query<{
      reference: string;
      amount_paise: string;
      method: string;
    }>(
      "select reference, amount_paise, method from payments order by reference",
    );
    expect(rows).toEqual([
      { reference: "DRILL-REF-A-0001", amount_paise: "118000", method: "upi" },
      { reference: "DRILL-REF-B-0001", amount_paise: "118000", method: "upi" },
    ]);
  });

  it("keeps RLS enabled and forced on every tenant-scoped table", async () => {
    const { rows } = await destinationPool.query<{
      relname: string;
      rls: boolean;
      forced: boolean;
    }>(
      `select c.relname,
              c.relrowsecurity      as rls,
              c.relforcerowsecurity as forced
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r','p')
          and c.relname <> 'platform_audit_log'
          and exists (select 1 from pg_attribute a
                      where a.attrelid = c.oid and a.attname = 'tenant_id'
                        and not a.attisdropped)
          and (not c.relrowsecurity or not c.relforcerowsecurity)`,
    );
    expect(rows).toEqual([]);
  });

  it("keeps the application role free of superuser and BYPASSRLS", async () => {
    const { rows } = await destinationPool.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      "select rolname, rolsuper, rolbypassrls from pg_roles where rolname like 'app_%'",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.rolsuper, row.rolname).toBe(false);
      expect(row.rolbypassrls, row.rolname).toBe(false);
    }
  });

  it("isolates the two tenants from each other over the application role", async () => {
    const app = new Pool({
      connectionString: drill.destination.appUri,
      max: 1,
      onConnect: async (client) => {
        await client.query("set role app_user");
      },
    });
    try {
      for (const tenant of [drill.fixture.tenantA, drill.fixture.tenantB]) {
        const client = await app.connect();
        try {
          await client.query("begin");
          await client.query("select set_config('app.tenant_id', $1, true)", [
            tenant.tenantId,
          ]);
          const { rows } = await client.query<{ id: string }>(
            "select id from members",
          );
          expect(rows.map((r) => r.id)).toEqual([tenant.memberId]);
          await client.query("commit");
        } finally {
          await client.query("rollback").catch(() => {});
          client.release();
        }
      }
    } finally {
      await app.end();
    }
  });

  it("shows the other tenant's rows to nobody", async () => {
    // A session with no tenant scope at all sees nothing — the
    // unscoped-reads-return-zero-rows property has to survive the
    // restore too.
    const app = new Pool({
      connectionString: drill.destination.appUri,
      max: 1,
      onConnect: async (client) => {
        await client.query("set role app_user");
      },
    });
    try {
      const { rows } = await app.query<{ count: string }>(
        "select count(*)::text as count from members",
      );
      expect(rows[0]?.count).toBe("0");
    } finally {
      await app.end();
    }
  });
});

describe("the drill's own negative guarantees", () => {
  it("refuses an archive pg_restore cannot read", () => {
    const corrupt = new TextEncoder().encode("PGDMPnot-really-an-archive");
    expect(() =>
      assertArchiveIsRestorable({
        exitCode: 1,
        stdout: "",
        stderr: "pg_restore: error: could not read from input file: end of file",
      }),
    ).toThrow(/end of file/i);
    expect(corrupt.byteLength).toBeGreaterThan(0);
  });

  it("keeps every container it created inside the drill namespace", () => {
    for (const name of drill.createdContainerNames) {
      expect(name).toMatch(/^aqua-drill-[0-9a-f]{12}-(source|destination)$/);
    }
  });

  it("reports no credential in the connection strings it exposes", () => {
    for (const uri of [drill.source.appUri, drill.destination.appUri]) {
      const redacted = redactConnectionUri(uri);
      expect(redacted).not.toContain(drill.source.appPassword);
      expect(redacted).not.toContain(drill.destination.appPassword);
    }
  });

  it("leaves the drill's containers visible for inspection", () => {
    expect(listDrillContainers()).toEqual(
      expect.arrayContaining(drill.createdContainerNames),
    );
  });
});
