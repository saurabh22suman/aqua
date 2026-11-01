// @vitest-environment jsdom
//
// Owner Home — the empty enquiries section says it once (tranche 3,
// 31 Oct 2026).
//
// What the coordinator asked for: the remaining empty enquiries
// disclosure repeats a "no enquiries" sentence, and the card can sit
// half empty. One heading, one scope, one count and one next action by
// default — and the exact 30-day scope stays distinct from the
// selected chart range.
//
// The contract this file pins:
//
//   1. An empty enquiry read prints ONE "no enquiries" statement, not
//      two (the preview and the disclosure each printed one).
//   2. The heading, the 30-day scope and the count survive, so the
//      empty card still says what was read and over what window.
//   3. UNAVAILABLE stays distinct from EMPTY: a failed read says it
//      could not be read and is never drawn as a zero.
//   4. The 30-day window is the section's own scope, never the
//      selected chart range.
//   5. Facility scope and the permission to open the enquiries list
//      are unchanged.

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

import { OwnerInsightsHome } from "@/components/owner-insights-home/owner-insights-home";

const EMPTY = {
  // Thirty club days: 1 Oct (inclusive) to 31 Oct (exclusive), so the
  // window printed on the card is 1 Oct – 30 Oct.
  from: "2026-10-01",
  to: "2026-10-31",
  timezone: "Asia/Kolkata",
  enquiries: {
    from: "2026-10-01",
    to: "2026-10-31",
    total: 0,
    rows: [],
  },
};

const POPULATED = {
  from: "2026-10-01",
  to: "2026-10-31",
  timezone: "Asia/Kolkata",
  enquiries: {
    from: "2026-10-01",
    to: "2026-10-31",
    total: 4,
    rows: [
      { stage: "new", label: "New", count: 3, share: 75 },
      { stage: "trial_booked", label: "Trial booked", count: 1, share: 25 },
    ],
  },
};

/**
 * The clauses that state an EMPTY enquiry read. The count is of
 * CLAUSES, not of sentences: the card's lines are not punctuated, so
 * sentence splitting would miss the duplication entirely.
 */
function emptyStatements(section: HTMLElement): string[] {
  return (section.textContent ?? "").match(/no (enquir|lead)\w*/gi) ?? [];
}

/** Does the section still say, in some words, that the read was empty? */
function statesAnEmptyRead(section: HTMLElement): boolean {
  return /no (enquir|lead)|nothing (was )?(created|there)|empty/i.test(
    section.textContent ?? "",
  );
}

/** The section as the owner sees it before opening the disclosure. */
function collapsedView(section: HTMLElement): HTMLElement {
  const clone = section.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("details").forEach((node) => node.remove());
  return clone;
}

afterEach(cleanup);

describe("owner Home — the empty enquiries section says it once", () => {
  it("prints one no-enquiries statement, not two", () => {
    render(
      <OwnerInsightsHome
        data={EMPTY as never}
        canOpenEnquiries={true}
      />,
    );
    const section = screen.getByTestId("owner-insights-home");
    // The empty fact is stated once, not once in the preview and again
    // in the disclosure.
    expect(emptyStatements(section)).toHaveLength(1);
    // …and the default view still says it.
    expect(emptyStatements(collapsedView(section))).toHaveLength(1);
    expect(statesAnEmptyRead(section)).toBe(true);
    // The disclosure carries no second copy of it.
    expect(
      emptyStatements(screen.getByTestId("owner-insights-detail")),
    ).toHaveLength(0);
  });

  it("still states the heading, the scope and the count", () => {
    render(
      <OwnerInsightsHome
        data={EMPTY as never}
        canOpenEnquiries={true}
      />,
    );
    const section = screen.getByTestId("owner-insights-home");
    // One subject…
    const defaultView = collapsedView(section);
    expect(defaultView.textContent ?? "").toContain("Enquiries by current stage");
    expect(
      (defaultView.textContent ?? "").match(/Enquiries by current stage/g) ?? [],
    ).toHaveLength(1);
    // …the 30-day scope with its dates…
    expect(section.textContent ?? "").toContain("Last 30 days");
    expect(section.textContent ?? "").toContain("1 Oct 2026 – 30 Oct 2026");
    expect(section.textContent ?? "").not.toMatch(/Asia\/(Kolkata|Calcutta)|\bIST\b/);
    // …and the next action.
    expect(
      within(section).getByRole("link", { name: /open the enquiries list/i }),
    ).toBeTruthy();
  });

  it("keeps the detail disclosure reachable", () => {
    render(
      <OwnerInsightsHome
        data={POPULATED as never}
        canOpenEnquiries={true}
      />,
    );
    const details = screen.getByTestId("owner-insights-detail");
    expect(details.tagName.toLowerCase()).toBe("details");
    expect(details.hasAttribute("open")).toBe(false);
    // The cohort detail is still inside it.
    expect(details.textContent ?? "").toContain("created in this window");
  });
});

describe("owner Home — unavailable stays distinct from empty", () => {
  it("says the read could not be made, and never draws a zero", () => {
    render(
      <OwnerInsightsHome
        data={{ ...EMPTY, enquiries: null } as never}
        canOpenEnquiries={true}
      />,
    );
    const section = screen.getByTestId("owner-insights-home");
    expect(section.textContent ?? "").toMatch(/could not be read/i);
    // It is not an empty result.
    expect(emptyStatements(section)).toHaveLength(0);
    // And it is not drawn as a count of zero.
    expect(section.textContent ?? "").not.toMatch(/0 (created|enquir)/i);
  });
});

describe("owner Home — the insights window stays its own scope", () => {
  it("states the 30-day window, not the selected chart range", () => {
    render(
      <OwnerInsightsHome
        data={POPULATED as never}
        canOpenEnquiries={true}
      />,
    );
    const section = screen.getByTestId("owner-insights-home");
    expect(section.textContent ?? "").toContain("Last 30 days");
    // The chart band owns the other range; it is not repeated here.
    expect(section.textContent ?? "").not.toContain("Last 7 days");
  });

  it("keeps a populated cohort informative", () => {
    render(
      <OwnerInsightsHome
        data={POPULATED as never}
        canOpenEnquiries={true}
      />,
    );
    const section = screen.getByTestId("owner-insights-home");
    expect(section.textContent ?? "").toContain("4 created");
    expect(section.textContent ?? "").toContain("new");
    expect(emptyStatements(section)).toHaveLength(0);
  });
});

describe("owner Home — the enquiries list stays permission- and facility-bounded", () => {
  it("does not offer the enquiries list to a caller who may not open it", () => {
    render(
      <OwnerInsightsHome
        data={POPULATED as never}
        canOpenEnquiries={false}
      />,
    );
    const section = screen.getByTestId("owner-insights-home");
    expect(
      within(section).queryByRole("link", { name: /open the enquiries list/i }),
    ).toBeNull();
  });

  it("states the facility scope instead of the unnarrowed list", () => {
    render(
      <OwnerInsightsHome
        data={POPULATED as never}
        facility="loc-9"
        canOpenEnquiries={true}
      />,
    );
    const section = screen.getByTestId("owner-insights-home");
    expect(section.textContent ?? "").toMatch(/facility/i);
    // A narrowed scope does not offer the tenant-wide list.
    expect(
      within(section).queryByRole("link", { name: /open the enquiries list/i }),
    ).toBeNull();
  });
});
