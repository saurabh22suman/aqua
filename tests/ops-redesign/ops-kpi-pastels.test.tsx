// @vitest-environment jsdom
//
// Ops redesign (28 October 2026) — the Ops summary tiles.
//
// The SEMANTICS of the tiles are asserted here; their COLOURS are
// measured in real Chrome (e2e/ops-redesign/ops-kpi-pastels.ts), because
// a class string is not a measurement.
//
// What is asserted here:
//
//   - the tile is findable (a stable marker, not a DOM position);
//   - the label and the number are TEXT, and the icon chip is
//     decorative (hidden from assistive technology), so the meaning never
//     rests on the colour or the picture;
//   - a ZERO risk count is a calm, STATED fact ("No tenant is at
//     risk"), and a positive risk count does not claim it.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const summaryState = vi.hoisted(() => ({
  atRisk: 4,
  asOf: "2026-10-28T10:05:00.000Z" as string | null,
}));

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({
    kind: "authenticated",
    userId: "u1",
    role: "admin",
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
}));

vi.mock("@/db/platform-overview", () => ({
  getPlatformMetricsSummary: async () => ({
    activeTenants: { current: 1, previous: null },
    trialTenants: { current: 2, previous: null },
    atRiskTenants: { current: summaryState.atRisk, previous: null },
    openOpsTasks: { current: 1, previous: null },
    asOf: summaryState.asOf ? new Date(summaryState.asOf) : null,
  }),
  getNeedsAttentionQueue: async () => [],
}));

vi.mock("@/db/platform-activity", () => ({
  listPlatformActivity: async () => ({ rows: [], total: 0 }),
}));

import PlatformHome from "@/app/(platform)/ops/page";

afterEach(() => {
  cleanup();
  summaryState.atRisk = 4;
  summaryState.asOf = "2026-10-28T10:05:00.000Z";
});

function tile(label: string) {
  return document.querySelector(`[data-kpi-label="${label}"]`);
}

describe("Ops summary tiles — the semantics", () => {
  it("marks every tile so it can be found without a DOM position", async () => {
    render(await PlatformHome());

    for (const label of [
      "Active tenants",
      "On trial",
      "At risk",
      "Open ops tasks",
    ]) {
      expect(tile(label), `the ${label} tile has no marker`).not.toBeNull();
    }
  });

  it("keeps the label and the number as text", async () => {
    render(await PlatformHome());

    const active = tile("Active tenants")!;
    expect(active.textContent).toContain("Active tenants");
    expect(active.textContent).toContain("1");
  });

  it("hides the decorative icon chip from assistive technology", async () => {
    render(await PlatformHome());

    const chip = screen.getAllByTestId("ops-kpi-icon")[0];
    expect(chip.getAttribute("aria-hidden")).toBe("true");
    // The chip is the OWNER's shape: 32px, the 10px radius.
    expect(chip.className).toContain("h-8");
    expect(chip.className).toContain("w-8");
    expect(chip.className).toContain("rounded-[10px]");
  });

  it("states a zero risk count in words, and does not alarm", async () => {
    summaryState.atRisk = 0;
    render(await PlatformHome());

    const risk = tile("At risk")!;
    expect(risk.textContent).toContain("No tenant is at risk.");
    expect(risk.textContent).toContain("0");
  });

  it("says nothing about risk when the count is positive", async () => {
    summaryState.atRisk = 4;
    render(await PlatformHome());

    const risk = tile("At risk")!;
    expect(risk.textContent).not.toContain("No tenant is at risk.");
    expect(risk.textContent).toContain("4");
  });

  it("keeps the no-snapshot state a single honest message, not four zero cards", async () => {
    summaryState.asOf = null;
    render(await PlatformHome());

    expect(screen.getByText(/No metrics snapshot yet/)).toBeDefined();
    // An absent snapshot must not manufacture four zero-valued cards.
    expect(
      document.querySelectorAll('[data-testid="ops-kpi"]').length,
    ).toBe(0);
  });
});
