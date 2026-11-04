// @vitest-environment jsdom
//
// The reviewed icon family (31 Oct 2026, tranche 2).
//
// Dot's ORIGINAL revision-1 glyphs (sixteen, one 24×24 grid) are
// integrated as typed static React — no dependency, no remote fetch, no
// raw HTML injection, and the reviewed geometry reproduced exactly.
//
// The family is DUOTONE: the primary slot and the secondary slot are
// two DIFFERENT theme tokens, pinned by the family itself. The two
// slots must stay DISTINCT — collapsing them to one colour would erase
// the contained interior detail (the enquiry dots, the fee detail, the
// member group).
//
// The family is used on TASK and MODULE surfaces only. It is not a
// complete role navigation set — there is no Home or Profile glyph and
// none is invented — so the role navigation keeps the icon set it has,
// and the familiar neutral micro-icons in dense tables and inline
// controls are preserved.
//
// These assertions are about the rendered result: the geometry, the
// tone slots, the sizing, the accessibility rules, and the real
// consumers that carry the family.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

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

// The reception Today page is a server component; only its data
// sources are replaced, so the real composition is rendered.
vi.mock("@/lib/auth/surface-guard", () => ({
  requireReception: async () => ({ roleKey: "reception" }),
}));
vi.mock("@/lib/auth/permission", () => ({
  hasPermission: () => true,
  hasFeature: () => true,
}));
vi.mock("@/lib/actions/coach", () => ({ getTodayAction: async () => ({ sessions: [] }) }));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ overrides: {}, locale: "en" }),
}));
vi.mock("@/lib/actions/staff-attendance", () => ({
  listStaffAttendanceDayAction: async () => [],
}));
vi.mock("@/components/reception-check-ins", () => ({
  ReceptionCheckIns: () => null,
}));
vi.mock("@/components/staff-attendance-board", () => ({
  StaffAttendanceBoard: () => null,
}));

// The Ops overview is a server component; only its data sources and
// the redirect are replaced.
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({ kind: "authenticated", role: "operator" }),
}));
vi.mock("@/db/platform-overview", () => ({
  getPlatformMetricsSummary: async () => ({
    asOf: new Date("2026-10-31T00:00:00Z"),
    activeTenants: 3,
    trialTenants: 1,
    atRiskTenants: 0,
    openOpsTasks: 0,
  }),
  getNeedsAttentionQueue: async () => [],
}));
vi.mock("@/db/platform-activity", () => ({
  listPlatformActivity: async () => ({ rows: [] }),
}));
vi.mock("@/lib/auth/ops-operation", () => ({
  runOpsGlobalRead: async (_op: string, read: () => Promise<unknown>) => read(),
}));
vi.mock("@/lib/messaging/provider", () => ({
  mockMessagingEnabled: () => true,
}));

import {
  KHEL_ICON_NAMES,
  KhelIcon,
  type KhelIconName,
} from "@/components/icons/khel-icons";
import { categoryIcon, SettingsTaskSurface } from "@/components/settings/settings-surfaces";
import { MyAttendanceCard } from "@/components/my-attendance-card";
import { MyLeaveCard } from "@/components/my-leave-card";
import { MyShiftsCard } from "@/components/my-shifts-card";
import { OwnerDashboard } from "@/components/owner-dashboard";
import ReceptionTodayPage from "@/app/(reception)/reception/page";
import PlatformHome from "@/app/(platform)/ops/page";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";

afterEach(cleanup);

const BRANDING = {
  displayName: "Splash Sports Club",
  shortName: "SSC",
  accent: "marine",
  fallbackDisplayName: "Splash Sports Club",
  fallbackShortName: "SSC",
  initials: "SS",
} as BrandingData;

const DASHBOARD = {
  tenantName: "Splash Sports Club",
  scopeLocationName: "Splash Pool",
  today: "2026-10-31",
  todayMarked: 0,
  todayTotal: 0,
  activeMemberCount: 8,
  attendanceThisWeekPct: null,
  activeBatchCount: 1,
  needsAttention: [],
  todaysLanes: [],
  nextClass: null,
  facilityBreakdown: [],
  money: {
    collectedTodayPaise: 2100000,
    collectedTodayCount: 2,
    outstandingPaise: 12600000,
    dueInvoiceCount: 4,
    overduePaise: 12600000,
    overdueInvoiceCount: 4,
    oldestOverdueDays: 12,
  },
} as OwnerDashboardData;

const CHARTS = {
  timezone: "Asia/Kolkata",
  period: {
    key: "last7",
    tabLabel: "Last 7 days",
    comparisonLabel: "7-day",
    comparisonMeaning: "seven days against the seven days before them",
    currentLabel: "25 Oct 2026 – 31 Oct 2026",
    previousLabel: "18 Oct 2026 – 24 Oct 2026",
    currentFromDate: "2026-10-25",
    currentToDate: "2026-10-31",
    previousFromDate: "2026-10-18",
    previousToDate: "2026-10-24",
    previousCapped: false,
    capNote: null,
  },
  collections: {
    buckets: [],
    groups: [],
    methods: [],
    totalPaise: 0,
    paymentCount: 0,
    previousTotalPaise: 0,
    previousPaymentCount: 0,
    previousIsZero: true,
    reversedPaise: 0,
    reversalCount: 0,
    comparison: "No previous collections in the comparison range",
  },
  attendance: {
    buckets: [],
    present: 0,
    total: 0,
    pct: null,
    previousPresent: 0,
    previousTotal: 0,
    previousPct: null,
    comparison: "No marks in either range",
  },
} as unknown as OwnerChartsData;

/** The rendered SVG of a glyph. */
function svg(name: KhelIconName) {
  const { container } = render(<KhelIcon name={name} />);
  return container.querySelector("svg")!;
}

describe("the reviewed icon family", () => {
  it("carries all sixteen reviewed glyphs", () => {
    expect(KHEL_ICON_NAMES.length).toBe(16);
    expect([...KHEL_ICON_NAMES].sort()).toEqual(
      [
        "announcements",
        "attendance",
        "audit-activity",
        "bookings",
        "cafe",
        "collect-payment",
        "enquiries",
        "facilities",
        "fees",
        "members",
        "programs",
        "reports",
        "schedule",
        "settings",
        "staff",
        "tenants",
      ].sort(),
    );
  });

  it("draws every glyph on the reviewed 24 grid", () => {
    for (const name of KHEL_ICON_NAMES) {
      const node = svg(name);
      expect(node.getAttribute("viewBox")).toBe("0 0 24 24");
      // The primary slot is PINNED to a theme token, so no consumer's
      // text colour can collapse the two slots into one colour.
      expect(node.getAttribute("fill")).toBe("var(--icon-primary, var(--color-ink-2))");
    }
  });

  it("keeps the two tone slots distinct, and never a study hex", () => {
    for (const name of KHEL_ICON_NAMES) {
      const node = svg(name);
      // The primary slot is a pinned theme token…
      const primary = node.getAttribute("fill") ?? "";
      expect(primary).toBe("var(--icon-primary, var(--color-ink-2))");
      // …and it is a DIFFERENT token from the secondary one.
      expect(primary).not.toContain("--color-ink-3");
      const fills = new Set(
        Array.from(node.querySelectorAll("[fill]")).map((el) =>
          el.getAttribute("fill"),
        ),
      );
      // …and the secondary slot is a THEME token, distinct from it.
      expect(fills.size).toBeGreaterThan(0);
      for (const fill of fills) {
        expect(fill).not.toBe(primary);
        expect(fill).toMatch(/^var\(--icon-secondary/);
        expect(fill).toContain("var(--color-ink-3)");
        // The study hexes never ship.
        expect(fill).not.toMatch(/#[0-9a-f]{3,8}/i);
      }
    }
  });

  it("reproduces the reviewed revision-1 geometry", () => {
    // The revised `programs` glyph: connected rising steps plus the
    // ascending arrow (revision 1 replaced the earlier reading).
    const programs = svg("programs");
    const steps = Array.from(programs.querySelectorAll("path")).find((p) =>
      (p.getAttribute("d") ?? "").startsWith("M3 16h5v-5h6V6h6"),
    );
    expect(steps).toBeTruthy();
    const arrow = Array.from(programs.querySelectorAll("path")).find((p) =>
      (p.getAttribute("d") ?? "").startsWith("M3 10 10 3H7V1h6"),
    );
    expect(arrow).toBeTruthy();

    // The fee receipt keeps its detail: two rules and a disc.
    const fees = svg("fees");
    expect(fees.querySelectorAll("rect").length).toBe(2);
    expect(fees.querySelectorAll("circle").length).toBe(1);

    // The member glyph keeps its SECOND person in the secondary slot.
    const members = svg("members");
    const group = members.querySelector("g");
    expect(group).toBeTruthy();
    expect(group?.getAttribute("fill")).toMatch(/^var\(--icon-secondary/);
  });

  it("is safe static markup — no script, handlers, references or bitmaps", () => {
    for (const name of KHEL_ICON_NAMES) {
      const node = svg(name);
      expect(node.querySelector("script")).toBeNull();
      expect(node.querySelector("image")).toBeNull();
      expect(node.querySelector("use")).toBeNull();
      expect(node.querySelector("foreignObject")).toBeNull();
      for (const el of Array.from(node.querySelectorAll("*"))) {
        for (const attr of Array.from(el.attributes)) {
          expect(attr.name.startsWith("on")).toBe(false);
          expect(attr.value).not.toMatch(/javascript:/i);
          expect(attr.value).not.toMatch(/url\(/i);
          expect(attr.name).not.toBe("href");
          expect(attr.name).not.toBe("xlink:href");
        }
      }
    }
  });

  it("is decorative by default and labelled on request", () => {
    const plain = svg("fees");
    expect(plain.getAttribute("aria-hidden")).toBe("true");
    expect(plain.getAttribute("role")).toBeNull();
    expect(plain.querySelector("title")).toBeNull();

    const { container } = render(<KhelIcon name="fees" title="Fees" />);
    const named = container.querySelector("svg")!;
    expect(named.getAttribute("role")).toBe("img");
    expect(named.getAttribute("aria-hidden")).toBeNull();
    expect(named.querySelector("title")?.textContent).toBe("Fees");
  });

  it("draws at the sizes the family is designed for", () => {
    for (const size of [16, 20, 24, 32] as const) {
      const { container } = render(<KhelIcon name="members" size={size} />);
      const node = container.querySelector("svg")!;
      expect(node.getAttribute("width")).toBe(String(size));
      expect(node.getAttribute("height")).toBe(String(size));
    }
  });
});

describe("the family is used on real module surfaces", () => {
  it("gives each Owner settings category a family glyph", () => {
    // 2 Nov 2026: the Owner Settings category headings draw the shared
    // OUTLINE Owner glyph, not the filled/duotone Khel family. The mock's
    // own outline pack names PLACES, so the mapping is explicit:
    // academy→pin, programs→programs, fees→money, team→staff,
    // communications→bell, appearance→settings.
    expect(categoryIcon("academy")).toBe("pin");
    expect(categoryIcon("programs")).toBe("programs");
    expect(categoryIcon("fees")).toBe("money");
    expect(categoryIcon("team")).toBe("staff");
    expect(categoryIcon("communications")).toBe("bell");
    expect(categoryIcon("appearance")).toBe("settings");

    // The drawn glyph is the approved OUTLINE: one 24x24 box, no fill, the
    // current colour as the stroke, 1.8 stroke, round caps and joins, and it
    // is decorative beside the category's own words. "Some outline icon"
    // would pass for any icon, so the drawing itself is checked.
    const { container } = render(
      <SettingsTaskSurface title="Fees & payments" icon={categoryIcon("fees")}>
        {null}
      </SettingsTaskSurface>,
    );
    const glyph = container.querySelector("svg")!;
    expect(glyph.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(glyph.getAttribute("fill")).toBe("none");
    expect(glyph.getAttribute("stroke")).toBe("currentColor");
    expect(glyph.getAttribute("stroke-width")).toBe("1.8");
    expect(glyph.getAttribute("stroke-linecap")).toBe("round");
    expect(glyph.getAttribute("stroke-linejoin")).toBe("round");
    expect(glyph.getAttribute("aria-hidden")).toBe("true");
    // The approved mock's own `money` geometry: a card, its rule and its detail.
    const rect = glyph.querySelector("rect");
    expect(rect?.getAttribute("x")).toBe("3.5");
    expect(rect?.getAttribute("y")).toBe("6");
    expect(rect?.getAttribute("width")).toBe("17");
    expect(rect?.getAttribute("height")).toBe("12");
    expect(rect?.getAttribute("rx")).toBe("2");
    const paths = Array.from(glyph.querySelectorAll("path")).map((path) =>
      path.getAttribute("d"),
    );
    expect(paths).toEqual(["M3.5 10.5h17", "M7 14.5h4"]);
    // The surface keeps its own heading words; the glyph is only a cue.
    expect(container.querySelector("h2")?.textContent).toBe("Fees & payments");
  });

  it("gives each reception Today entry a family glyph", async () => {
    render(await ReceptionTodayPage());
    const entries: Array<[string, KhelIconName]> = [
      ["collect-payment-link", "collect-payment"],
      ["close-day-link", "audit-activity"],
      ["dues-link", "fees"],
      ["member-search-link", "members"],
      ["cafe-link", "cafe"],
    ];
    for (const [testId, name] of entries) {
      const entry = screen.getByTestId(testId);
      const icon = entry.querySelector(`svg[data-icon="${name}"]`);
      expect(icon).toBeTruthy();
      // The glyph is a cue, not the hit area: the entry keeps its own
      // comfortable target.
      expect(entry.getAttribute("class") ?? "").toMatch(/\bmin-h-\[?\d/);
    }
  });

  it("keeps the manual UPI confirmation on the collect-payment entry", async () => {
    render(await ReceptionTodayPage());
    const entry = screen.getByTestId("collect-payment-link");
    expect(entry.textContent ?? "").toMatch(/verif|confirm/i);
  });

  it("gives each staff self-service card a family glyph", () => {
    const shifts = render(<MyShiftsCard shifts={[]} />);
    expect(shifts.container.querySelector('svg[data-icon="schedule"]')).toBeTruthy();
    shifts.unmount();

    const attendance = render(
      <MyAttendanceCard attendance={null} />,
    );
    expect(attendance.container.querySelector('svg[data-icon="attendance"]')).toBeTruthy();
    attendance.unmount();

    // The reviewed family has NO leave glyph, so the familiar neutral
    // palm-tree micro-icon stays: a custom glyph is not forced onto a
    // concept the family does not express.
    const leave = render(
      <MyLeaveCard types={[]} balances={[]} requests={[]} />,
    );
    expect(leave.container.querySelector("svg[data-icon]")).toBeNull();
    expect(leave.container.querySelector("svg.lucide")).toBeTruthy();
  });

  it("gives the Owner Home collections action its glyph, and no quick-action box", () => {
    render(
      <OwnerDashboard
        data={DASHBOARD as never}
        branding={BRANDING as never}
        terminology={{ overrides: {}, locale: "en" } as never}
        can={{
          addMember: true,
          recordPayment: true,
          captureEnquiry: true,
          readFees: true,
          viewSchedule: true,
          readEnquiries: true,
          // Every destination the caller may open is offered, so every
          // quick action is checked here.
          readPrograms: true,
          readStaff: true,
          bookCourt: true,
        }}
        chartsData={CHARTS as never}
      />,
    );
    // The Quick actions box left Home (owner mock, 2 Nov 2026). The one
    // contextual action now lives inside the collections card, and the
    // owner's own glyphs are the shared outline OwnerIcon (foundation) —
    // the exact geometry is pinned against the approved mock in
    // tests/owner-light-20261102/home/owner-home-collections-hero.test.tsx.
    const actions = document.querySelector('[data-testid="owner-home-actions"]');
    expect(actions).toBeNull();
    const card = screen.getByRole("region", { name: "Collections" });
    const collect = within(card).getByRole("link", { name: /record payment/i });
    // The shared Owner's own money geometry — the approved mock's 24×
    // 24 outline (no fill, currentColor stroke at 1.8, round caps and
    // joins) drawn at 16px. "Some svg is present" would pass for any
    // icon, so the drawing itself is identified here (the same proof the
    // owner today-screen suite carries).
    const glyph = collect.querySelector("svg");
    expect(glyph, "the action carries the shared outline glyph").toBeTruthy();
    expect(glyph?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(glyph?.getAttribute("fill")).toBe("none");
    expect(glyph?.getAttribute("stroke")).toBe("currentColor");
    expect(glyph?.getAttribute("stroke-width")).toBe("1.8");
    expect(glyph?.getAttribute("stroke-linecap")).toBe("round");
    expect(glyph?.getAttribute("stroke-linejoin")).toBe("round");
    expect(glyph?.getAttribute("width")).toBe("16");
    expect(glyph?.getAttribute("height")).toBe("16");
    const rect = glyph?.querySelector("rect");
    expect(rect?.getAttribute("x")).toBe("3.5");
    expect(rect?.getAttribute("y")).toBe("6");
    expect(rect?.getAttribute("width")).toBe("17");
    expect(rect?.getAttribute("height")).toBe("12");
    expect(rect?.getAttribute("rx")).toBe("2");
    const paths = Array.from(glyph?.querySelectorAll("path") ?? []).map((path) =>
      path.getAttribute("d"),
    );
    expect(paths).toEqual(["M3.5 10.5h17", "M7 14.5h4"]);
  });

  it("gives each Ops module entry a family glyph", async () => {
    render(await PlatformHome());
    const icons = Array.from(document.querySelectorAll("svg[data-icon]")).map(
      (node) => node.getAttribute("data-icon"),
    );
    for (const name of ["tenants", "audit-activity", "settings", "enquiries", "announcements"]) {
      expect(icons).toContain(name);
    }
  });
});
