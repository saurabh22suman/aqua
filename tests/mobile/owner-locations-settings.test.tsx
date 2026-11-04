// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
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
    // One open day per location (Monday) = an opening and a closing time
    // control each. The shared TimeField renders a labelled group of
    // selects, not a native <input type="time">.
    const timeGroups = () =>
      Array.from(document.querySelectorAll("li fieldset")).filter((node) =>
        /opening time|closing time/i.test(
          node.querySelector("legend")?.textContent ?? "",
        ),
      );
    await waitFor(() => expect(timeGroups()).toHaveLength(4));
    const legends = timeGroups().map(
      (node) => node.querySelector("legend")?.textContent ?? "",
    );
    expect(legends.filter((text) => /opening time$/i.test(text))).toHaveLength(2);
    expect(legends.filter((text) => /closing time$/i.test(text))).toHaveLength(2);
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
