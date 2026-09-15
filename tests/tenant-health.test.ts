import { describe, expect, it } from "vitest";
import { classifyTenantHealth } from "@/db/tenant-health";

// PR2 (ops console improvements) — the classification rule is pure
// and DB-free by design so every threshold gets a fast, exact test
// instead of relying on the query-shape test (tests/tenant-health-query-shape.test.ts)
// to exercise every branch.

const NOW = new Date("2026-09-15T00:00:00Z");

const BASE = {
  tenantStatus: "active" as const,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  memberCount: 10,
  trialExpiresAt: null,
  maxOverdueDays: null,
  lastActiveOn: new Date("2026-09-14T00:00:00Z"),
  failed7d: 0,
  oldestPendingAt: null,
  now: NOW,
};

describe("classifyTenantHealth", () => {
  it("is not scored for churned tenants", () => {
    expect(
      classifyTenantHealth({ ...BASE, tenantStatus: "churned" }),
    ).toEqual({ status: null, reasons: [] });
  });

  it("is healthy when every signal is clean", () => {
    expect(classifyTenantHealth(BASE)).toEqual({
      status: "healthy",
      reasons: [],
    });
  });

  it("zero members is at_risk regardless of other signals", () => {
    const result = classifyTenantHealth({ ...BASE, memberCount: 0 });
    expect(result.status).toBe("at_risk");
    expect(result.reasons).toContain("Zero members");
  });

  it("invoice overdue 14 days or less is attention, not at_risk", () => {
    const result = classifyTenantHealth({ ...BASE, maxOverdueDays: 14 });
    expect(result.status).toBe("attention");
  });

  it("invoice overdue more than 14 days is at_risk", () => {
    const result = classifyTenantHealth({ ...BASE, maxOverdueDays: 15 });
    expect(result.status).toBe("at_risk");
    expect(result.reasons).toContain("Invoice overdue 15d");
  });

  it("trial expired is at_risk", () => {
    const result = classifyTenantHealth({
      ...BASE,
      tenantStatus: "trial",
      trialExpiresAt: new Date("2026-09-10T00:00:00Z"),
    });
    expect(result.status).toBe("at_risk");
    expect(result.reasons).toContain("Trial expired");
  });

  it("trial expiring within 7 days is attention", () => {
    const result = classifyTenantHealth({
      ...BASE,
      tenantStatus: "trial",
      trialExpiresAt: new Date("2026-09-20T00:00:00Z"),
    });
    expect(result.status).toBe("attention");
  });

  it("trial expiring in 8+ days is not flagged yet", () => {
    const result = classifyTenantHealth({
      ...BASE,
      tenantStatus: "trial",
      trialExpiresAt: new Date("2026-09-25T00:00:00Z"),
    });
    expect(result.status).toBe("healthy");
  });

  it("a trial tenant with no trial_expires_at produces no trial signal", () => {
    const result = classifyTenantHealth({
      ...BASE,
      tenantStatus: "trial",
      trialExpiresAt: null,
    });
    expect(result.status).toBe("healthy");
  });

  it("no activity in 14+ days is attention, measured from last activity", () => {
    const result = classifyTenantHealth({
      ...BASE,
      lastActiveOn: new Date("2026-08-01T00:00:00Z"),
    });
    expect(result.status).toBe("attention");
    expect(result.reasons.some((r) => r.startsWith("No activity"))).toBe(true);
  });

  it("falls back to createdAt when there is no rollup activity at all — grace period for new tenants", () => {
    const freshlyCreated = classifyTenantHealth({
      ...BASE,
      lastActiveOn: null,
      createdAt: new Date("2026-09-10T00:00:00Z"),
    });
    expect(freshlyCreated.status).toBe("healthy");

    const staleWithNoRollupEver = classifyTenantHealth({
      ...BASE,
      lastActiveOn: null,
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    expect(staleWithNoRollupEver.status).toBe("attention");
  });

  it("suspended tenants are never flagged for inactivity", () => {
    const result = classifyTenantHealth({
      ...BASE,
      tenantStatus: "suspended",
      lastActiveOn: new Date("2026-01-01T00:00:00Z"),
    });
    expect(result.status).toBe("healthy");
  });

  it("3 or more failed messages in 7 days is attention", () => {
    expect(classifyTenantHealth({ ...BASE, failed7d: 2 }).status).toBe("healthy");
    expect(classifyTenantHealth({ ...BASE, failed7d: 3 }).status).toBe("attention");
  });

  it("a change request pending 3+ days is attention", () => {
    const under = classifyTenantHealth({
      ...BASE,
      oldestPendingAt: new Date("2026-09-13T00:00:01Z"),
    });
    expect(under.status).toBe("healthy");

    const over = classifyTenantHealth({
      ...BASE,
      oldestPendingAt: new Date("2026-09-12T00:00:00Z"),
    });
    expect(over.status).toBe("attention");
  });

  it("at_risk wins over attention when both fire", () => {
    const result = classifyTenantHealth({
      ...BASE,
      memberCount: 0,
      failed7d: 5,
    });
    expect(result.status).toBe("at_risk");
    expect(result.reasons.length).toBeGreaterThanOrEqual(1);
  });
});
