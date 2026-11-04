// @vitest-environment jsdom
//
// The Ops activity filter — the NARROW layout contract (tranche 3,
// 31 Oct 2026; revised the same day).
//
// THE INDEPENDENT REAL-BROWSER RED. The coordinator's production Chrome
// review measured the Ops activity filter's time controls at 390×844 in
// BOTH themes and found the AM/PM select CLIPPED:
//   .playwright-mcp/app-wide-ux-20261031/chrome-journey-5/review.json
//     ops-activity-since-time-period — available text width 5.95px,
//                                      required 14.18px for "—"
//     ops-activity-until-time-period — the same
// The 1280×900 case has no clip.
//
// REVISED (human steering, 31 October 2026): the Ops filter is DATE-ONLY.
// It no longer has an hour/minutes/AM-PM group and a seconds control to
// lay out — the date is chosen from the shared calendar. The clipping
// that was measured belongs to the SHARED TIME control, which survives
// for the scheduling forms; its own narrow-layout contract is
// tests/app-wide-ux-20261031/time-field-narrow-layout.test.tsx.
//
// What this file pins now is the filter's own narrow composition: the
// two date bounds STACK on a narrow width and sit side by side on a
// wide one, and the calendar's trigger keeps its own hit area beside
// the date instead of being squeezed into it.
//
// LAYOUT INTENT: this asserts the intended COMPOSITION. It cannot
// certify the real geometry — the coordinator's measured Chrome pass
// after the rebuild is the gate (the numbers quoted above are that
// independent RED, not this file's).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: string; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

import { OpsActivityFilter } from "@/components/ops/ops-activity-filter";

function renderOps(initial: { since?: string; until?: string } = {}) {
  return render(
    <OpsActivityFilter actions={["tenant.activate"]} tenants={[]} initial={initial} />,
  );
}

/** The row that holds BOTH date bounds. */
function dateRow(): HTMLElement {
  const since = screen.getByLabelText(/since date/i);
  const until = screen.getByLabelText(/until date/i);
  let node: HTMLElement | null = since.parentElement;
  while (node && !node.contains(until)) node = node.parentElement;
  expect(node, "the date bounds have no common row").toBeTruthy();
  return node as HTMLElement;
}

beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { search: "" },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the Ops activity filter — the narrow layout contract", () => {
  it("stacks the two date bounds on a narrow width", () => {
    renderOps();
    const classes = dateRow().getAttribute("class") ?? "";
    expect(
      classes,
      "the date bounds do not stack on a narrow width",
    ).toMatch(/(?:^|\s)(?:[a-z0-9-]+:)?grid-cols-1(?=\s|$)/);
  });

  it("may still place the two date bounds side by side on a wider width", () => {
    renderOps();
    const classes = dateRow().getAttribute("class") ?? "";
    // The desktop composition is not degraded by the narrow repair.
    expect(classes).toMatch(/(?:sm|md|lg|xl):grid-cols-2/);
  });

  it("gives the calendar trigger its own hit area beside the date", () => {
    renderOps();
    const trigger = screen.getByRole("button", { name: /choose start date/i });
    const classes = trigger.getAttribute("class") ?? "";
    // The trigger is not squeezed into the field's own row of text: it
    // keeps its minimum touch target and never shrinks.
    expect(classes).toMatch(/min-h-11/);
    expect(classes).toMatch(/(?:^|\s)w-11(?=\s|$)/);
    expect(classes).toMatch(/shrink-0/);
  });

  it("carries the chosen date, and nothing else, into the query", () => {
    renderOps({ since: "2026-10-28", until: "2026-10-28" });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(window.location.search).toContain("since=2026-10-28");
    expect(window.location.search).toContain("until=2026-10-28");
  });
});
