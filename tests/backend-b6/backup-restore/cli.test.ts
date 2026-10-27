import { describe, expect, it } from "vitest";
import {
  parseCliArgs,
  formatDrillReport,
  formatDrillReportJson,
} from "@/scripts/lib/disposable-restore/cli";
import type { DrillResult } from "@/scripts/lib/disposable-restore/drill";

// B6 — the drill's command line.
//
// The single most important property of this CLI is what it does NOT
// accept. There is no restore-to-an-arbitrary-URL mode, no
// --target-url, no positional database argument. The drill creates its
// own two throwaway databases and restores into one of them. A
// restore tool that accepts a pasted URL is a tool that will one day
// be pointed at production by accident.
//
// So the CLI's job is as much to REFUSE as to run.

describe("parseCliArgs", () => {
  it("runs the drill when given no arguments", () => {
    const action = parseCliArgs([]);
    expect(action).toEqual({ kind: "run", options: { preserve: false, json: false } });
  });

  it("accepts --preserve", () => {
    const action = parseCliArgs(["--preserve"]);
    expect(action).toEqual({ kind: "run", options: { preserve: true, json: false } });
  });

  it("accepts --json", () => {
    const action = parseCliArgs(["--json"]);
    expect(action).toEqual({ kind: "run", options: { preserve: false, json: true } });
  });

  it("shows help for --help and -h", () => {
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["-h"])).toEqual({ kind: "help" });
  });

  it("refuses a target URL flag", () => {
    for (const flag of [
      "--target-url",
      "--destination-url",
      "--source-url",
      "--target",
      "--destination",
      "--restore-to",
      "--database-url",
    ]) {
      const action = parseCliArgs([flag, "postgresql://aqua:pw@db.internal:5432/aqua"]);
      expect(action.kind, flag).toBe("error");
      if (action.kind === "error") {
        expect(action.message).toMatch(/arbitrary|target/i);
        expect(action.message).not.toContain("pw@");
      }
    }
  });

  it("refuses a positional connection string", () => {
    const action = parseCliArgs(["postgresql://aqua:pw@db.internal:5432/aqua"]);
    expect(action.kind).toBe("error");
    if (action.kind === "error") {
      expect(action.message).toMatch(/argument/i);
      expect(action.message).not.toContain("pw@");
    }
  });

  it("refuses a positional host that names a real environment", () => {
    const action = parseCliArgs(["production-db"]);
    expect(action.kind).toBe("error");
    if (action.kind === "error") {
      expect(action.message).toMatch(/argument/i);
    }
  });

  it("refuses an unknown flag instead of ignoring it", () => {
    const action = parseCliArgs(["--force"]);
    expect(action.kind).toBe("error");
    if (action.kind === "error") {
      expect(action.message).toMatch(/--force/);
    }
  });

  it("refuses a flag missing its value", () => {
    const action = parseCliArgs(["--target-url"]);
    expect(action.kind).toBe("error");
  });
});

describe("formatDrillReport", () => {
  const result = {
    source: {
      identity: "aqua-drill-0a1b2c3d4e5f",
      role: "source",
      host: "127.0.0.1",
      port: 40001,
      database: "aqua_drill",
      containerName: "aqua-drill-0a1b2c3d4e5f-source",
      adminUri: "postgresql://aqua:s3cr3t@127.0.0.1:40001/aqua_drill",
      appUri: "postgresql://app_login:s3cr3t@127.0.0.1:40001/aqua_drill",
      appPassword: "s3cr3t",
    },
    destination: {
      identity: "aqua-drill-111111111111",
      role: "destination",
      host: "127.0.0.1",
      port: 40002,
      database: "aqua_drill",
      containerName: "aqua-drill-111111111111-destination",
      adminUri: "postgresql://aqua:s3cr3t@127.0.0.1:40002/aqua_drill",
      appUri: "postgresql://app_login:s3cr3t@127.0.0.1:40002/aqua_drill",
      appPassword: "s3cr3t",
    },
    dumpBytes: 4096,
    archiveListing: "; Format: CUSTOM\n",
    fixture: { tenantA: {}, tenantB: {} },
    createdContainerNames: ["aqua-drill-0a1b2c3d4e5f-source"],
    preserved: false,
    summary: {
      migrations: { source: ["a.sql"], destination: ["a.sql"], missing: [], unexpected: [] },
      records: { source: [], destination: [], identical: true },
      money: {
        expectedTotalPaise: "118000",
        restoredInvoiceTotalPaise: "118000",
        restoredPaymentAmountPaise: "118000",
        exact: true,
      },
      grants: { missing: [], appendOnlyViolations: [] },
      rls: { notEnabled: [], notForced: [] },
      roleAttributes: { superuser: [], bypassRls: [] },
      isolation: [
        {
          scopeTenantId: "t-a",
          visibleMemberIds: ["m-a"],
          otherTenantMemberIdsVisible: [],
        },
      ],
      problems: [],
    },
  } as unknown as DrillResult;

  it("reports the evidence an operator needs", () => {
    const report = formatDrillReport(result);
    expect(report).toMatch(/PASSED/i);
    expect(report).toMatch(/4096 bytes/);
    expect(report).toMatch(/118000/);
    expect(report).toMatch(/aqua-drill-0a1b2c3d4e5f-source/);
  });

  it("never prints a credential", () => {
    const report = formatDrillReport(result);
    expect(report).not.toContain("s3cr3t");
  });
});

describe("formatDrillReportJson", () => {
  const result = {
    source: {
      identity: "aqua-drill-0a1b2c3d4e5f",
      role: "source",
      host: "127.0.0.1",
      port: 40001,
      database: "aqua_drill",
      containerName: "aqua-drill-0a1b2c3d4e5f-source",
      adminUri: "postgresql://aqua:s3cr3t@127.0.0.1:40001/aqua_drill",
      appUri: "postgresql://app_login:s3cr3t@127.0.0.1:40001/aqua_drill",
      appPassword: "s3cr3t",
    },
    destination: {
      identity: "aqua-drill-111111111111",
      role: "destination",
      host: "127.0.0.1",
      port: 40002,
      database: "aqua_drill",
      containerName: "aqua-drill-111111111111-destination",
      adminUri: "postgresql://aqua:s3cr3t@127.0.0.1:40002/aqua_drill",
      appUri: "postgresql://app_login:s3cr3t@127.0.0.1:40002/aqua_drill",
      appPassword: "s3cr3t",
    },
    dumpBytes: 4096,
    archiveListing: "; Format: CUSTOM\n",
    fixture: { tenantA: {}, tenantB: {} },
    createdContainerNames: ["aqua-drill-0a1b2c3d4e5f-source"],
    preserved: false,
    summary: {
      migrations: { source: ["a.sql"], destination: ["a.sql"], missing: [], unexpected: [] },
      records: { source: [], destination: [], identical: true },
      money: {
        expectedTotalPaise: "118000",
        restoredInvoiceTotalPaise: "118000",
        restoredPaymentAmountPaise: "118000",
        exact: true,
      },
      grants: { missing: [], appendOnlyViolations: [] },
      rls: { notEnabled: [], notForced: [] },
      roleAttributes: { superuser: [], bypassRls: [] },
      isolation: [
        {
          scopeTenantId: "t-a",
          visibleMemberIds: ["m-a"],
          otherTenantMemberIdsVisible: [],
        },
      ],
      problems: [],
    },
  } as unknown as DrillResult;

  it("emits machine-readable JSON", () => {
    const parsed = JSON.parse(formatDrillReportJson(result)) as {
      ok: boolean;
      dumpBytes: number;
      problems: string[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.dumpBytes).toBe(4096);
    expect(parsed.problems).toEqual([]);
  });

  it("never prints a credential", () => {
    expect(formatDrillReportJson(result)).not.toContain("s3cr3t");
  });
});
