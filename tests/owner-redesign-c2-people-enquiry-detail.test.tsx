// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner redesign · People lane (C2) — the enquiry detail view.
//
// RED target (branch feat/owner-redesign-people-c2, base d1425e7):
//
// The trial workflow and the conversion workflow were two independent
// toggles, so a stage that allows both ("new" and "contacted") could
// show the trial form and the conversion form at the same time. The
// approved direction says only one of them is open at a time: "Trial
// and conversion forms should not be expanded together."

vi.mock("@/lib/actions/enquiries", () => ({
  addFollowUpAction: vi.fn(),
  bookTrialAction: vi.fn(),
  completeFollowUpAction: vi.fn(),
  convertEnquiryAction: vi.fn(),
  transitionEnquiryStageAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { EnquiryDetailView } from "@/components/enquiry-detail-view";
import type { EnquiryDetail } from "@/lib/services/enquiries";

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("enquiry detail (C2)", () => {
  it("keeps one trial or conversion workflow open at a time", () => {
    render(
      <EnquiryDetailView
        enquiry={ENQUIRY}
        locations={[{ id: "loc-1", name: "Worli Main" }]}
        batches={[]}
        terminology={{ locale: "en", overrides: {} } as never}
      />,
    );

    fireEvent.click(screen.getByTestId("show-book-trial"));
    expect(screen.getByTestId("submit-book-trial")).toBeTruthy();

    fireEvent.click(screen.getByTestId("show-convert"));
    expect(
      screen.queryByTestId("submit-book-trial"),
      "opening the conversion workflow closes the trial workflow",
    ).toBeNull();
    expect(screen.getByTestId("show-convert")).toBeTruthy();
  });

  it("closes a workflow when its own toggle is pressed again", () => {
    render(
      <EnquiryDetailView
        enquiry={ENQUIRY}
        locations={[{ id: "loc-1", name: "Worli Main" }]}
        batches={[]}
        terminology={{ locale: "en", overrides: {} } as never}
      />,
    );

    fireEvent.click(screen.getByTestId("show-book-trial"));
    expect(screen.getByTestId("submit-book-trial")).toBeTruthy();
    fireEvent.click(screen.getByTestId("show-book-trial"));
    expect(screen.queryByTestId("submit-book-trial")).toBeNull();
  });
});
