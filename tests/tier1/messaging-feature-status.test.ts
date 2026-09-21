import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IsolatedDb } from "../helpers/isolated-db";
import { startIsolatedDb } from "../helpers/isolated-db";
import { FEATURES } from "@/db/seed-platform";

// PR1-C7 — the pilot ships the mock messaging provider only. The
// catalogue said "ga" while the provider was a mock, which is the
// kind of overclaim that survives until a customer asks for it.
// After migrations alone, messaging must be non-GA; every other
// feature keeps its catalogued status.

let isolated: IsolatedDb;

beforeAll(async () => {
  isolated = await startIsolatedDb();
}, 120_000);

afterAll(async () => {
  await isolated?.stop();
});

describe("messaging feature status (PR1-C7)", () => {
  it("is non-GA after migrations alone", async () => {
    const row = await isolated.admin.query<{ status: string }>(
      "select status from features where key = 'messaging'",
    );
    expect(row.rows[0]?.status).toBe("internal");
  });

  it("keeps every other catalogued feature status unchanged", async () => {
    const rows = await isolated.admin.query<{ key: string; status: string }>(
      "select key, status from features order by key",
    );
    const byKey = new Map(rows.rows.map((r) => [r.key, r.status]));
    for (const feature of FEATURES) {
      if (feature.key === "messaging") continue;
      expect(byKey.get(feature.key), feature.key).toBe(feature.status);
    }
  });

  it("marks messaging non-GA in the seed catalogue too", () => {
    expect(FEATURES.find((f) => f.key === "messaging")?.status).toBe("internal");
  });
});
