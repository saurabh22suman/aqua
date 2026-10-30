import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_GUARD_EXEMPTIONS,
  EXEMPTIONS,
  extractOperationMembers,
  listOpsPageFiles,
  scanOperationCoverage,
  scanOpsEntryCoverage,
  listPlatformActionFiles,
  scanOpsActions,
  scanPlatformAdminGuards,
} from "@/scripts/lib/ops-action-scan";

// O-05 positive controls for the ops-action scan. The production scan
// runs in CI (pnpm check:ops-actions); this file proves the rule can
// fail on a known-bad input and stays green across the real tree.

const FIXTURES = join(process.cwd(), "tests", "scanner-fixtures", "fixtures");

describe("ops-action scan", () => {
  it("flags a known-bad action that mutates without opsAction", () => {
    const source = readFileSync(
      join(FIXTURES, "known-bad-ops-action.ts"),
      "utf8",
    );
    const violations = scanOpsActions(
      source,
      "lib/actions/platform-known-bad.ts",
    );
    expect(violations).toEqual([
      {
        file: "lib/actions/platform-known-bad.ts",
        functionName: "updateSomethingAction",
      },
    ]);
  });

  it("passes a known-good action that calls opsAction", () => {
    const source = readFileSync(
      join(FIXTURES, "known-good-ops-action.ts"),
      "utf8",
    );
    expect(
      scanOpsActions(source, "lib/actions/platform-known-good.ts"),
    ).toEqual([]);
  });

  it("passes an exempt auth action without opsAction", () => {
    const source = `export async function logoutPlatformAction(): Promise<void> {
      return;
    }`;
    expect(
      scanOpsActions(source, "lib/actions/platform-auth.ts"),
    ).toEqual([]);
  });

  it("passes a read action that directly returns the boundary call", () => {
    const source = `export async function listCatalogueAction(): Promise<string[]> {
      return runOpsGlobalRead("feature.catalogue.list", async () => [], "server_action");
    }`;
    expect(
      scanOpsActions(source, "lib/actions/platform-read.ts"),
    ).toEqual([]);
  });

  it("passes the real activity shape: one boundary assignment, null guard, return", () => {
    const source = `export async function listActivityAction(): Promise<string[]> {
      const status = await authGate();
      if (status.kind !== "authenticated") throw new Error("expired");
      const result = await runOpsGlobalRead("activity.list", async () => [], "server_action");
      if (result === null) throw new Error("expired");
      return result;
    }`;
    expect(
      scanOpsActions(source, "lib/actions/platform-read.ts"),
    ).toEqual([]);
  });

  it("rejects a decoy boundary call that is not returned", () => {
    const source = `export async function updateSomethingAction(): Promise<void> {
      void runOpsGlobalRead("activity.list", async () => [], "server_action");
    }`;
    expect(
      scanOpsActions(source, "lib/actions/platform-decoy.ts"),
    ).toHaveLength(1);
  });

  it("rejects a boundary call nested in an uncalled helper", () => {
    const source = `export async function updateSomethingAction(): Promise<void> {
      const helper = async () => runOpsGlobalRead("activity.list", async () => [], "server_action");
      void helper;
    }`;
    expect(
      scanOpsActions(source, "lib/actions/platform-decoy.ts"),
    ).toHaveLength(1);
  });

  it("rejects a dead conditional boundary return", () => {
    const source = `export async function updateSomethingAction(): Promise<void> {
      if (false) return runOpsGlobalRead("activity.list", async () => [], "server_action");
    }`;
    expect(
      scanOpsActions(source, "lib/actions/platform-decoy.ts"),
    ).toHaveLength(1);
  });

  it("rejects a conditional boundary assignment", () => {
    const source = `export async function updateSomethingAction(): Promise<void> {
      if (false) {
        const result = await runOpsGlobalRead("activity.list", async () => [], "server_action");
        if (result === null) throw new Error("expired");
        return result;
      }
    }`;
    expect(
      scanOpsActions(source, "lib/actions/platform-decoy.ts"),
    ).toHaveLength(1);
  });

  it("fails an unexempted read-shaped action in a read-only file", () => {
    const source = `export async function sneakMutationAction(): Promise<void> {
      return;
    }`;
    const violations = scanOpsActions(
      source,
      "lib/actions/platform-activity.ts",
    );
    expect(violations).toHaveLength(1);
  });

  it("scans the real tree with no violations (CI parity)", () => {
    const violations = [];
    for (const file of listPlatformActionFiles()) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      violations.push(...scanOpsActions(source, file));
    }
    expect(violations).toEqual([]);
  });

  it("counts only a boundary call, not a comment or bare string", () => {
    const union = `export type OpsBoundaryOperation =
  | "tax.read"
  | "tenant.detail";`;
    const sources = [
      {
        path: "app/(platform)/ops/page.tsx",
        source: `// "tenant.detail" in a comment does not count
const label = "tenant.detail";`,
      },
      {
        path: "lib/actions/platform-read.ts",
        source: `runOpsRead("tax.read", tenantId, read)`,
      },
    ];
    expect(scanOperationCoverage(union, sources)).toEqual(["tenant.detail"]);
    expect(
      scanOperationCoverage(union, [
        ...sources,
        {
          path: "lib/actions/platform-read.ts",
          source: `runOpsGlobalRead("tenant.detail", read, "server_action")`,
        },
      ]),
    ).toEqual([]);
  });

  it("the real union has a boundary call site for every member (CI parity)", () => {
    const unionSource = readFileSync(
      join(process.cwd(), "lib/auth/ops-operation.ts"),
      "utf8",
    );
    const sources = [...listPlatformActionFiles(), ...listOpsPageFiles()].map(
      (file) => ({
        path: file,
        source: readFileSync(join(process.cwd(), file), "utf8"),
      }),
    );
    expect(scanOperationCoverage(unionSource, sources)).toEqual([]);
  });

  it("reads the registry with the AST, not with a text search (no vacuous pass)", () => {
    // A semicolon inside a COMMENT must not truncate the registry: a text
    // search that ends at the first ";" would see only the members before
    // the comment and the coverage check would pass while most of the
    // registry was unwired.
    const union = `export type OpsBoundaryOperation =
  // One name per operation; the outcome says what happened.
  | "tax.read"
  | "tenant.detail";`;
    expect(extractOperationMembers(union)).toEqual([
      "tax.read",
      "tenant.detail",
    ]);
    expect(
      extractOperationMembers(
        readFileSync(join(process.cwd(), "lib/auth/ops-operation.ts"), "utf8"),
      ).length,
    ).toBeGreaterThan(40);
  });

  it("flags an Ops entry file that is neither instrumented nor classified", () => {
    const sources = [
      {
        path: "app/(platform)/ops/tenants/page.tsx",
        source: `export default async function Page() { return null; }`,
      },
      {
        path: "app/(platform)/ops/leads/new/page.tsx",
        source: `export default async function Page() { return null; }`,
      },
    ];
    // The leads/new page IS classified in the registry; the tenants page
    // is instrumented in the real tree but is not in this fixture.
    expect(scanOpsEntryCoverage(sources)).toEqual([
      "app/(platform)/ops/tenants/page.tsx",
    ]);
  });

  it("accepts an instrumented Ops entry file and a client component", () => {
    const sources = [
      {
        path: "app/(platform)/ops/tenants/page.tsx",
        source: `const rows = await runOpsGlobalRead("tenant.list", read, "ops_page");`,
      },
      {
        path: "app/(platform)/ops/leads/new/new-lead-form.tsx",
        source: `"use client";\nexport const Form = () => null;`,
      },
    ];
    expect(scanOpsEntryCoverage(sources)).toEqual([]);
  });

  it("flags an unguarded mutation that calls opsAction (admin-guard scan)", () => {
    const source = `declare function opsAction<T>(i: unknown, f: () => Promise<T>): Promise<T>;
    export async function mutateSomethingAction(): Promise<{ ok: true }> {
      return opsAction({ scope: "feature.update" }, async () => ({ ok: true }));
    }`;
    const violations = scanPlatformAdminGuards(
      source,
      "lib/actions/platform-unguarded.ts",
    );
    expect(violations).toEqual([
      {
        file: "lib/actions/platform-unguarded.ts",
        functionName: "mutateSomethingAction",
      },
    ]);
  });

  it("passes the guarded known-good action (admin-guard scan)", () => {
    const source = readFileSync(
      join(FIXTURES, "known-good-ops-action.ts"),
      "utf8",
    );
    expect(
      scanPlatformAdminGuards(source, "lib/actions/platform-known-good.ts"),
    ).toEqual([]);
  });

  it("scans the real tree for admin guards with no violations", () => {
    const violations = [];
    for (const file of listPlatformActionFiles()) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      violations.push(...scanPlatformAdminGuards(source, file));
    }
    expect(violations).toEqual([]);
  });

  it("keeps every exemption pointed at a real file#function", () => {
    const sources = new Map(
      listPlatformActionFiles().map((file) => [
        file,
        readFileSync(join(process.cwd(), file), "utf8"),
      ]),
    );
    for (const entry of [
      ...Object.keys(EXEMPTIONS),
      ...Object.keys(ADMIN_GUARD_EXEMPTIONS),
    ]) {
      const [file, fn] = entry.split("#");
      const source = sources.get(file);
      expect(source, file).toBeTruthy();
      expect(source?.includes(`function ${fn}(`), entry).toBe(true);
    }
  });
});
