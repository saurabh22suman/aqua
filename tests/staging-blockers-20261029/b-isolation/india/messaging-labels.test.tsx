// @vitest-environment jsdom
//
// India-first Ops presentation (own scope, item 8).
// Honest test history: the initial run failed on an invalid test UUID fixture
// (NEXT_NOT_FOUND), not on the labels. The label assertion was proven
// sensitive afterwards by temporarily restoring the old labels (mutation
// check, MUTATION-messaging-labels.log), then restoring the source.
// The values, failure counts, provider and mock disclosure must not move.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({ kind: "authenticated", role: "operator" }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/db/platform-tenants", () => ({
  getTenantHeader: async () => ({
    id: "11111111-1111-7111-8111-111111111111",
    name: "Aqua Worli",
    slug: "aqua-worli",
    status: "active",
  }),
}));
vi.mock("@/db/platform-tenant-messaging", () => ({
  getTenantMessagingSummary: async () => ({
    provider: "mock",
    lastSentAt: new Date("2026-09-15T10:00:00.000Z"),
    sentCount7d: 12,
    failedCount7d: 1,
  }),
}));

import TenantMessagingPage from "@/app/(platform)/ops/tenants/[tenantId]/messaging/page";

const TENANT_ID = "11111111-1111-7111-8111-111111111111";

afterEach(cleanup);

describe("messaging panel names outbound attempts, not delivery", () => {
  it("keeps every value and the mock/provider disclosure", async () => {
    render(await TenantMessagingPage({ params: Promise.resolve({ tenantId: TENANT_ID }) }));

    expect(screen.getByText("Last outbound attempt")).toBeDefined();
    expect(screen.getByText("Outbound attempts, last 7 days")).toBeDefined();
    expect(screen.getByText("Failed, last 7 days")).toBeDefined();
    expect(screen.queryByText("Last message sent")).toBeNull();
    expect(screen.queryByText("Sent, last 7 days")).toBeNull();

    // Values and disclosures stay exactly as before.
    expect(screen.getByText("12")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
    expect(screen.getByText(/Non-production mock/)).toBeDefined();
    expect(screen.getByText(/an outbound attempt has been logged/)).toBeDefined();
  });
});
