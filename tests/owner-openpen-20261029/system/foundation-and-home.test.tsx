// @vitest-environment jsdom
//
// Owner OpenPen · system lane — shared foundation and Home composition.
//
// The human supplied an exact reference composition. These tests pin the
// parts a later Chrome pass can measure: the owner-scoped nav palette,
// the 190px/62px shell frame, the one explicit page inset, the reference
// heading rhythm, Home's money+decision lead with sessions+capacity
// following, and the semantic session tone used by the reference.
//
// The data below is synthetic test input. No reference amount or identity
// is copied into product code.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [key: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/owner",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/actions/global-search", () => ({
  globalSearchAction: vi.fn(async () => []),
}));

import { OwnerShell } from "@/components/owner-shell";
import { OwnerDashboard } from "@/components/owner-dashboard";
import OwnerHomeLoading from "@/app/(owner)/owner/loading";
import { OWNER_SIDEBAR_GROUPS, TENANT_SURFACE_NAV } from "@/lib/nav";
import { SESSION_STATUS_TONE } from "@/components/ui/StatusBadge";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";

const GLOBALS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

function block(selector: string): string {
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`,
  );
  const match = pattern.exec(GLOBALS);
  if (!match) throw new Error(`missing ${selector}`);
  const open = GLOBALS.indexOf("{", match.index);
  let depth = 0;
  for (let i = open; i < GLOBALS.length; i++) {
    if (GLOBALS[i] === "{") depth++;
    if (GLOBALS[i] === "}") {
      depth--;
      if (depth === 0) return GLOBALS.slice(open + 1, i);
    }
  }
  throw new Error(`unclosed ${selector}`);
}

const MINT = `${block("@theme")}\n${block(":root")}`;
const LAVENDER = block('[data-theme="lavender"]');

function token(source: string, name: string): string {
  const match = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(source);
  if (!match) throw new Error(`${name} missing`);
  return match[1]!.trim().toUpperCase();
}

function luminance(hex: string): number {
  const full = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const BRANDING = {
  displayName: "Synthetic Sports Club",
  shortName: "SSC",
  accent: "marine",
  fallbackDisplayName: "Synthetic Sports Club",
  fallbackShortName: "SSC",
  initials: "SS",
} as BrandingData;

const TERMINOLOGY = { overrides: {}, locale: "en" } as const;

const CAN = {
  addMember: true,
  recordPayment: true,
  captureEnquiry: true,
  readFees: true,
  viewSchedule: true,
  readEnquiries: true,
};

function lane(id: string, name: string, enrolled: number, capacity: number) {
  return {
    sessionId: id,
    batchId: `b-${id}`,
    batchName: name,
    programName: "Learn to swim",
    startTime: "06:00:00",
    enrolled,
    capacity,
    coachName: "Synthetic Coach",
    marked: 1,
    started: true,
  };
}

function dashboard(overrides: Partial<OwnerDashboardData> = {}): OwnerDashboardData {
  return {
    tenantName: "Synthetic Sports Club",
    scopeLocationName: "Synthetic Pool",
    today: "2026-10-27",
    todayMarked: 2,
    todayTotal: 18,
    activeMemberCount: 24,
    attendanceThisWeekPct: null,
    activeBatchCount: 3,
    needsAttention: [],
    todaysLanes: [
      lane("s1", "Morning Squad", 12, 12),
      lane("s2", "Junior TTS", 8, 16),
    ],
    nextClass: null,
    facilityBreakdown: [],
    money: {
      collectedTodayPaise: 1820000,
      collectedTodayCount: 4,
      outstandingPaise: 4280000,
      dueInvoiceCount: 6,
      overduePaise: 1260000,
      overdueInvoiceCount: 3,
      oldestOverdueDays: 12,
    },
    ...overrides,
  } as OwnerDashboardData;
}

afterEach(cleanup);

describe("owner-scoped OpenPen tokens", () => {
  it("declares the deep-plum Lavender and pale-green Mint navigation surfaces", () => {
    expect(token(LAVENDER, "--owner-nav-surface")).toBe("#302044");
    expect(token(MINT, "--owner-nav-surface")).toBe("#E0EEE5");
    expect(token(LAVENDER, "--owner-nav-ink")).toBe("#EFE9F9");
    expect(token(MINT, "--owner-nav-ink")).toBe("#244536");
  });

  it("keeps navigation text at AA on each preset's own sidebar", () => {
    for (const preset of [MINT, LAVENDER]) {
      const surface = token(preset, "--owner-nav-surface");
      for (const name of ["--owner-nav-ink", "--owner-nav-muted"]) {
        expect(
          contrast(token(preset, name), surface),
          `${name} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the reference 16px owner surface radius without changing Ops", () => {
    expect(token(MINT, "--radius-owner")).toBe("16PX");
    expect(GLOBALS).toContain("[data-owner-surface]");
    expect(block("[data-owner-surface]")).toContain(
      "--radius-card: var(--radius-owner)",
    );
  });

  it("keeps the accent selection owner-scoped and legible in both themes", () => {
    for (const preset of [MINT, LAVENDER]) {
      expect(contrast(token(preset, "--accent-ink"), token(preset, "--accent-soft"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(preset, "--accent-strong"), token(preset, "--accent-soft"))).toBeGreaterThanOrEqual(3);
    }
    const ownerScope = block("[data-owner-surface]");
    expect(ownerScope).toContain("--selected-surface: var(--accent-soft)");
    expect(ownerScope).toContain("--selected-ink: var(--accent-ink)");
    expect(ownerScope).toContain("--owner-nav-focus: var(--accent-strong)");
  });

  it("gives the dark owner sidebar a keyboard focus ring visible on both row states", () => {
    const ring = token(LAVENDER, "--owner-nav-focus");
    expect(contrast(ring, token(LAVENDER, "--owner-nav-surface"))).toBeGreaterThanOrEqual(3);
    expect(contrast(ring, token(LAVENDER, "--owner-nav-active"))).toBeGreaterThanOrEqual(3);
    // The ring is scoped inside the owner sidebar; the global preset ring is
    // not rewritten.
    expect(token(LAVENDER, "--focus-ring")).not.toBe(ring);
  });
});

describe("owner shell — the reference frame", () => {
  function renderShell() {
    return render(
      <OwnerShell navItems={TENANT_SURFACE_NAV.owner} locations={[]}>
        <p>Page content</p>
      </OwnerShell>,
    );
  }

  it("is 190px wide with a 62px header and no horizontal shell inset", () => {
    renderShell();
    const sidebar = screen.getByTestId("owner-sidebar");
    expect(sidebar.className).toContain("lg:w-[190px]");
    const header = screen.getByTestId("owner-top-bar");
    expect(header.className).toContain("lg:min-h-[62px]");
    const content = screen.getByTestId("owner-content");
    expect(content.className).not.toMatch(/lg:px-(?:8|7|5|4)/);
  });

  it("names the product and the club, and keeps account access in the header", () => {
    render(
      <OwnerShell
        navItems={TENANT_SURFACE_NAV.owner}
        locations={[]}
        clubName="Synthetic Sports Club"
        clubInitials="SS"
        accountLabel="Club owner"
      >
        <p>Page content</p>
      </OwnerShell>,
    );
    const sidebar = screen.getByTestId("owner-sidebar");
    expect(within(sidebar).getByText("KhelSuite")).toBeTruthy();
    expect(within(sidebar).getByText("Synthetic Sports Club")).toBeTruthy();
    expect(within(sidebar).getByText("Owner workspace")).toBeTruthy();
    const header = screen.getByTestId("owner-top-bar");
    expect(within(header).getByTestId("owner-header-account")).toBeTruthy();
  });

  it("mirrors the reference navigation groups and order", () => {
    expect(OWNER_SIDEBAR_GROUPS.map((group) => group.label)).toEqual([
      "Main",
      "Operations",
      "Scheduling",
      "Account",
    ]);
    const account = OWNER_SIDEBAR_GROUPS.find((group) => group.label === "Account");
    expect(account?.items.map((item) => item.href)).toEqual([
      "/owner/reports",
      "/owner/settings",
    ]);
  });

  it("keeps the four-item phone navigation and the sign-out path", () => {
    renderShell();
    expect(within(screen.getByTestId("owner-mobile-nav")).getAllByRole("link")).toHaveLength(4);
    fireEvent.click(within(screen.getByTestId("owner-header-account")).getByText("Account"));
    expect(within(screen.getByTestId("owner-header-account")).getByRole("button", { name: /sign out/i })).toBeTruthy();
  });
});

describe("owner Home loading — valid markup", () => {
  it("never nests a Skeleton div inside a paragraph", () => {
    const { container } = render(<OwnerHomeLoading />);
    expect(container.querySelector("p div")).toBeNull();
    const compact = screen.getByTestId("owner-home-loading-summary");
    expect(compact.tagName).not.toBe("P");
  });
});

describe("owner Home — the reference arrangement", () => {
  it("opens with the reference heading and the real context", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={CAN}
      />,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Welcome" });
    expect(heading).toBeTruthy();
    expect(heading.className).toContain("text-2xl");
    const context = screen.getByTestId("owner-home-context").textContent ?? "";
    expect(context).toContain("Tue, 27 Oct 2026");
    expect(context).toContain("Synthetic Pool");
  });

  it("puts paired collections before the separate daily actions", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={CAN}
      />,
    );
    const lead = screen.getByTestId("owner-home-lead");
    const money = within(lead).getByTestId("owner-home-money-surface");
    expect(money.textContent).toContain("Today");
    expect(money.textContent).toContain("Last 7 days");
    expect(money.textContent).toContain("₹18,200");
    expect(within(money).queryByTestId("owner-home-actions")).toBeNull();
    expect(screen.getByTestId("owner-home-actions")).toBeTruthy();
    // The old four equal KPI tiles are not the reference money hierarchy.
    expect(screen.queryAllByTestId("stat-card")).toHaveLength(0);
    expect(screen.queryByTestId("owner-home-attention")).toBeNull();
  });

  it("leaves outstanding and overdue liabilities to Fees", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={CAN}
      />,
    );
    const money = screen.getByTestId("owner-home-money-surface");
    expect(money.textContent).not.toContain("₹42,800");
    expect(money.textContent).not.toContain("₹12,600");
    expect(screen.getByRole("link", { name: /open invoices/i }).getAttribute("href")).toContain("tab=dues");
  });

  it("shows a true zero collection without claiming liabilities are healthy", () => {
    render(
      <OwnerDashboard
        data={dashboard({
          money: {
            collectedTodayPaise: 0,
            collectedTodayCount: 0,
            outstandingPaise: 0,
            dueInvoiceCount: 0,
            overduePaise: 0,
            overdueInvoiceCount: 0,
            oldestOverdueDays: null,
          },
        })}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={CAN}
      />,
    );
    const calm = screen.getByTestId("owner-home-money-surface").textContent ?? "";
    expect(calm).toContain("₹0");
    expect(calm).not.toContain("Nothing past due");
  });

  it("follows the work with today's sessions and their real occupancy", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={CAN}
      />,
    );
    const work = screen.getByTestId("owner-home-work");
    const sessions = within(work).getByTestId("owner-home-today");
    expect(sessions).toBeTruthy();
    // The session ROW is the one display owner of the day's occupancy:
    // there is no second capacity card printing the same facts.
    expect(within(work).queryByTestId("owner-home-capacity")).toBeNull();
    expect(sessions.textContent).toContain("Morning Squad");
    expect(sessions.textContent).toContain("12 / 12");
    expect(sessions.textContent).toContain("Junior TTS");
    expect(sessions.textContent).toContain("8 / 16");
    // …and the progress meter still names its own batch.
    expect(
      within(sessions).getByRole("progressbar", { name: "Morning Squad capacity" }),
    ).toBeTruthy();
  });

  it("keeps session lifecycle meaning stable, with cancellation visibly negative", () => {
    expect(SESSION_STATUS_TONE.cancelled).toBe("late");
    expect(SESSION_STATUS_TONE.scheduled).toBe("water");
  });
});
