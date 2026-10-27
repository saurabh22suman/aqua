import { describe, expect, it } from "vitest";
import {
  DEMO_TENANTS,
  assertApplyApproved,
  assertDemoTenant,
  assertLocalDatabase,
} from "@/scripts/demo-history/guards";

// The generator writes synthetic history into a real database. The
// guards are the difference between "the operator asked for a demo" and
// "an env var was misconfigured and a live club received 3,000 fake
// invoices". Every refusal below is a hard failure, not a warning.

describe("demo history guards — the tenant must be a demo tenant", () => {
  it("accepts the seeded demo tenants", () => {
    expect(Object.keys(DEMO_TENANTS)).toContain("demo-academy");
    expect(() =>
      assertDemoTenant({ slug: "demo-academy", name: DEMO_TENANTS["demo-academy"]! }),
    ).not.toThrow();
  });

  it("refuses a tenant that is not on the demo list", () => {
    expect(() =>
      assertDemoTenant({ slug: "acme-swimming", name: "Acme Swimming Club" }),
    ).toThrow(/demo tenant/i);
  });

  it("refuses a demo slug whose name does not match", () => {
    expect(() =>
      assertDemoTenant({ slug: "demo-academy", name: "A Real Customer Club" }),
    ).toThrow(/demo tenant/i);
  });
});

describe("demo history guards — the database must be local and not production", () => {
  it("refuses a remote database", () => {
    expect(() =>
      assertLocalDatabase("postgresql://x@db.example.com/aqua", "development"),
    ).toThrow(/loopback/i);
  });

  it("refuses production", () => {
    expect(() =>
      assertLocalDatabase("postgresql://x@127.0.0.1:5432/aqua", "production"),
    ).toThrow(/production/i);
  });

  it("accepts a loopback database outside production", () => {
    expect(() =>
      assertLocalDatabase("postgresql://x@localhost:55465/aqua", "development"),
    ).not.toThrow();
    expect(() =>
      assertLocalDatabase("postgresql://x@127.0.0.1:55465/aqua", "test"),
    ).not.toThrow();
  });

  it("refuses a URL it cannot read", () => {
    expect(() => assertLocalDatabase("not-a-url", "development")).toThrow(/database/i);
  });
});

describe("demo history guards — writing needs an explicit opt-in", () => {
  it("allows a dry run without any opt-in", () => {
    expect(() => assertApplyApproved({}, false)).not.toThrow();
  });

  it("refuses to write without the opt-in", () => {
    expect(() => assertApplyApproved({}, true)).toThrow(/AQUA_DEMO_HISTORY_APPLY/);
  });

  it("refuses to write when the opt-in is anything but 1", () => {
    expect(() =>
      assertApplyApproved({ AQUA_DEMO_HISTORY_APPLY: "0" }, true),
    ).toThrow(/AQUA_DEMO_HISTORY_APPLY/);
    expect(() =>
      assertApplyApproved({ AQUA_DEMO_HISTORY_APPLY: "true" }, true),
    ).toThrow(/AQUA_DEMO_HISTORY_APPLY/);
  });

  it("allows the write when the opt-in is exactly 1", () => {
    expect(() =>
      assertApplyApproved({ AQUA_DEMO_HISTORY_APPLY: "1" }, true),
    ).not.toThrow();
  });
});
