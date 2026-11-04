// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the last two create-openers.
//
// The completed page review found two remaining "add" entry points without the
// approved contextual plus: the roster's Add shift toggle and the enquiry's
// native Add follow-up disclosure. Both already open their own inline form; this
// only decorates the OPENER with the shared OwnerIcon plus, and never puts a
// plus on the expanded Close/Cancel state, on Save/Apply, or on any other
// summary.
//
// Rendered assertions only: the opener's own glyph, the labels, the toggled
// state and the unchanged form.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/actions/shifts", () => ({
  addShiftAction: vi.fn(async () => ({ ok: true })),
  publishRosterAction: vi.fn(async () => ({ ok: true })),
  deleteShiftAction: vi.fn(async () => ({ ok: true })),
  listRosterWeekAction: vi.fn(async () => ({ shifts: [], templates: [] })),
  listShiftTemplatesAction: vi.fn(async () => []),
  saveShiftTemplateAction: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/actions/enquiries", () => ({
  addFollowUpAction: vi.fn(async () => ({ ok: true })),
  markFollowUpDoneAction: vi.fn(async () => ({ ok: true })),
  updateEnquiryStatusAction: vi.fn(async () => ({ ok: true })),
  convertEnquiryAction: vi.fn(async () => ({ ok: true })),
  updateEnquiryAction: vi.fn(async () => ({ ok: true })),
}));

import { StaffRosterBoard } from "@/components/staff-roster-board";
import { EnquiryDetailView } from "@/components/enquiry-detail-view";
import type { EnquiryDetail } from "@/lib/services/enquiries";

const PLUS_PATH = "M12 5v14M5 12h14";

const ENQUIRY = {
  id: "e1",
  fullName: "Meera Nair",
  phone: "+919812340011",
  source: "online",
  stage: "contacted",
  memberId: null,
  locationId: "loc-1",
  createdAt: new Date("2026-10-25T04:00:00.000Z"),
  followUps: [],
} as unknown as EnquiryDetail;

afterEach(cleanup);

describe("the roster's Add shift opener", () => {
  // RED: the collapsed toggle carries no plus.
  it("shows the approved plus while collapsed and none on Cancel", () => {
    render(
      <StaffRosterBoard
        weekStart="2026-11-02"
        shifts={[]}
        templates={[]}
        staff={[]}
        locations={[{ id: "loc-1", name: "Worli Main" }]}
        weekLocationId={null}
      />,
    );
    const open = screen.getByRole("button", { name: "Add shift" });
    expect(open.querySelector(`svg path[d="${PLUS_PATH}"]`)).not.toBeNull();
    fireEvent.click(open);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel.querySelector(`svg path[d="${PLUS_PATH}"]`)).toBeNull();
    expect(cancel.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("the enquiry's Add follow-up opener", () => {
  // RED: the native summary carries the chevron only.
  it("shows the approved plus on the disclosure opener", () => {
    render(
      <EnquiryDetailView
        enquiry={ENQUIRY}
        locations={[]}
        batches={[]}
        terminology={{ locale: "en", overrides: {} }}
      />,
    );
    const summary = screen.getByText("Add follow-up", { selector: "summary" });
    expect(summary.querySelector(`svg path[d="${PLUS_PATH}"]`)).not.toBeNull();
    // The native disclosure keeps its own chevron; the label is unchanged.
    expect(summary.querySelector("svg.lucide-chevron-down")).not.toBeNull();
    expect(summary.textContent).toContain("Add follow-up");
  });

  // CONTROL: opening the disclosure still reveals the real form, and the
  // submit control never gets the plus.
  it("keeps the inline follow-up form and its submit control", () => {
    render(
      <EnquiryDetailView
        enquiry={ENQUIRY}
        locations={[]}
        batches={[]}
        terminology={{ locale: "en", overrides: {} }}
      />,
    );
    const summary = screen.getByText("Add follow-up", { selector: "summary" });
    fireEvent.click(summary);
    expect(screen.getByLabelText("Note (optional)")).toBeTruthy();
    const submits = screen.getAllByRole("button", { name: /add follow-up/i });
    for (const submit of submits) {
      expect(submit.querySelector(`svg path[d="${PLUS_PATH}"]`)).toBeNull();
    }
  });
});
