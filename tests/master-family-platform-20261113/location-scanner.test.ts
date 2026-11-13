import { describe, expect, it } from "vitest";
import { scanLocationScope } from "@/scripts/lib/location-scope-scan";

describe("location scanner guard detection", () => {
  const path = "lib/services/synthetic-unsafe.ts";
  it("rejects a helper name appearing only in a string", () => {
    const source = `const explanation = "resolveLocationAccess("; await tx.select().from(members);`;
    expect(scanLocationScope(source, path).violation).toBe(true);
  });
  it("accepts a real location helper call", () => {
    const source = `const scope = await resolveLocationAccess(tx, ctx); await tx.select().from(members);`;
    expect(scanLocationScope(source, path).violation).toBe(false);
  });
  it("rejects an unguarded query", () => {
    expect(scanLocationScope(`await tx.select().from(members);`, path).violation).toBe(true);
  });
});
