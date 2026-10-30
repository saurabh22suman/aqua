// @vitest-environment jsdom
//
// Ops redesign (28 October 2026) — the confirmed UI gaps.
//
// The human review found three defects in the console that were in
// scope to fix:
//
//   1. The CONFIGURATION route had no UUID guard. Every other tenant
//      route calls requireUuidParam() immediately after awaiting the
//      params and BEFORE it touches the database, so a hand-typed or
//      malformed segment becomes the friendly 404 — the Next notFound
//      signal — without a query ever running.
//
//      The configuration route skipped it, so the malformed id reached
//      the query and surfaced as a database error instead.
//
//   2. The tenant Overview's "Plan" row linked to a plans route that
//      does not exist. Every click was a dead end. The contract says to
//      remove the dead link, NOT to invent a plans route.
//
//   3. The tenant navigation did not carry the GST destination. The
//      GST page existed and worked, but it was reachable only from a
//      sentence link inside Configuration, so it was easy to miss.
//
// (3) is covered by tests/ops-tenant-detail-tabs.test.tsx, which the
// human explicitly authorised for extension.
//
// HONESTY NOTE ON THE CYCLE: an intermediate attempt at (1) converted
// the database failure into a rendered "that is not a tenant id"
// panel, and the test was then bent to accept it. That was a WEAKER
// requirement — it still let a malformed id reach the database — and
// the independent review rejected it. The intended requirement below
// is the original one, restored.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = process.cwd();

const dataMock = vi.hoisted(() => ({
  getEffectiveConfiguration: vi.fn(async (): Promise<never> => {
    throw new Error("DATA_CALLED_WITH_AN_INVALID_ID");
  }),
}));

// The configuration route must reject a malformed tenant id BEFORE it
// queries anything. The data layer is mocked to fail loudly if it is
// reached with a bad id, so a regression to "query first, guard later"
// fails here instead of in production.
vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({
    kind: "authenticated",
    userId: "u1",
    role: "admin",
  }),
}));

// The tenant pages now call the approved Ops operation boundary before the
// page-level 404. This is the same contract as the real helper for the ids
// this suite uses: a malformed segment is a null result and never reaches a
// read; a valid one delegates. No assertion changes.
vi.mock("@/lib/auth/ops-operation", () => ({
  runOpsRead: async (
    _operation: string,
    tenantId: string,
    read: () => Promise<unknown>,
  ) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      tenantId,
    )
      ? read()
      : null,
  runOpsGlobalRead: async (
    _operation: string,
    read: () => Promise<unknown>,
  ) => read(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
}));

vi.mock("@/db/ops-configuration-view", () => ({
  getEffectiveConfiguration: () => dataMock.getEffectiveConfiguration(),
}));
vi.mock("@/db/config-requests", () => ({
  listConfigChangeRequests: async () => [],
}));
vi.mock("@/db/platform-tenants", () => ({
  listAllTenantsForSelector: async () => [],
}));

import EffectiveConfigurationPage from "@/app/(platform)/ops/tenants/[tenantId]/configuration/page";

afterEach(() => {
  cleanup();
  dataMock.getEffectiveConfiguration.mockClear();
});

function opsSourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...opsSourceFiles(full));
    } else if (/\.(tsx|ts)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

describe("Ops confirmed gaps", () => {
  it("the configuration route rejects a malformed tenant id before it queries", async () => {
    await expect(
      EffectiveConfigurationPage({
        params: Promise.resolve({ tenantId: "not-a-uuid" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    // The guard runs BEFORE the data layer: a malformed id never
    // reaches a query.
    expect(dataMock.getEffectiveConfiguration).not.toHaveBeenCalled();
  });

  it("no Ops route links to the non-existent /ops/plans route", () => {
    const directory = join(ROOT, "app/(platform)/ops");
    const offenders = opsSourceFiles(directory).filter((file) =>
      readFileSync(file, "utf8").includes("/ops/plans"),
    );
    expect(
      offenders,
      `dead links to /ops/plans:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
