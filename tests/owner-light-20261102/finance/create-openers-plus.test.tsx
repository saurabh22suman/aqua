// @vitest-environment jsdom
//
// Finance lane — intended RED (3 November 2026): four creation OPENERS still
// lack the approved outline plus. Actual Chrome found:
//
//   * Settings → Activities   "Add activity" disclosure
//   * Settings → Holidays     "Add holiday" disclosure
//   * Settings → Locations    "Add location" opener
//   * Settings → Payment QR   "Add a payment QR" opener
//
// The reviewed shared Owner outline `plus` (Foundation-owned, read-only
// `components/owner-ui/owner-icon.tsx`: 24x24, fill=none, stroke=currentColor,
// stroke-width 1.8, round caps/joins, decorative) is the only addition: it sits
// beside the existing label, and an open/Close/Cancel state must never keep a
// misleading plus. No new form, modal, FAB, label, flow, gate or data change.
//
// jsdom does not compute stylesheets, so the collapse/open rule is asserted as
// declared (`group-open:hidden` / conditional render); the actual paint is
// Root's Chrome check.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    __esModule: true,
    default: ({ href, children }: { href?: unknown; children?: unknown }) =>
      React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#" },
        children as React.ReactNode,
      ),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/actions/activities", () => ({
  addSubUnitAction: vi.fn(),
  createActivityAction: vi.fn(),
  deleteActivityAction: vi.fn(),
  removeSubUnitAction: vi.fn(),
  updateActivityAction: vi.fn(),
}));
vi.mock("@/lib/actions/holidays", () => ({
  addHolidayAction: vi.fn(),
  removeHolidayAction: vi.fn(),
}));
vi.mock("@/lib/actions/locations", () => ({
  createLocationAction: vi.fn(),
  listAdminLocationsAction: vi.fn(async () => []),
  updateLocationAction: vi.fn(),
}));
vi.mock("@/lib/actions/payment-qrs", () => ({
  createPaymentQrAction: vi.fn(),
  deletePaymentQrAction: vi.fn(),
  updatePaymentQrAction: vi.fn(),
}));

import { ActivityManager } from "@/components/activity-manager";
import { HolidaysBoard } from "@/components/holidays-board";
import { LocationManager } from "@/components/settings/location-manager";
import { PaymentQrManager } from "@/components/payment-qr-manager";

const LOC = { id: "11111111-1111-4111-8111-111111111111", name: "Worli" };

const PLUS_PATH = "M12 5v14M5 12h14";

/** The approved outline plus inside a rendered subtree, or undefined. */
function approvedPlus(root: ParentNode) {
  return Array.from(root.querySelectorAll("svg")).find((svg) =>
    Array.from(svg.querySelectorAll("path")).some(
      (path) => path.getAttribute("d") === PLUS_PATH,
    ),
  );
}

function expectApprovedOutline(svg: Element | undefined, label: string) {
  expect(svg, `${label} carries the approved outline plus`).toBeTruthy();
  expect(svg!.getAttribute("viewBox")).toBe("0 0 24 24");
  expect(svg!.getAttribute("fill")).toBe("none");
  expect(svg!.getAttribute("stroke")).toBe("currentColor");
  expect(svg!.getAttribute("stroke-width")).toBe("1.8");
  expect(svg!.getAttribute("stroke-linecap")).toBe("round");
  expect(svg!.getAttribute("stroke-linejoin")).toBe("round");
  expect(svg!.getAttribute("aria-hidden")).toBe("true");
}

/** The summary whose label starts with the given text (the form's own submit
 *  button can share the same words, so never match by text alone). */
function disclosureSummary(label: string): HTMLElement {
  const summary = Array.from(document.querySelectorAll("summary")).find(
    (candidate) => candidate.textContent?.trim().startsWith(label),
  );
  expect(summary, `the "${label}" disclosure exists`).toBeTruthy();
  return summary!;
}

afterEach(cleanup);

describe("creation openers carry the approved plus", () => {
  it("decorates the Add activity disclosure and drops the plus when open", () => {
    const { container } = render(
      <ActivityManager locations={[LOC]} activities={[]} />,
    );
    const summary = disclosureSummary("Add activity");
    expectApprovedOutline(approvedPlus(summary), "Add activity");

    // The collapsed cue is creation-only: the plus hides when open and the
    // disclosure's chevron turns up. No new control was introduced.
    const plus = approvedPlus(summary)!;
    expect(plus.getAttribute("class") ?? "").toContain("group-open:hidden");
    expect(summary.closest("details")!.getAttribute("class") ?? "").toContain(
      "group",
    );
    expect(container.querySelector("summary")?.textContent).toContain(
      "Add activity",
    );
  });

  it("decorates the Add holiday disclosure and drops the plus when open", () => {
    render(<HolidaysBoard initialHolidays={[]} />);
    const summary = disclosureSummary("Add holiday");
    expectApprovedOutline(approvedPlus(summary), "Add holiday");

    const plus = approvedPlus(summary)!;
    expect(plus.getAttribute("class") ?? "").toContain("group-open:hidden");
    expect(summary.closest("details")!.getAttribute("class") ?? "").toContain(
      "group",
    );
  });

  it("decorates the Add location opener, which disappears once it opens", () => {
    render(<LocationManager initial={[]} canWrite />);
    const opener = screen.getByRole("button", { name: /Add location/i });
    expect(within(opener).getByText("Add location")).toBeTruthy();
    expectApprovedOutline(approvedPlus(opener), "Add location");

    // One clear entry: opening replaces the button with the existing form, so
    // no stale plus (and no second create control) remains on screen.
    fireEvent.click(opener);
    expect(screen.queryByRole("button", { name: /Add location/i })).toBeNull();
    expect(approvedPlus(document.body)).toBeUndefined();
  });

  it("decorates the Add a payment QR opener and drops the plus on Close", () => {
    render(<PaymentQrManager qrs={[]} />);
    // The approved flow keeps exactly one toggle opener (the heading is not a
    // control); the empty-state copy stays as it is.
    expect(
      screen.getAllByRole("button", { name: "Add a payment QR" }),
    ).toHaveLength(1);
    const opener = screen.getByRole("button", { name: "Add a payment QR" });
    expectApprovedOutline(approvedPlus(opener), "Add a payment QR");

    fireEvent.click(opener);
    const close = screen.getByRole("button", { name: "Close" });
    // A Close state must never retain a misleading plus.
    expect(approvedPlus(close)).toBeUndefined();
    // Still exactly one opener, and the section heading is unchanged.
    expect(screen.queryByRole("button", { name: "Add a payment QR" })).toBeNull();
  });
});
