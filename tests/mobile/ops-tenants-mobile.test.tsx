// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Phase 2 (mobile UX plan v2) — F2. The tenants table is six columns
// wide and clipped the last three on phones behind an overflow-hidden
// wrapper. Mobile gets a card list; the table stays for md+ and is
// explicitly hidden below it. The search/filter inputs move to 16px so
// the mobile list doesn't zoom-on-focus on iOS.

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({
    kind: "authenticated",
    role: "operator",
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
}));
vi.mock("@/db/platform-tenants", () => ({
  listTenants: async () => ({
    total: 2,
    rows: [
      {
        id: "t1",
        name: "Aqua Worli",
        slug: "demo-academy",
        status: "active",
        memberCount: 40,
        locationCount: 2,
        planName: "Growth",
        createdAt: new Date("2026-04-22T00:00:00.000Z"),
      },
      {
        id: "t2",
        name: "Kicks Football Academy",
        slug: "kicks-academy",
        status: "trial",
        memberCount: 12,
        locationCount: 1,
        planName: null,
        createdAt: new Date("2026-05-02T00:00:00.000Z"),
      },
    ],
  }),
}));

import PlatformTenantsPage from "@/app/(platform)/ops/tenants/page";

afterEach(cleanup);

describe("Ops tenants mobile card list (F2)", () => {
  it("renders a card per tenant with counts and a detail link, hidden on md+", async () => {
    const ui = await PlatformTenantsPage({
      searchParams: Promise.resolve({}),
    });
    const { container } = render(ui);

    const cards = screen.getByTestId("ops-tenants-cards");
    expect(cards.className).toContain("md:hidden");

    const detailLinks = Array.from(
      cards.querySelectorAll<HTMLAnchorElement>('a[href^="/ops/tenants/"]'),
    );
    expect(detailLinks.map((a) => a.getAttribute("href"))).toEqual([
      "/ops/tenants/t1",
      "/ops/tenants/t2",
    ]);

    const text = cards.textContent ?? "";
    expect(text).toContain("Members: 40");
    expect(text).toContain("Locations: 2");
    expect(text).toContain("Members: 12");

    // The table is retained for md+ only.
    const tableWrap = screen.getByTestId("ops-tenants-table");
    expect(tableWrap.className).toContain("hidden");
    expect(tableWrap.className).toContain("md:block");
    // And it must not clip the columns anymore.
    expect(container.querySelector(".overflow-hidden")).toBeNull();
  });

  it("bumps the list filters to 16px for mobile (iOS zoom)", async () => {
    const ui = await PlatformTenantsPage({
      searchParams: Promise.resolve({}),
    });
    render(ui);

    const search = screen.getByPlaceholderText("name or slug");
    expect(search.className).toContain("text-[16px]");
  });
});
