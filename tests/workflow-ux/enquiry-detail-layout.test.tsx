// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { EnquiryDetailView } from "@/components/enquiry-detail-view";
import type { EnquiryDetail } from "@/lib/services/enquiries";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/actions/enquiries", () => ({
  addFollowUpAction: vi.fn(), completeFollowUpAction: vi.fn(), bookTrialAction: vi.fn(),
  convertEnquiryAction: vi.fn(), transitionEnquiryStageAction: vi.fn(),
}));

const enquiry: EnquiryDetail = {
  id: "enquiry", fullName: "Diya Deshpande", phone: null, source: "phone",
  stage: "trial_completed", memberId: null, locationId: "site", createdAt: new Date("2026-11-20"),
  notes: "Ask about weekday classes", trialBatchId: null,
  followUps: [{ id: "follow", note: "Confirm fees", doneAt: null, dueAt: new Date("2026-11-20") }],
};
it("places the stage-appropriate primary action ahead of notes and follow-up history", () => {
  render(<EnquiryDetailView enquiry={enquiry} locations={[]} batches={[]} terminology={{ overrides: {}, locale: "en" }} />);
  const primary = screen.getByRole("heading", { name: "Next action" });
  const history = screen.getByRole("heading", { name: "Follow-up timeline" });
  expect(primary.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole("button", { name: "Convert to member" }).closest("section")?.contains(primary)).toBeTruthy();
  expect(screen.getByText("Ask about weekday classes")).toBeTruthy();
});
