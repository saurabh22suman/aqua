// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// U-07 — the locations editor. A single-location tenant sees its own
// details and a quiet path to add a second site, never a switcher or
// an "all locations" control; business hours load as "not set yet"
// until configured.

const getBusinessHoursAction = vi.fn();
vi.mock("@/lib/actions/locations", () => ({
  listAdminLocationsAction: vi.fn(),
  createLocationAction: vi.fn(),
  updateLocationAction: vi.fn(),
  getBusinessHoursAction: (...args: unknown[]) => getBusinessHoursAction(...args),
  setBusinessHoursAction: vi.fn(),
}));

import { LocationManager } from "@/components/settings/location-manager";
import type { LocationAdminRow } from "@/lib/services/locations";

const WORLI: LocationAdminRow = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  name: "Worli",
  kind: "club",
  isPrimary: true,
  address: { city: "Mumbai" },
  createdAt: new Date().toISOString(),
};

const ANDHERI: LocationAdminRow = {
  ...WORLI,
  id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  name: "Andheri",
  isPrimary: false,
};

afterEach(() => {
  cleanup();
  getBusinessHoursAction.mockReset();
});

describe("U-07 locations editor", () => {
  it("single location: no switcher, singular add path, honest hours state", async () => {
    getBusinessHoursAction.mockResolvedValue({ days: [] });
    render(<LocationManager initial={[WORLI]} canWrite />);
    expect(document.body.textContent).toContain("Worli");
    expect(document.body.textContent).toMatch(/add a second location/i);
    expect(document.querySelector("select[name='location']")).toBeNull();
    expect(document.body.textContent).not.toMatch(/all locations/i);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/not set yet/i),
    );
  });

  it("two locations: the multi-site path appears, days are editable", async () => {
    getBusinessHoursAction.mockResolvedValue({
      days: [
        { day: "monday", closed: false, open: "06:00", close: "21:00" },
      ],
    });
    render(<LocationManager initial={[WORLI, ANDHERI]} canWrite />);
    expect(document.body.textContent).toMatch(/add another location/i);
    // One open day per location; each opening/closing TimeField has editable controls.
    await waitFor(() => expect(screen.getAllByRole("group",{name:"Monday opening time"})).toHaveLength(2));
    const groups = [...screen.getAllByRole("group",{name:"Monday opening time"}),...screen.getAllByRole("group",{name:"Monday closing time"})];
    for (const group of groups) expect((within(group).getByLabelText("Hour") as HTMLSelectElement).disabled).toBe(false);
  });

  it("read-only staff see the data but no save controls", async () => {
    getBusinessHoursAction.mockResolvedValue({ days: [] });
    render(<LocationManager initial={[WORLI]} canWrite={false} />);
    expect(document.body.textContent).toContain("Worli");
    expect(document.body.textContent).not.toMatch(/add a second location/i);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/not set yet/i),
    );
    expect(document.querySelector("button")).toBeNull();
  });
});
