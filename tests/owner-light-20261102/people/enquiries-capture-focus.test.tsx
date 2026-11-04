// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the owner's enquiry
// capture must be REACHABLE.
//
// Root review (3 Nov): the owner's floating create action opens the
// inline capture card BELOW the list, but nothing focused or scrolled —
// so on a long list the card opened off-screen, the owner saw no change
// and no field to type in.
//
// The contract this file pins:
//
//   * an EXPLICIT open by the owner focuses the REAL name field and
//     brings it into the viewport;
//   * an explicit close returns the focus to the SAME create action, so
//     the owner never loses their place;
//   * NOTHING is focused on arrival, and reception's always-visible
//     capture is never focused at all.
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

const scrollIntoView = vi.fn();

function renderBoard(variant: "oversight" | "front-desk") {
  return render(
    <EnquiriesBoard
      initialEnquiries={[]}
      locations={[{ id: LOCATION, name: "Worli Main" }]}
      canWrite
      variant={variant}
    />,
  );
}

beforeAll(() => {
  // jsdom has no layout engine, so scrollIntoView is not implemented.
  // The owner's capture brings its name field into view when it opens.
  Element.prototype.scrollIntoView = scrollIntoView as unknown as Element["scrollIntoView"];
});

beforeEach(() => {
  createEnquiryAction.mockReset();
  createEnquiryAction.mockResolvedValue({ id: "e1" });
  scrollIntoView.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("the owner's enquiry capture", () => {
  // RED: opening the capture focuses nothing, so on a long list the
  // owner cannot see the field they are meant to type in.
  it("focuses the name field when the owner opens the capture", async () => {
    renderBoard("oversight");

    fireEvent.click(screen.getByRole("button", { name: "Add enquiry" }));

    await waitFor(() =>
      expect(screen.getByTestId("enquiry-capture-name")).toBeTruthy(),
    );
    const field = screen.getByTestId("enquiry-capture-name");
    await waitFor(() => expect(document.activeElement).toBe(field));
    // And it is brought into the viewport, not only focused.
    expect(scrollIntoView).toHaveBeenCalled();
  });

  // RED: closing the capture drops the focus on the floor.
  it("returns the focus to the create action when the owner closes it", async () => {
    renderBoard("oversight");

    fireEvent.click(screen.getByRole("button", { name: "Add enquiry" }));
    await waitFor(() =>
      expect(screen.getByTestId("enquiry-capture-name")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close enquiry capture" }));

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Add enquiry" }),
      ),
    );
  });

  // CONTROL: arrival focuses nothing — the owner did not ask for a
  // field, so the page must not steal their place.
  it("focuses nothing on arrival", () => {
    renderBoard("oversight");

    expect(document.activeElement).toBe(document.body);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  // CONTROL: reception's capture is ALWAYS visible, so there is nothing
  // to reveal — it is never focused.
  it("never focuses reception's always-visible capture", () => {
    renderBoard("front-desk");

    const field = screen.getByTestId("enquiry-capture-name");
    expect(field).toBeTruthy();
    expect(document.activeElement).not.toBe(field);
    expect(document.activeElement).toBe(document.body);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
