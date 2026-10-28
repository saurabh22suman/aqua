// @vitest-environment jsdom
//
// Ops redesign (28 October 2026) — the list filters.
//
// The human review found that two lists had no usable filter:
//
//   - The LEADS pipeline listed every lead with no way to narrow it.
//     The stage is the one thing an operator filters by ("show me the
//     trials"), and the stage set is the platform's own — the same
//     list the pipeline uses.
//
//   - The ACTIVITY log filtered the tenant by a free-text UUID box. The
//     operator investigating a problem knows the club's NAME, not its
//     id, so the filter could not be used at the moment it was
//     needed. The activity page must offer the tenant by name.
//
// Both filters must use the data the platform actually has: the
// lead's own stage, and the real tenant list.
//
// These are the agent-owned behavioural tests; the rendered geometry of
// the same controls is proven in e2e/ops-redesign/ops-controls-acceptance.ts.

import { cleanup, render, screen, within } from "@testing-library/react";
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
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const listLeadsMock = vi.fn();
vi.mock("@/db/platform-leads", () => ({
  listLeads: () => listLeadsMock(),
}));

import LeadsPage from "@/app/(platform)/ops/leads/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function lead(overrides: Record<string, unknown> = {}) {
  return {
    id: "l1",
    businessName: "Sunrise Sports Club",
    contactName: "Asha Menon",
    phone: "+919000000001",
    email: null,
    city: "Pune",
    source: "whatsapp",
    status: "lead",
    qualification: {},
    lostReason: null,
    trialExpiresAt: null,
    convertedTenantId: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("Leads list — the stage filter", () => {
  it("offers every pipeline stage the platform knows", async () => {
    listLeadsMock.mockResolvedValue([]);
    render(await LeadsPage({ searchParams: Promise.resolve({}) }));

    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    const stage = within(form as HTMLElement).getByLabelText(/stage/i);
    const values = Array.from((stage as HTMLSelectElement).options).map(
      (option) => option.value,
    );
    expect(values).toEqual([
      "",
      "lead",
      "qualified",
      "demo_booked",
      "trial",
      "converted",
      "lost",
      "lapsed",
    ]);
  });

  it("shows only the leads in the selected stage, and says how many match", async () => {
    listLeadsMock.mockResolvedValue([
      lead({ id: "l1", businessName: "Sunrise Sports Club", status: "lead" }),
      lead({ id: "l2", businessName: "Blue Wave Academy", status: "trial" }),
      lead({ id: "l3", businessName: "Kicks Football", status: "trial" }),
    ]);

    render(await LeadsPage({ searchParams: Promise.resolve({ stage: "trial" }) }));

    expect(screen.getByText("Blue Wave Academy")).toBeDefined();
    expect(screen.getByText("Kicks Football")).toBeDefined();
    expect(screen.queryByText("Sunrise Sports Club")).toBeNull();
    expect(screen.getByText(/2 of 3 leads match the trial stage/)).toBeDefined();
  });

  it("shows every lead and the whole count when no stage is selected", async () => {
    listLeadsMock.mockResolvedValue([
      lead({ id: "l1", businessName: "Sunrise Sports Club", status: "lead" }),
      lead({ id: "l2", businessName: "Blue Wave Academy", status: "trial" }),
    ]);

    render(await LeadsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Sunrise Sports Club")).toBeDefined();
    expect(screen.getByText("Blue Wave Academy")).toBeDefined();
    expect(screen.getByText(/2 leads in the pipeline/)).toBeDefined();
  });

  it("says so plainly when the selected stage has no leads", async () => {
    listLeadsMock.mockResolvedValue([
      lead({ id: "l1", businessName: "Sunrise Sports Club", status: "lead" }),
    ]);

    render(await LeadsPage({ searchParams: Promise.resolve({ stage: "trial" }) }));

    expect(screen.getByText(/No leads in the trial stage/)).toBeDefined();
  });
});
