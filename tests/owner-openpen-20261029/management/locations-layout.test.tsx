// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner OpenPen management lane (29 October 2026).
//
// Location settings show ONE selected site's details beside its weekly
// hours — the site summary and the hours editor are separate, labelled
// regions rather than one long form.

vi.mock("@/lib/actions/locations", () => ({
  createLocationAction: async () => ({ ok: true }),
  listAdminLocationsAction: async () => [],
  updateLocationAction: async () => ({ ok: true }),
}));

vi.mock("@/lib/actions/business-hours", () => ({
  getBusinessHoursAction: async () => ({ days: [] }),
  saveBusinessHoursAction: async () => ({ ok: true }),
}));

import { LocationManager } from "@/components/settings/location-manager";

afterEach(cleanup);

const LOCATION = {
  id: "loc-1",
  name: "Worli Main",
  kind: "club" as const,
  isPrimary: true,
  address: { line1: "12 Sea Face", city: "Mumbai" },
  createdAt: "2026-10-01T04:00:00.000Z",
};

describe("location manager composition", () => {
  it("names the site details and weekly hours as separate regions", async () => {
    render(<LocationManager initial={[LOCATION]} canWrite />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Worli Main" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 3, name: "Site details" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 3, name: "Weekly hours" }),
    ).toBeTruthy();
  });
});
