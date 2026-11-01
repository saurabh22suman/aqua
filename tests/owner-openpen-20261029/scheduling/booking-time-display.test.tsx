// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The visible clock is 12-hour everywhere the human can read one.
//
// The human approved AM/PM for the shared time controls, and Programs,
// Sessions, the roster and the receipts already print AM/PM. The
// booking counter and the schedule were the two surfaces still
// printing a bare 24-hour clock: "15:00–16:00" for a slot, "23:30 –
// 00:30 (+1d)" for an event.
//
// What this pins:
//
//   * the booking slot picker labels its options in AM/PM while the
//     OPTION VALUE stays the canonical 24-hour slot ("06:00");
//   * the selected-slot summary and the day board's free slots print
//     AM/PM;
//   * the schedule's event range prints AM/PM and keeps its "(+1d)"
//     continuation truth;
//   * the booking-price catalogue's window label prints AM/PM too;
//   * noon, midnight and an overnight range are all right.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      children?: unknown;
      [k: string]: unknown;
    }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});
vi.mock("@/lib/actions/bookings", () => ({
  listBookingsAction: vi.fn(async () => []),
  cancelBookingAction: vi.fn(async () => ({ ok: true as const })),
  requestBookingBillAction: vi.fn(async () => ({
    ok: false as const,
    error: "No bill raised in this test.",
  })),
  quoteBookingAction: vi.fn(async () => ({ ok: true as const, pricePaise: 50000 })),
  createBookingAction: vi.fn(async () => ({ ok: false as const, error: "no" })),
}));
vi.mock("@/components/cafe-member-picker", () => ({
  CafeMemberPicker: () => <div data-testid="member-picker" />,
}));

import { BookingScreen } from "@/components/booking-screen";
import { OwnerScheduleGrid } from "@/components/owner-schedule-grid";
import { timeRange } from "@/components/owner-calendar/calendar-layout";
import { windowSummary } from "@/components/bookings/booking-price-shared";
import type { TerminologyState } from "@/lib/terminology/keys";

const TERMINOLOGY: TerminologyState = { overrides: {}, locale: "en" };

const FACILITIES = [
  {
    id: "f-1",
    name: "Main court",
    kind: "court",
    capacity: 4,
    locationId: "loc-1",
    locationName: "Worli Main",
    subUnits: [],
  },
];

function renderDesk() {
  return render(
    <BookingScreen
      facilities={FACILITIES}
      timezone="Asia/Kolkata"
      today="2026-10-27"
      terminology={TERMINOLOGY}
    />,
  );
}

afterEach(cleanup);

describe("the booking counter's clock", () => {
  it("labels the slot options in AM/PM and keeps the canonical value", async () => {
    renderDesk();

    const slot = (await screen.findByTestId(
      "booking-slot",
    )) as HTMLSelectElement;
    const options = Array.from(slot.querySelectorAll("option"));
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.textContent ?? "").toMatch(
        /^\d{1,2}:\d{2}\s?[ap]m–\d{1,2}:\d{2}\s?[ap]m$/i,
      );
      expect(option.value).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it("prints the selected slot's range in AM/PM", async () => {
    renderDesk();

    const summary = await screen.findByTestId("booking-slot-summary");
    expect(summary.textContent ?? "").toContain("3:00 pm–4:00 pm");
    // The canonical 24-hour slot is not what the owner reads.
    expect(summary.textContent ?? "").not.toContain("15:00");
  });

  it("prints the day board's free slots in AM/PM", async () => {
    renderDesk();

    fireEvent.click(await screen.findByRole("tab", { name: "Board" }));
    const choices = await screen.findAllByRole("button", { name: "Choose slot" });
    expect(choices.length).toBeGreaterThan(0);
    const row = choices[0]!.closest("li");
    expect(row?.textContent ?? "").toContain("6:00 am–7:00 am");
  });

  it("keeps the canonical slot value when a slot is chosen", async () => {
    renderDesk();

    fireEvent.click(await screen.findByRole("tab", { name: "Board" }));
    const choices = await screen.findAllByRole("button", { name: "Choose slot" });
    fireEvent.click(choices[0]!);
    const slot = screen.getByTestId("booking-slot") as HTMLSelectElement;
    expect(slot.value).toBe("06:00");
  });
});

describe("the schedule's event clock", () => {
  it("prints a same-day range in AM/PM", () => {
    expect(timeRange(9 * 60 + 5, 30)).toBe("9:05 am – 9:35 am");
  });

  it("prints noon as 12:00 pm", () => {
    expect(timeRange(12 * 60, 60)).toBe("12:00 pm – 1:00 pm");
  });

  it("prints midnight as 12:00 am", () => {
    expect(timeRange(0, 60)).toBe("12:00 am – 1:00 am");
  });

  it("keeps the (+1d) continuation on an overnight range", () => {
    expect(timeRange(23 * 60 + 30, 60)).toBe("11:30 pm – 12:30 am (+1d)");
  });

  it("keeps the day count when a range runs over two midnights", () => {
    expect(timeRange(23 * 60, 120)).toBe("11:00 pm – 1:00 am (+1d)");
  });
});

describe("the booking-price catalogue's window label", () => {
  it("prints a priced window in AM/PM", () => {
    expect(windowSummary("06:00", "07:00")).toBe("6:00 am–7:00 am");
  });

  it("states the end of the day as the next midnight", () => {
    // A rule with no end time runs to the end of that day. The end of
    // the day is the next midnight, and the label says so the way the
    // calendar says it.
    expect(windowSummary("15:00", null)).toBe("3:00 pm–12:00 am (+1d)");
    expect(windowSummary("15:00", "24:00")).toBe("3:00 pm–12:00 am (+1d)");
  });

  it("states a window that starts at midnight as the same day", () => {
    expect(windowSummary(null, "07:00")).toBe("12:00 am–7:00 am");
  });

  it("keeps an all-day rule as all day", () => {
    expect(windowSummary(null, null)).toBe("All day");
  });
});

describe("the schedule's hour ruler", () => {
  it("prints the ruler's hours in AM/PM", () => {
    render(
      <OwnerScheduleGrid
        view="week"
        locations={[]}
        sessions={[
          {
            id: "s-1",
            sessionDate: "2026-10-27",
            startsAt: "2026-10-27T00:30:00.000Z",
            endsAt: "2026-10-27T01:30:00.000Z",
            status: "scheduled",
            batchId: "b-1",
            batchName: "Morning Squad",
            capacity: 12,
            enrolled: 9,
            locationId: "loc-1",
            locationName: "Worli Main",
            coachName: "Aanya Rao",
          },
        ]}
        days={["2026-10-26", "2026-10-27"]}
        monthCells={null}
        prevHref="/owner/schedule"
        nextHref="/owner/schedule"
        todayHref="/owner/schedule"
        canManagePrograms
      />,
    );

    const ruler = screen.getByTestId("calendar-ruler");
    const labels = Array.from(ruler.querySelectorAll("span")).map((span) =>
      (span.textContent ?? "").trim(),
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label).toMatch(/^\d{1,2}:\d{2}\s?[ap]m$/i);
    }
    expect(labels).toContain("6:00 am");
  });
});
