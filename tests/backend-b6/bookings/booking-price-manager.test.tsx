// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Batch 6 — the booking price editor's behaviour.
//
// The browser walkthrough found the bug this file now pins: the
// deactivate button wrote the change to the server but never re-read
// the catalogue, so the row kept saying "Active" until a full page
// reload. The list is read on the server, so a mutation that changes
// it must refresh it.

type ActionResult = { ok: boolean; error?: string };

const mocks = vi.hoisted(() => ({
  save: vi.fn<(input: unknown) => Promise<ActionResult>>(async () => ({
    ok: true,
  })),
  toggle: vi.fn<(input: unknown) => Promise<ActionResult>>(async () => ({
    ok: true,
  })),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/lib/actions/booking-price-admin", () => ({
  saveBookingPriceRuleAction: (input: unknown) => mocks.save(input),
  setBookingPriceRuleActiveAction: (input: unknown) => mocks.toggle(input),
}));

import { BookingPriceManager } from "@/components/bookings/booking-price-manager";
import type { BookingPriceRuleRow } from "@/lib/services/booking-price-admin";

const RULE: BookingPriceRuleRow = {
  id: "rule-1",
  label: "Lane hire",
  facilityId: "fac-1",
  facilityName: "Swimming Pool",
  daysOfWeek: [],
  startTime: null,
  endTime: null,
  pricePaise: 40_000,
  priority: 0,
  isActive: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("B6 booking price editor", () => {
  it("lists the configured price with its facility, days and window", () => {
    render(<BookingPriceManager facilities={[]} rules={[RULE]} />);
    const row = screen.getByTestId("price-rule-row");
    expect(row.textContent).toContain("Lane hire");
    expect(row.textContent).toContain("Swimming Pool");
    expect(row.textContent).toContain("Every day");
    expect(row.textContent).toContain("₹400");
  });

  it("deactivates a rule and re-reads the catalogue", async () => {
    render(<BookingPriceManager facilities={[]} rules={[RULE]} />);

    await screen.getByTestId("price-rule-toggle").click();

    expect(mocks.toggle).toHaveBeenCalledWith({
      id: "rule-1",
      isActive: false,
    });
    expect(mocks.refresh).toHaveBeenCalled();
    expect(await screen.findByTestId("price-rule-notice")).toHaveProperty(
      "textContent",
      "Price deactivated.",
    );
  });

  it("says so when the catalogue is empty", () => {
    render(<BookingPriceManager facilities={[]} rules={[]} />);
    expect(document.body.textContent).toContain("No prices configured yet");
    expect(screen.queryByTestId("price-rule-list")).toBeNull();
  });

  it("shows the server's refusal when a rule cannot be saved", async () => {
    mocks.save.mockResolvedValueOnce({
      ok: false,
      error: "The end time must be after the start time.",
    } as never);
    render(<BookingPriceManager facilities={[]} rules={[]} />);

    fireEvent.change(screen.getByTestId("price-rule-label"), {
      target: { value: "Broken" },
    });
    fireEvent.change(screen.getByTestId("price-rule-price"), {
      target: { value: "100" },
    });
    await screen.getByTestId("price-rule-save").click();

    const error = await screen.findByTestId("price-rule-error");
    expect(error.textContent).toContain("The end time must be after the start time.");
  });
});
