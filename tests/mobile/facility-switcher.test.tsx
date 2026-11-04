// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// W1-6 (docs/role-surfaces-plan.md) — the owner facility switcher and
// consolidated view. The switcher appears on every owner screen only
// when the tenant has more than one facility, persists the choice in
// `?facility=`, and the members list filters on it.
//
// The facility in scope is stated ONCE, by the shell's switcher: the
// approved light Home (the 2 November 2026 owner mock) opens with the
// greeting and the club's own day, and does NOT repeat the scope under
// the date. One fact, one owner — DESIGN.md, owner light amendment.
//
// Wave 1 limitation (documented in the plan): only member-scoped data
// can be split by facility today — batches/sessions have no location
// until Wave 2.

const navigate = vi.hoisted(() => vi.fn());
const query = vi.hoisted(() => ({ value: "" }));
vi.mock("@/components/facility-navigation", () => ({ navigateFacility: navigate }));
const { LOCATIONS, FACILITY_2 } = vi.hoisted(() => ({
  FACILITY_2: "22222222-2222-7222-8222-222222222222",
  LOCATIONS: [
    { id: "11111111-1111-7111-8111-111111111111", name: "Worli Main" },
    { id: "22222222-2222-7222-8222-222222222222", name: "Bandra Annex" },
  ],
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/owner/members",
  useSearchParams: () => new URLSearchParams(query.value),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});
vi.mock("@/lib/actions/tenant-auth", () => ({ logoutTenantAction: vi.fn() }));
vi.mock("@/lib/actions/people", () => ({
  listMembersAction: vi.fn(async () => []),
  listLocationsAction: vi.fn(async () => []),
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ overrides: {}, locale: "en" }),
}));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    roleKey: "owner",
    permissions: new Set(["members.read", "members.write"]),
  }),
  requirePagePermission: (ctx: unknown) => ctx,
}));
vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => ({
    tenantId: "t1",
    roleKey: "owner",
    permissions: new Set([
      "members.read",
      "invoices.read",
      "enquiries.read",
      "messaging.send",
      "programs.read",
      "staff.read",
      "reports.operational",
      "settings.manage",
    ]),
    features: new Set(),
  }),
}));
vi.mock("@/lib/auth/surface-access", () => ({
  canAccessSurface: () => true,
  SURFACE_OWNER: "owner",
}));
// Owner Lavender B (27 October 2026): the owner layout now also reads
// the academy's branding, so the shell can name the club in its
// sidebar. It is the same cheap single-row read the Home page makes.
vi.mock("@/lib/services/branding", () => ({
  getBranding: async () => ({
    displayName: "Aqua Worli",
    shortName: "AW",
    accent: "mango",
    fallbackDisplayName: "Aqua Worli",
    fallbackShortName: "AW",
    initials: "AW",
  }),
}));
vi.mock("@/lib/services/people", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/people")>();
  return { ...actual, listLocations: async () => LOCATIONS };
});

import { FacilitySwitcher } from "@/components/facility-switcher";
import { OwnerDashboard } from "@/components/owner-dashboard";
import MembersPage from "@/app/(owner)/owner/members/page";
import OwnerLayout from "@/app/(owner)/layout";
import { listMembersAction } from "@/lib/actions/people";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";

const TERMINOLOGY = { overrides: {}, locale: "en" } as const;

const DASHBOARD: OwnerDashboardData = {
  tenantName: "Aqua",
    scopeLocationName: null,
  today: "2026-09-13",
  todayMarked: 0,
  todayTotal: 0,
  activeMemberCount: 32,
  attendanceThisWeekPct: null,
  activeBatchCount: 4,
  money: {
    collectedTodayPaise: 0,
    collectedTodayCount: 0,
    outstandingPaise: 0,
    dueInvoiceCount: 0,
    overduePaise: 0,
    overdueInvoiceCount: 0,
      oldestOverdueDays: null,
  },
  needsAttention: [],
  todaysLanes: [],
  nextClass: null,
  facilityBreakdown: [
    { locationId: "loc-1", locationName: "Worli Main", activeMembers: 20, attendancePct: 80 },
    { locationId: "loc-2", locationName: "Bandra Annex", activeMembers: 12, attendancePct: null },
  ],
};

const BRANDING = {
  displayName: "Aqua",
  shortName: "AQ",
  accent: "mango",
  fallbackDisplayName: "Aqua",
  fallbackShortName: "AQ",
  initials: "AQ",
} as BrandingData;

afterEach(() => {
  cleanup();
  document.cookie = "aqua_facility=; path=/; max-age=0";
  query.value = "";
  vi.clearAllMocks();
});

describe("facility switcher (W1-6)", () => {
  it("is hidden for a single-facility tenant", () => {
    const { container } = render(<FacilitySwitcher locations={[LOCATIONS[0]!]} />);
    expect(container.querySelector('[data-testid="facility-switcher"]')).toBeNull();
  });

  it("offers All facilities plus each facility", () => {
    render(<FacilitySwitcher locations={LOCATIONS} />);
    const select = screen.getByTestId("facility-switcher") as HTMLSelectElement;
    expect(select.value).toBe("all");
    expect(screen.getByRole("option", { name: "All facilities" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Bandra Annex" })).toBeTruthy();
  });

  it("persists the choice in the URL and the cookie", () => {
    query.value = "period=month";
    render(<FacilitySwitcher locations={LOCATIONS} />);
    fireEvent.change(screen.getByTestId("facility-switcher"), {
      target: { value: FACILITY_2 },
    });
    expect(navigate).toHaveBeenCalledWith(`/owner/members?period=month&facility=${FACILITY_2}`);
    expect(document.cookie).toContain(`aqua_facility=${encodeURIComponent(FACILITY_2)}`);
  });

  it("adopts a remembered cookie when the URL has no choice", () => {
    query.value = "period=month";
    document.cookie = `aqua_facility=${encodeURIComponent(FACILITY_2)}; path=/`;
    render(<FacilitySwitcher locations={LOCATIONS} />);
    expect(navigate).toHaveBeenCalledWith(`/owner/members?period=month&facility=${FACILITY_2}`, true);
    document.cookie = "aqua_facility=; path=/; max-age=0";
  });

  it("ignores an invalid remembered facility and follows URL changes", () => {
    document.cookie = "aqua_facility=not-a-uuid; path=/";
    const view = render(<FacilitySwitcher locations={LOCATIONS} />);
    expect(navigate).not.toHaveBeenCalled();
    query.value = `facility=${FACILITY_2}`;
    view.rerender(<FacilitySwitcher locations={LOCATIONS} />);
    expect((screen.getByTestId("facility-switcher") as HTMLSelectElement).value).toBe(FACILITY_2);
    query.value = "";
    view.rerender(<FacilitySwitcher locations={LOCATIONS} />);
    expect((screen.getByTestId("facility-switcher") as HTMLSelectElement).value).toBe("all");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("clears the facility preference without losing other filters", () => {
    query.value = `period=day&facility=${FACILITY_2}`;
    document.cookie = `aqua_facility=${FACILITY_2}; path=/`;
    render(<FacilitySwitcher locations={LOCATIONS} />);
    fireEvent.change(screen.getByTestId("facility-switcher"), { target: { value: "all" } });
    expect(navigate).toHaveBeenCalledWith("/owner/members?period=day");
    expect(document.cookie).not.toContain("aqua_facility=");
  });
});

describe("owner members page reads ?facility= (W1-6)", () => {
  it("passes the facility filter to the list action", async () => {
    // The directory is a STREAMED section: the read happens inside the
    // async boundary, so the page resolves inside an async act.
    const page = await MembersPage({
      searchParams: Promise.resolve({ facility: FACILITY_2 }),
    });
    await act(async () => {
      render(page);
    });
    expect(listMembersAction).toHaveBeenCalledWith({ locationId: FACILITY_2 });
  });

  it("ignores a malformed facility value", async () => {
    const page = await MembersPage({
      searchParams: Promise.resolve({ facility: "not-a-uuid" }),
    });
    await act(async () => {
      render(page);
    });
    expect(listMembersAction).toHaveBeenCalledWith({});
  });
});

describe("owner layout hosts the switcher (W1-6)", () => {
  it("renders the switcher when the tenant has multiple facilities", async () => {
    const layout = await OwnerLayout({ children: null });
    render(layout);
    const control = screen.getByTestId("facility-switcher") as HTMLSelectElement;
    expect(control).toBeTruthy();
    // The scope is stated HERE, once: every location of the tenant is
    // offered, and the current selection is the control's own value.
    expect(
      Array.from(control.options).map((option) => option.textContent),
    ).toEqual(["All facilities", "Worli Main", "Bandra Annex"]);
    expect(control.value).toBe("all");
  });
});

describe("consolidated per-facility view (W1-6)", () => {
  it("states the facility scope once — in the shell switcher, not on Home", () => {
    // The approved light Home opens with the greeting and the club's own
    // day. The scope belongs to the shell's switcher, so Home must not
    // print it a second time under the date, and must not repeat the
    // per-facility figures the figures carry either.
    render(
      <OwnerDashboard data={DASHBOARD} branding={BRANDING} terminology={TERMINOLOGY} />,
    );
    // The day IS stated, so this is not a vacuous pass over an empty page.
    expect(document.body.textContent).toContain("13 Sept 2026");
    // The scope is NOT stated here: neither the collective label nor the
    // location names behind it.
    expect(document.body.textContent).not.toContain("All locations");
    expect(document.body.textContent).not.toContain("Worli Main");
    expect(document.body.textContent).not.toContain("Bandra Annex");
    // The per-facility figures are not repeated either — and they carry
    // no attendance window of their own; the selected-period attendance
    // panel is the one attendance overview on the page.
    expect(document.body.textContent).not.toContain("20 active");
    expect(document.body.textContent).not.toContain("no attendance yet");
  });

  it("does not repeat a NAMED facility scope on Home either", () => {
    // The figures may cover ONE named location. The scope still belongs
    // to the shell's switcher, so Home must not print it a second time.
    render(
      <OwnerDashboard
        data={{ ...DASHBOARD, scopeLocationName: "Worli Main" }}
        branding={BRANDING}
        terminology={TERMINOLOGY}
      />,
    );
    expect(document.body.textContent).toContain("13 Sept 2026");
    expect(document.body.textContent).not.toContain("Worli Main");
  });
});
