// @vitest-environment jsdom
//
// Ops redesign (28 October 2026) — the console's rendered TIMES are
// in IST.
//
// The staging finding: the Activity log rendered "28 Oct, 02:41 pm"
// while the Overview rendered the SAME instant as "28 Oct 8:11 pm IST".
// The Activity list's formatter had no timeZone, so it rendered in the
// CONTAINER's zone — UTC in the deployed image — while every other
// Ops surface rendered IST.
//
// Times are money-adjacent: an operator reading the audit trail must
// read the same clock as the rest of the console. Every Ops-owned
// formatter therefore names Asia/Kolkata explicitly, and every surface
// that renders a TIME says so.
//
// THE MIDNIGHT BOUNDARY. A date-only rendering is zone-sensitive too:
// 2026-10-28T20:41Z is 28 October in UTC and 29 October in IST. The
// test pins that, because an off-by-one-day in a "Created" column is
// exactly the kind of defect a date-only formatter hides.
//
// RUN IT UNDER TZ=UTC — the defect only reproduces away from IST:
//   TZ=UTC pnpm test tests/ops-redesign/ops-timezone.test.tsx

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({
    kind: "authenticated",
    userId: "u1",
    role: "admin",
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
  notFound: () => {
    throw new Error("unexpected notFound");
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

vi.mock("@/db/platform-tenants", () => ({
  getTenantDetail: async () => ({
    id: "11111111-1111-4111-8111-111111111111",
    name: "Aqua Worli",
    slug: "aqua-worli",
    status: "active",
    timezone: "Asia/Kolkata",
    currency: "INR",
    gstin: null,
    planName: "Standard",
    planId: null,
    presetKey: "multi-sport",
    presetVersion: 1,
    offlineSyncEnabled: false,
    // 28 Oct 2026, 20:41 UTC — which is 29 Oct 2026, 02:11 in IST.
    createdAt: new Date("2026-10-28T20:41:00.000Z"),
    updatedAt: new Date("2026-10-28T20:41:00.000Z"),
    memberCount: 0,
    locationCount: 1,
    sessionsThisMonth: 0,
    locations: [],
    featureKeys: [],
    recentActivity: [],
  }),
}));
vi.mock("@/db/sample-data-state", () => ({
  getSampleDataState: async () => ({ hasSample: false, hasReal: false }),
}));

import { OpsActivityList } from "@/components/ops/ops-activity-list";
import { TenantTable } from "@/app/(platform)/ops/tenants/tenant-table";
import PlatformTenantDetailPage from "@/app/(platform)/ops/tenants/[tenantId]/page";

afterEach(cleanup);

// 28 Oct 2026, 14:41 UTC — 28 Oct 2026, 20:11 in IST.
const AFTERNOON_UTC = new Date("2026-10-28T14:41:00.000Z");

describe("Ops rendered times are IST", () => {
  it("the activity log renders the instant in IST, and says so", () => {
    render(
      <OpsActivityList
        rows={[
          {
            id: "a1",
            action: "tenant.activate",
            actorId: null,
            tenantId: "t1",
            tenantName: "Aqua Worli",
            tenantSlug: "aqua-worli",
            detail: {},
            createdAt: AFTERNOON_UTC,
          },
        ]}
      />,
    );

    const text = screen.getByText(/tenant\.activate/).closest("li")?.textContent ?? "";
    expect(text).toContain("08:11");
    expect(text).toContain("IST");
    expect(text).not.toContain("14:41");
  });

  it("the tenant detail renders the created instant in IST, across midnight", async () => {
    render(
      await PlatformTenantDetailPage({
        params: Promise.resolve({ tenantId: "11111111-1111-4111-8111-111111111111" }),
      }),
    );

    const created = screen.getByText("Created").closest("div")?.textContent ?? "";
    expect(created).toContain("29 Oct");
    expect(created).toContain("02:11");
    expect(created).toContain("IST");
    expect(created).not.toContain("28 Oct");
  });

  it("the tenants table renders the created DATE in IST, across midnight", () => {
    render(
      <TenantTable
        rows={[
          {
            id: "t1",
            name: "Aqua Worli",
            slug: "aqua-worli",
            status: "active",
            memberCount: 0,
            locationCount: 1,
            planName: "Standard",
            createdAt: new Date("2026-10-28T20:41:00.000Z"),
            trialExpiresAt: null,
            health: "healthy",
          },
        ]}
      />,
    );

    const table = screen.getByRole("table");
    expect(table.textContent).toContain("29 Oct");
    expect(table.textContent).not.toContain("28 Oct");
  });
});
