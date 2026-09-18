// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// U-05 — global search. The action returns only the kinds the caller
// is entitled to (permission-scoped in lib/services/global-search.ts);
// this pins the rendering contract: grouped results, deep links to the
// pages, an honest empty state, and the permission gate itself (coach
// carries none of the three keys → no kinds at all).

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

vi.mock("@/lib/actions/global-search", () => ({
  globalSearchAction: vi.fn(async () => []),
}));

import { GlobalSearch } from "@/components/global-search";
import {
  entitledSearchKinds,
  type GlobalSearchHit,
} from "@/lib/services/global-search";

afterEach(cleanup);

const HITS: GlobalSearchHit[] = [
  {
    kind: "member",
    id: "m1",
    title: "Aarav Sharma",
    subtitle: "AWS-001 · active",
    href: "/owner/members/m1",
  },
  {
    kind: "enquiry",
    id: "e1",
    title: "Meera Iyer",
    subtitle: "+91 98123 40010 · new",
    href: "/owner/enquiries/e1",
  },
  {
    kind: "payment",
    id: "i1",
    title: "Invoice AQ/26-27/001",
    subtitle: "₹2,000 · Aarav Sharma",
    href: "/owner/members/m1",
  },
];

function renderAndSearch(query: string, hits: GlobalSearchHit[]) {
  const action = vi.fn(async () => hits);
  render(<GlobalSearch searchAction={action} />);
  const input = screen.getByTestId("global-search-input");
  fireEvent.change(input, { target: { value: query } });
  fireEvent.submit(input.closest("form")!);
  return action;
}

describe("U-05 global search results", () => {
  it("renders permitted kinds and deep-links each hit", async () => {
    const action = renderAndSearch("aar", HITS);

    await waitFor(() => expect(screen.getByTestId("global-search-results")).toBeTruthy());
    await screen.findByTestId("global-search-hit-member");

    expect(action).toHaveBeenCalledWith("aar");
    expect(screen.getByTestId("global-search-hit-member").getAttribute("href")).toBe(
      "/owner/members/m1",
    );
    expect(screen.getByTestId("global-search-hit-enquiry").getAttribute("href")).toBe(
      "/owner/enquiries/e1",
    );
    // A payment deep-links to the member's ledger (no standalone page in R1).
    expect(screen.getByTestId("global-search-hit-payment").getAttribute("href")).toBe(
      "/owner/members/m1",
    );
    expect(document.body.textContent).toContain("Members");
    expect(document.body.textContent).toContain("Enquiries");
    expect(document.body.textContent).toContain("Payments");
  });

  it("never renders a kind the caller is not entitled to", async () => {
    // Accountant shape: members.read + invoices.read, no enquiries.read.
    const accountantHits = HITS.filter((h) => h.kind !== "enquiry");
    renderAndSearch("aar", accountantHits);

    await screen.findByTestId("global-search-hit-member");
    expect(screen.queryByTestId("global-search-hit-enquiry")).toBeNull();
    expect(screen.getByTestId("global-search-hit-payment")).toBeTruthy();
  });

  it("shows an honest empty state when nothing matches", async () => {
    renderAndSearch("zzz", []);

    await waitFor(() =>
      expect(screen.getByTestId("global-search-results").textContent).toContain(
        "No matches for",
      ),
    );
  });

  it("does not call the action for a one-character query", () => {
    const action = renderAndSearch("a", HITS);
    expect(action).not.toHaveBeenCalled();
  });
});

describe("U-05 permission-scoped kinds", () => {
  const coach = new Set([
    "attendance.read",
    "attendance.mark",
    "members.read.assigned",
    "programs.read",
    "levels.read",
    "levels.assess",
  ]);
  const receptionist = new Set([
    "members.read",
    "members.write",
    "attendance.read",
    "attendance.mark",
    "enquiries.read",
    "enquiries.write",
    "invoices.read",
    "payments.record",
  ]);
  const accountant = new Set(["members.read", "invoices.read"]);

  it("coach holds none of the three search keys — no kinds, no roster leak", () => {
    expect(entitledSearchKinds(coach)).toEqual([]);
  });

  it("receptionist and owner-shaped sets resolve all three kinds", () => {
    expect(entitledSearchKinds(receptionist)).toEqual([
      "member",
      "enquiry",
      "payment",
    ]);
  });

  it("accountant gets members and payments, never enquiries", () => {
    expect(entitledSearchKinds(accountant)).toEqual(["member", "payment"]);
  });
});
