// @vitest-environment jsdom
//
// Owner light · Operations lane — create openers (3 November 2026).
//
// Chrome inventory found two remaining create OPENERS without the approved
// outline plus: Programs' existing "Add batch" button (terminology
// dependent) and Booking prices' "Add price rule" button. The plus is a
// marker for the button that OPENS the creation UI — never on the expanded
// Cancel/Close, the Save/Apply control or an edit control, and never a new
// floating action or a second entry point.
//
// Intended RED before the production edit: neither opener renders a glyph,
// so the exact-geometry assertions fail on the icon, not on a fixture.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      children?: unknown;
      [key: string]: unknown;
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// The boards' own server actions: fixtures only, nothing asserted on them.
vi.mock("@/lib/actions/programs", () => ({
  createProgramAction: async () => ({ ok: true as const }),
  updateProgramAction: async () => ({ ok: true as const }),
  deleteProgramAction: async () => ({ ok: true as const }),
  createBatchAction: async () => ({ ok: true as const }),
  updateBatchAction: async () => ({ ok: true as const }),
  deleteBatchAction: async () => ({ ok: true as const }),
}));
vi.mock("@/lib/actions/coach-conflicts", () => ({
  checkCoachConflictsAction: async () => ({ ok: true as const, conflicts: [] }),
}));
vi.mock("@/lib/actions/booking-price-admin", () => ({
  saveBookingPriceRuleAction: async () => ({ ok: true as const }),
  deleteBookingPriceRuleAction: async () => ({ ok: true as const }),
}));

import { ProgramsBatchesBoard } from "@/components/programs-batches-board";
import { BookingPriceManager } from "@/components/bookings/booking-price-manager";

afterEach(cleanup);

const TERMINOLOGY = { locale: "en", overrides: {} } as const;

const PROGRAM = {
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  name: "Learn to swim",
} as never;

const BATCH = {
  id: "33333333-3333-4333-8333-333333333333",
  tenantId: "22222222-2222-4222-8222-222222222222",
  programId: "11111111-1111-4111-8111-111111111111",
  programName: "Learn to swim",
  name: "Junior squad",
  capacity: 12,
  daysOfWeek: [1, 3],
  startTime: "17:00",
  endTime: "18:00",
  coachName: null,
  locationName: "Hall A",
} as never;

const RULE = {
  id: "44444444-4444-4444-8444-444444444444",
  facilityId: "55555555-5555-4555-8555-555555555555",
  label: "Court hire",
  daysOfWeek: [],
  startTime: null,
  endTime: null,
  pricePaise: 50_000n,
  priority: 0,
  isActive: true,
} as never;

/** The shared OwnerIcon's own drawing contract, as rendered. */
function assertApprovedPlus(svg: Element | null) {
  expect(svg).toBeTruthy();
  expect(svg!.getAttribute("viewBox")).toBe("0 0 24 24");
  expect(svg!.getAttribute("fill")).toBe("none");
  expect(svg!.getAttribute("stroke")).toBe("currentColor");
  expect(svg!.getAttribute("stroke-width")).toBe("1.8");
  expect(svg!.getAttribute("width")).toBe("16");
  expect(svg!.querySelector("path")?.getAttribute("d")).toBe(
    "M12 5v14M5 12h14",
  );
}

describe("Programs' Add batch openers", () => {
  function renderBoard() {
    return render(
      <ProgramsBatchesBoard
        initialPrograms={[PROGRAM]}
        initialBatches={[BATCH]}
        coaches={[]}
        locations={[]}
        terminology={TERMINOLOGY}
      />,
    );
  }

  it("carry the approved plus on both responsive variants", () => {
    renderBoard();

    // The header opener and its mobile-only twin: one entry point, two
    // responsive buttons, and both are the button that opens the form.
    const openers = screen.getAllByRole("button", { name: /^add batch$/i });
    expect(openers.length).toBeGreaterThanOrEqual(2);
    for (const opener of openers) {
      assertApprovedPlus(opener.querySelector("svg"));
    }
  });

  it("shows no plus on the expanded dismiss or on the form's submission", () => {
    renderBoard();

    fireEvent.click(screen.getByTestId("add-batch"));

    // The opener is gone and the one form is open.
    expect(screen.queryByTestId("add-batch")).toBeNull();
    // The SUBMISSION control is named "Add batch" too, and it must not
    // carry a create marker: a plus here would read as "open the form".
    const submit = screen.getByRole("button", { name: /^add batch$/i });
    expect(submit.querySelector("svg")).toBeNull();
    // Nor does the dismiss control.
    const dismiss = screen.getByRole("button", { name: /^(cancel|close)$/i });
    expect(dismiss.querySelector("svg")).toBeNull();
  });
});

describe("Booking prices' Add price rule opener", () => {
  function renderManager() {
    return render(
      <BookingPriceManager
        facilities={[]}
        rules={[RULE]}
        terminology={TERMINOLOGY}
      />,
    );
  }

  it("carries the approved plus", () => {
    renderManager();

    assertApprovedPlus(
      screen.getByTestId("booking-price-add").querySelector("svg"),
    );
  });

  it("shows no plus on the expanded Save or Cancel", () => {
    renderManager();

    fireEvent.click(screen.getByTestId("booking-price-add"));

    expect(screen.queryByTestId("booking-price-add")).toBeNull();
    const save = screen.getByRole("button", { name: /^save price$/i });
    expect(save.querySelector("svg")).toBeNull();
    const cancel = screen.getByRole("button", { name: /^cancel$/i });
    expect(cancel.querySelector("svg")).toBeNull();
  });
});
