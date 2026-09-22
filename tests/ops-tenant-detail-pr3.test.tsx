// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// PR3-C9 — the ops tenant detail keeps its PR1 promise: a tenant with
// no preset is flagged, and the owner-invite action is visible on the
// page the operator lands on after creating it.

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({ kind: "authenticated", userId: "u1" }),
}));
vi.mock("@/lib/params", () => ({ requireUuidParam: () => undefined }));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

vi.mock("@/db/platform-tenants", () => ({
  getTenantDetail: async () => ({
    id: TENANT_ID,
    name: "Aqua Worli",
    slug: "aqua-worli",
    status: "trial",
    timezone: "Asia/Kolkata",
    currency: "INR",
    gstin: null,
    planName: "Standard",
    planId: null,
    presetKey: null,
    presetVersion: null,
    offlineSyncEnabled: false,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    memberCount: 0,
    locationCount: 1,
    sessionsThisMonth: 0,
  }),
}));
vi.mock("@/db/sample-data-state", () => ({
  getSampleDataState: async () => ({ hasSample: false, hasReal: false }),
}));
vi.mock(
  "@/app/(platform)/ops/tenants/[tenantId]/invite-owner-form",
  () => ({ InviteOwnerForm: () => <div data-testid="invite-owner-form" /> }),
);
vi.mock(
  "@/app/(platform)/ops/tenants/[tenantId]/remove-sample-data-button",
  () => ({ RemoveSampleDataButton: () => null }),
);
vi.mock(
  "@/app/(platform)/ops/tenants/[tenantId]/status-transitions",
  () => ({ StatusTransitionControls: () => null }),
);

import PlatformTenantDetailPage from "@/app/(platform)/ops/tenants/[tenantId]/page";

afterEach(cleanup);

describe("ops tenant detail (PR3-C9)", () => {
  it("flags a preset-less tenant and keeps the owner invite visible", async () => {
    render(
      await PlatformTenantDetailPage({
        params: Promise.resolve({ tenantId: TENANT_ID }),
      }),
    );
    expect(document.body.textContent).toContain("No preset applied");
    expect(screen.getByTestId("invite-owner-form")).toBeTruthy();
  });
});
