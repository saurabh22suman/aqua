// @vitest-environment jsdom
//
// Owner Home — the two remaining Owner link renderers (3 November 2026, HOME lane).
//
// Policy: the Owner pages read a page when the owner NAVIGATES to it, not
// through opportunistic background prefetch. The shared facade
// (components/owner-ui/owner-link.tsx, foundation-owned) forces
// `prefetch={false}` for `/owner…` destinations and forwards everything else.
//
// This file is the focused INTENDED RED for the two link renderers the
// coordinator assigned last — `CollectionsPanel` (the Money band's collections
// panel) and `OwnerPaymentMix` (the mix legend + method drill-downs). Both
// still import `next/link` directly, so their Owner links ask for the framework
// default (an automatic prefetch). The facade is NOT imported here, so this is
// a rendered behaviour RED, not an import error.
//
// Controls kept: the drill-down hrefs (query included) are unchanged, the
// `feesLink={null}` case still renders plain text instead of links, and no
// link gains a handler that would change modified/ordinary clicks.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const linkCalls = vi.hoisted(() => [] as Array<{
  href: unknown;
  prefetch: unknown;
  onClick: unknown;
  replace: unknown;
  target: unknown;
}>);

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      prefetch?: unknown;
      onClick?: unknown;
      replace?: unknown;
      target?: unknown;
      children?: unknown;
      [key: string]: unknown;
    }) => {
      const { href, children, prefetch, onClick, replace, target, ...rest } = props;
      linkCalls.push({ href, prefetch, onClick, replace, target });
      return React.createElement(
        "a",
        {
          href: typeof href === "string" ? href : "#",
          ...(target ? { target: target as string } : {}),
          ...rest,
        },
        children as React.ReactNode,
      );
    },
  };
});

// The ECharts island is a lazy client island; the panels' links are what this
// file measures, so the island is stubbed.
vi.mock("@/components/charts/owner-chart-island", () => ({
  OwnerChartIsland: () => null,
}));

import { CollectionsPanel } from "@/components/owner-home-chart-panels";
import { OwnerPaymentMix } from "@/components/owner-ui/owner-payment-mix";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";

function charts(): OwnerChartsData {
  return {
    timezone: "Asia/Kolkata",
    period: {
      key: "last7",
      tabLabel: "Last 7 days",
      comparisonLabel: "7-day",
      comparisonExpansion: "the seven days before",
      comparisonMeaning: "Seven-day comparison",
      currentLabel: "27 Oct 2026, 12:00 am – 2 Nov 2026, 9:15 am",
      previousLabel: "20 Oct 2026, 12:00 am – 26 Oct 2026, 9:15 am",
      currentFromDate: "2026-10-27",
      currentToDate: "2026-11-02",
      previousFromDate: "2026-10-20",
      previousToDate: "2026-10-26",
      previousCapped: false,
      capNote: null,
    },
    collections: {
      buckets: [
        {
          key: "2026-11-01",
          label: "Fri 1",
          fullLabel: "1 Nov 2026",
          cash: 1000000,
          digital: 500000,
          other: 0,
          totalPaise: 1500000,
        },
      ],
      groups: [
        { key: "cash", label: "Cash", paise: 1625000, count: 30, pct: 80 },
        { key: "digital", label: "Digital", paise: 500000, count: 5, pct: 20 },
        { key: "other", label: "Other", paise: 0, count: 0, pct: 0 },
      ],
      methods: [
        { key: "cash", label: "Cash", group: "cash", paise: 1625000, count: 30, pct: 80 },
        { key: "upi", label: "UPI", group: "digital", paise: 500000, count: 5, pct: 20 },
      ],
      totalPaise: 2375000,
      paymentCount: 35,
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
      comparison: "No previous marks in the comparison range",
    },
  } as OwnerChartsData;
}

/** The fees drill-down builder the panels are given by their page. */
function feesLink(extra: Record<string, string>): string {
  const query = new URLSearchParams({ tab: "transactions", ...extra });
  return `/owner/fees?${query.toString()}`;
}

function isOwnerDestination(href: unknown): boolean {
  return typeof href === "string" && (href === "/owner" || href.startsWith("/owner/") || href.startsWith("/owner?") || href.startsWith("/owner#"));
}

beforeEach(() => {
  linkCalls.length = 0;
});

afterEach(cleanup);

describe("Owner money-band link renderers request no automatic prefetch (intended RED)", () => {
  it("asks for prefetch={false} on the CollectionsPanel drill-down", () => {
    render(<CollectionsPanel data={charts()} feesLink={feesLink} />);
    const links = linkCalls.filter((call) => isOwnerDestination(call.href));
    expect(links.length).toBeGreaterThan(0);
    for (const call of links) {
      expect(call.prefetch, `${String(call.href)} must request prefetch={false}`).toBe(false);
    }
  });

  it("asks for prefetch={false} on every OwnerPaymentMix drill-down", () => {
    render(<OwnerPaymentMix data={charts()} feesLink={feesLink} />);
    const links = linkCalls.filter((call) => isOwnerDestination(call.href));
    // Group links (3) plus the digital method link (1).
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const call of links) {
      expect(call.prefetch, `${String(call.href)} must request prefetch={false}`).toBe(false);
    }
  });
});

describe("the controls that must survive the change", () => {
  it("keeps the drill-down hrefs, query included", () => {
    render(<OwnerPaymentMix data={charts()} feesLink={feesLink} />);
    const hrefs = linkCalls.map((call) => String(call.href));
    expect(hrefs).toContain("/owner/fees?tab=transactions&group=cash");
    expect(hrefs).toContain("/owner/fees?tab=transactions&method=upi");
  });

  it("renders plain text, not links, when the caller has no fees drill-down", () => {
    render(<CollectionsPanel data={charts()} feesLink={null} />);
    render(<OwnerPaymentMix data={charts()} feesLink={null} />);
    expect(linkCalls).toHaveLength(0);
  });

  it("adds no click handler, replace or target", () => {
    render(<CollectionsPanel data={charts()} feesLink={feesLink} />);
    render(<OwnerPaymentMix data={charts()} feesLink={feesLink} />);
    for (const call of linkCalls) {
      expect(call.onClick, `${String(call.href)} must not gain an onClick`).toBeUndefined();
      expect(call.replace, `${String(call.href)} must not gain replace`).toBeUndefined();
      expect(call.target, `${String(call.href)} must not gain target`).toBeUndefined();
    }
  });
});
