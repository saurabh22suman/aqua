// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the enquiries create
// action.
//
// The owner's enquiry board fell back to an ordinary boxed "Add enquiry"
// button at the foot of the list: a different shape from every other
// owner create affordance, no clearance marker, and a second way in
// beside the shared floating action the other pages use.
//
// The shared OwnerCreateAction now has its reviewed BUTTON variant
// (`kind: "button"`, `onClick`), so the enquiries board can use the ONE
// create action: the round 56px floating action on a phone and the
// labelled action on a desktop.
//
// The contract this file pins:
//
//   * the enquiries create action IS the shared action — one affordance,
//     the shared marker, the shared geometry;
//   * opening it OPENS the capture panel and never submits it;
//   * while its own panel is open the action is hidden, so the owner
//     never has two ways in and the floating action never covers the
//     form;
//   * the permission gate still holds: a reader gets no create action;
//   * the capture form itself is unchanged.
//
// No database: the board's only server action is stubbed.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const createEnquiryAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/enquiries", () => ({
  createEnquiryAction: (...args: unknown[]) => createEnquiryAction(...args),
}));

import { EnquiriesBoard } from "@/components/enquiries-board";

const LOCATION = "22222222-2222-4222-8222-222222222222";

function renderBoard(canWrite = true) {
  return render(
    <EnquiriesBoard
      initialEnquiries={[]}
      locations={[{ id: LOCATION, name: "Worli Main" }]}
      canWrite={canWrite}
      variant="oversight"
    />,
  );
}

beforeAll(() => {
  // jsdom has no layout engine, so scrollIntoView is not implemented.
  // The owner's capture brings its name field into view when it opens.
  Element.prototype.scrollIntoView = function scrollIntoView() {};
});

beforeEach(() => {
  createEnquiryAction.mockReset();
  // The captured row is COMPLETE. The real action returns an EnquiryRow,
  // whose `createdAt` is required, and the owner's oversight rows draw
  // that day — a stub without it makes the board render an undefined
  // date and throws inside the list (root review, 3 Nov 2026).
  createEnquiryAction.mockResolvedValue({
    id: "e1",
    fullName: "Meera Nair",
    phone: null,
    source: "walk-in",
    stage: "new",
    memberId: null,
    locationId: LOCATION,
    createdAt: new Date("2026-10-24T20:00:00.000Z"),
  });
});

afterEach(cleanup);

describe("the enquiries create action", () => {
  // RED: the board still renders an ordinary boxed button.
  it("is the shared create action", () => {
    renderBoard();

    const actions = screen.getAllByRole("button", { name: "Add enquiry" });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.hasAttribute("data-owner-create-action")).toBe(true);
    // The phone's round 56px floating action, and the desktop's inline
    // labelled action — the shared geometry, not a second shape.
    expect(actions[0]!.className).toContain("h-14");
    expect(actions[0]!.className).toContain("w-14");
    expect(actions[0]!.className).toContain("rounded-full");
    expect(actions[0]!.className).toContain("lg:static");
  });

  // CONTROL: opening the action opens the panel and submits NOTHING.
  it("opens the capture panel without submitting", () => {
    renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Add enquiry" }));

    expect(screen.getByTestId("enquiry-capture-name")).toBeTruthy();
    expect(createEnquiryAction).not.toHaveBeenCalled();
  });

  // RED: the action stays on screen while its own panel is open, so the
  // owner has two ways in and the floating action covers the form.
  it("is hidden while its own panel is open", () => {
    renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Add enquiry" }));

    expect(screen.queryByRole("button", { name: "Add enquiry" })).toBeNull();
    expect(screen.getByRole("button", { name: /close enquiry capture/i })).toBeTruthy();
  });

  // CONTROL: the permission gate still holds.
  it("offers no create action to a reader", () => {
    renderBoard(false);

    expect(screen.queryByRole("button", { name: "Add enquiry" })).toBeNull();
    expect(document.querySelector("[data-owner-create-action]")).toBeNull();
  });

  // CONTROL: the capture form itself is unchanged.
  it("keeps the capture form working", async () => {
    renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Add enquiry" }));
    fireEvent.change(screen.getByTestId("enquiry-capture-name"), {
      target: { value: "Meera Nair" },
    });
    fireEvent.click(screen.getByTestId("enquiry-capture-submit"));

    await waitFor(() => expect(createEnquiryAction).toHaveBeenCalledTimes(1));
    expect(createEnquiryAction).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "Meera Nair", locationId: LOCATION }),
    );
  });
});
