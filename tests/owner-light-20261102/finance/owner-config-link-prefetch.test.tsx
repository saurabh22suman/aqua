// @vitest-environment jsdom
//
// Finance lane — intended RED (3 November 2026), final policy completion:
// `components/owner-config-form.tsx` still imports the installed `next/link`
// directly, so the Owner destinations it renders request the framework's
// automatic prefetch instead of an intentional read on navigation.
//
// Two managed-elsewhere rows carry real Owner links:
//   * operations.business_hours            -> /owner/settings/locations
//   * attendance.absence_alert_threshold…  -> /owner/settings/alerts
//
// This is a rendered component test (the real form module), not an import
// check: it spies on `next/link` and records the prefetch each rendered link
// requests. Today they request `undefined` (automatic prefetch), so the Owner
// assertion fails on the intended behaviour itself. The shared facade
// `components/owner-ui/owner-link.tsx` already exists and is read-only; it is
// not imported here.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const seen = vi.hoisted(() => [] as Array<{ href: string; prefetch: unknown }>);

vi.mock("@/lib/actions/owner-config", () => ({
  setOwnerConfigValueAction: vi.fn(),
  requestConfigChangeAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    __esModule: true,
    default: function SpyLink({
      href,
      prefetch,
      children,
    }: {
      href: string | { pathname?: string };
      prefetch?: boolean | null;
      children?: ReactNode;
    }) {
      const hrefString =
        typeof href === "string" ? href : (href.pathname ?? "");
      seen.push({ href: hrefString, prefetch });
      return React.createElement("a", { href: hrefString }, children);
    },
  };
});

import { OwnerConfigForm } from "@/components/owner-config-form";

type Item = Parameters<typeof OwnerConfigForm>[0]["items"][number];

function item(overrides: Record<string, unknown>): Item {
  return {
    key: "operations.business_hours",
    value: {
      days: [{ day: "monday", closed: false, open: "06:00", close: "21:00" }],
    },
    visibility: "owner_edit",
    risk: "safe",
    description: "Opening hours.",
    jsonSchema: { type: "object" },
    source: { scopeType: "default", scopeId: null, setBy: null, setAt: null },
    editable: true,
    ...overrides,
  } as Item;
}

const ITEMS: Item[] = [
  item({}),
  item({
    key: "attendance.absence_alert_threshold_pct",
    value: 40,
    visibility: "owner_edit",
    jsonSchema: { type: "integer", minimum: 0, maximum: 100 },
    description: "Absence alert threshold.",
  }),
];

afterEach(() => {
  cleanup();
  seen.length = 0;
});

describe("Owner config managed-elsewhere links", () => {
  it("requests an intentional read for every Owner destination it renders", () => {
    render(<OwnerConfigForm items={ITEMS} />);

    // Both rows really render their destination link.
    expect(screen.getByRole("link", { name: /Edit hours in Locations/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Edit threshold in Alerts/i })).toBeTruthy();

    const ownerLinks = seen.filter((link) =>
      /^\/owner(\/|\?|#|$)/.test(link.href),
    );
    // The form forwards its links through the facade; nothing else in the
    // rendered form is an app link.
    expect(ownerLinks.length).toBe(2);

    for (const link of ownerLinks) {
      // INTENDED RED today: these are `undefined` (automatic prefetch).
      expect(
        link.prefetch,
        `${link.href} must read on navigation, not prefetch in the background`,
      ).toBe(false);
    }
  });

  it("keeps the destinations and the row wording exactly as authored", () => {
    render(<OwnerConfigForm items={ITEMS} />);

    const hours = screen.getByTestId("config-operations.business_hours");
    expect(
      within(hours)
        .getByRole("link", { name: /Edit hours in Locations/i })
        .getAttribute("href"),
    ).toBe("/owner/settings/locations");

    const alerts = screen.getByTestId(
      "config-attendance.absence_alert_threshold_pct",
    );
    expect(
      within(alerts)
        .getByRole("link", { name: /Edit threshold in Alerts/i })
        .getAttribute("href"),
    ).toBe("/owner/settings/alerts");

    // The managed-elsewhere rows still refuse a duplicate inline edit.
    expect(within(hours).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(hours).queryByText(/Request change/i)).toBeNull();
  });
});
