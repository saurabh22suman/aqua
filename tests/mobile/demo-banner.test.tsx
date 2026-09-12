// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// P1-3 (mobile UX audit, 2026-09-12) — the demo banner's copy is pinned
// by the human-owned tier1 demo-mode-banner test (it must keep saying
// "this is a demo tenant" and "real academy data"), so the height win
// is typography and padding: 11.5px text, py-1.5, 12px icon.

vi.mock("@/lib/env", () => ({ env: { DEMO_MODE: true } }));

import { DemoBanner } from "@/components/demo-banner";

afterEach(cleanup);

describe("demo banner (P1-3)", () => {
  it("keeps the compliance copy", () => {
    render(<DemoBanner />);
    const banner = screen.getByTestId("demo-banner");
    expect(banner.textContent).toContain("this is a demo tenant");
    expect(banner.textContent).toContain("real academy data");
  });

  it("renders smaller than the pre-fix two-line block", () => {
    render(<DemoBanner />);
    const banner = screen.getByTestId("demo-banner");
    const inner = banner.firstElementChild as HTMLElement;
    expect(inner.className).toContain("py-1.5");
    expect(inner.className).toContain("text-[11.5px]");
  });
});
