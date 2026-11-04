// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the shared front-desk
// consumer stays unchanged.
//
// The enquiries board is SHARED: the owner's page renders the oversight
// variant, and reception's page renders the front-desk variant from the
// same component. The owner's board grew a shared create action, a
// focus move and an extracted leaf, so reception's board has to be
// PROVEN untouched: its capture is always visible, it never steals the
// focus, it carries no create action, and it saves exactly as before.
//
// No database: the board's only server action is stubbed.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const createEnquiryAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/enquiries", () => ({
  createEnquiryAction: (...args: unknown[]) => createEnquiryAction(...args),
}));

import { EnquiriesBoard } from "@/components/enquiries-board";
import type { EnquiryRow } from "@/lib/services/enquiries";

const LOCATION = "22222222-2222-4222-8222-222222222222";

const ENQUIRY: EnquiryRow = {
  id: "e1",
  fullName: "Meera Nair",
  phone: "+919812340011",
  source: "online",
  stage: "contacted",
  memberId: null,
  locationId: LOCATION,
  createdAt: new Date("2026-10-24T20:00:00.000Z"),
};

beforeAll(() => {
  // jsdom has no layout engine, so scrollIntoView is not implemented.
  Element.prototype.scrollIntoView = function scrollIntoView() {};
});

beforeEach(() => {
  createEnquiryAction.mockReset();
  createEnquiryAction.mockResolvedValue({ id: "e2" });
});

afterEach(cleanup);

describe("reception's front-desk enquiry board", () => {
  // CONTROL: the capture is ALWAYS visible — there is nothing to open,
  // so there is no create action and nothing is focused.
  it("shows its capture without an action and without taking the focus", () => {
    render(
      <EnquiriesBoard
        initialEnquiries={[ENQUIRY]}
        locations={[{ id: LOCATION, name: "Worli Main" }]}
        canWrite
      />,
    );

    expect(screen.getByTestId("enquiry-capture-name")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add enquiry" })).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  // CONTROL: the rows are the reception desk's own rows — the name, the
  // contact, the source and the stage, exactly as before. The created
  // day belongs to the OWNER's oversight rows; the desk list never
  // carried it and still does not.
  it("renders the front-desk row facts unchanged", () => {
    render(
      <EnquiriesBoard
        initialEnquiries={[ENQUIRY]}
        locations={[{ id: LOCATION, name: "Worli Main" }]}
        canWrite
      />,
    );

    const list = screen.getByTestId("enquiries-list");
    expect(list.textContent).toContain("Meera Nair");
    expect(list.textContent).toContain("+91 98123 40011");
    expect(list.textContent).toContain("Contacted");
    expect(list.textContent).toContain("online");
    expect(list.textContent).not.toContain("25 Oct 2026");
  });

  // CONTROL: the capture still saves exactly what the owner typed.
  it("still saves a captured enquiry", async () => {
    render(
      <EnquiriesBoard
        initialEnquiries={[]}
        locations={[{ id: LOCATION, name: "Worli Main" }]}
        canWrite
      />,
    );

    fireEvent.change(screen.getByTestId("enquiry-capture-name"), {
      target: { value: "Isha Rao" },
    });
    fireEvent.click(screen.getByTestId("enquiry-capture-submit"));

    await waitFor(() => expect(createEnquiryAction).toHaveBeenCalledTimes(1));
    expect(createEnquiryAction).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "Isha Rao", locationId: LOCATION }),
    );
  });

  // CONTROL: a reader still sees the honest permission message and no
  // capture form.
  it("keeps the permission gate for a reader", () => {
    render(
      <EnquiriesBoard
        initialEnquiries={[ENQUIRY]}
        locations={[{ id: LOCATION, name: "Worli Main" }]}
        canWrite={false}
      />,
    );

    expect(screen.queryByTestId("enquiry-capture-name")).toBeNull();
    expect(screen.getByText(/can view enquiries but not capture them/i)).toBeTruthy();
  });
});
