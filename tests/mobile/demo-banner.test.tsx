// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// P1-3 (mobile UX audit, 2026-09-12) — the demo banner's copy is pinned
// by the human-owned tier1 demo-mode-banner test (it must keep saying
// "this is a demo tenant" and "real academy data"), so the height win
// is typography and padding: 11.5px text, py-1.5, 12px icon.
//
// F-7 (2026-09-13 Indian-user UX audit) — the banner now varies copy
// by surface: the Ops control plane has no single tenant context, so
// "this is a demo tenant" was wrong there.

vi.mock("@/lib/env", () => ({ env: { DEMO_MODE: true } }));

const pathname = vi.hoisted(() => ({ value: "/owner" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
}));

import { DemoBanner } from "@/components/demo-banner";

afterEach(cleanup);

describe("demo banner (P1-3)", () => {
  it("keeps the compliance copy on tenant surfaces", () => {
    pathname.value = "/owner";
    render(<DemoBanner />);
    const banner = screen.getByTestId("demo-banner");
    expect(banner.textContent).toContain("this is a demo tenant");
    expect(banner.textContent).toContain("real academy data");
  });

  it("F-7 — uses platform copy on the Ops control plane", () => {
    pathname.value = "/ops/tenants";
    render(<DemoBanner />);
    const banner = screen.getByTestId("demo-banner");
    expect(banner.textContent).toContain("control plane");
    expect(banner.textContent).not.toContain("this is a demo tenant");
  });

  it("renders smaller than the pre-fix two-line block", () => {
    pathname.value = "/owner";
    render(<DemoBanner />);
    const banner = screen.getByTestId("demo-banner");
    const inner = banner.firstElementChild as HTMLElement;
    expect(inner.className).toContain("py-1.5");
    expect(inner.className).toContain("text-[11.5px]");
  });
});
